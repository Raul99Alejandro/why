import { createHash } from 'node:crypto';
import type { Analysis, CommitRef, Decision } from './domain/types.js';
import { localDay } from './domain/dates.js';
import { errorInfo, plainText, type BeeTodos } from './bee/todos.js';
import { commitsSince } from './github.js';
import { log } from './log.js';
import type { ConverseFn } from './nova.js';
import { alertText, closingCommit, followUpText, judgeDecision, raisesAlert, SAME_STEP, similarity, type Candidate } from './relate.js';
import type { DecisionRecord, SessionRecord, Store } from './store/store.js';

export const WINDOW_DAYS = 30;
/** Decisions older than this are linked on the page but never alert or create todos (nothing to act on, and no Bee flood on a first run). */
export const FRESH_MS = 24 * 3_600_000;
export const ALERT_DELAY_MS = 10 * 60_000;
/** A todo whose Bee call keeps failing while others succeed is skipped after this many tries. */
export const MAX_ATTEMPTS = 5;
const MAX_FAILURES_PER_RUN = 3;
const MAX_CANDIDATES = 40;
const MAX_CHECKED = 200;

export type LedgerResult = {
  judged: number; judgeFailed: number;
  reversals: number; refinements: number; restatements: number;
  alertsCreated: number; followUpsCreated: number; followUpsClosed: number;
  /** Todos found in Bee after a crash between creating and saving them (not created again). */
  adopted: number;
  /** Todos given up on: deleted in Bee, or failing five times while others worked. */
  gone: number;
  /** Records another writer changed first (skipped; the next run reloads them). */
  conflicts: number;
  beeFailed: number;
  /** Days whose log must be rebuilt: the day of each new link, the day it points to, the day of a changed follow-up. */
  affectedDays: string[];
};

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const windowDays = (today: string, n = WINDOW_DAYS): string[] => Array.from({ length: n + 1 }, (_, i) => addDays(today, -i)).reverse();

/**
 * Stable ids for a session's decisions: the session id plus a hash of the decision's wording, so re-analyzing a session
 * keeps the links of every decision whose wording did not change. Same wording twice in one session gets a counter.
 */
export function decisionIds(sessionId: string, decisions: Pick<Decision, 'what'>[]): string[] {
  const seen = new Map<string, number>();
  return decisions.map(d => {
    const h = createHash('sha1').update(d.what.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 10);
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return `${sessionId}#${h}${n > 1 ? `-${n}` : ''}`;
  });
}

/** The decision's own time as ISO (the model's `at` when valid, otherwise the session start). */
function normAt(at: string, fallback: string): string {
  const t = Date.parse(at);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

type Slot = 'alert' | 'followUp';

/**
 * After sessions are analyzed: judges each not-yet-judged decision of `days` against the last 30 days (reversal / refinement /
 * restatement / unrelated), stores the links, then performs the Bee writes that are still due (alerts, follow-up todos, completions)
 * and closes follow-ups that a new commit carries out.
 *
 * Runs only on the owner's PC (the one writer): records are created with attribute_not_exists and every change is a versioned
 * write, so a second writer can never double-create. A todo is saved as `creating` before the Bee call; after a crash the next run
 * looks for it in Bee and adopts it instead of creating a second one. Bee being unreachable never throws; writes stay pending.
 */
export async function reconcile(deps: {
  store: Store; converse: ConverseFn; todos?: BeeTodos; repos: string[]; timeZone: string; now: Date; fetchFn?: typeof fetch;
  days: string[]; maxTodosPerRun?: number;
}): Promise<LedgerResult> {
  const { store, converse, todos, now } = deps;
  const today = localDay(now.toISOString(), deps.timeZone);
  const out: LedgerResult = { judged: 0, judgeFailed: 0, reversals: 0, refinements: 0, restatements: 0, alertsCreated: 0, followUpsCreated: 0, followUpsClosed: 0, adopted: 0, gone: 0, conflicts: 0, beeFailed: 0, affectedDays: [] };
  const affected = new Set<string>();
  const records = new Map<string, DecisionRecord>();
  for (const dayRecords of await Promise.all(windowDays(today).map(d => store.listDecisionRecords(d)))) {
    for (const r of dayRecords) records.set(r.id, r);
  }
  const sessions = new Map<string, SessionRecord | null>();
  const session = async (id: string) => { if (!sessions.has(id)) sessions.set(id, await store.getSession(id)); return sessions.get(id)!; };
  const textOf = async (r: DecisionRecord): Promise<{ what: string; why: string; topic: string } | null> => {
    const s = await session(r.sessionId);
    if (!s?.analysis) return null;
    const d = s.analysis.decisions[decisionIds(r.sessionId, s.analysis.decisions).indexOf(r.id)];
    return d ? { what: d.what, why: d.why, topic: s.analysis.topic } : null;
  };
  /** A versioned save; false means another writer changed the record, so this run leaves it alone. */
  const lost = new Set<string>();
  const save = async (r: DecisionRecord): Promise<boolean> => {
    if (lost.has(r.id)) return false;
    if (await store.saveDecisionRecord(r)) return true;
    lost.add(r.id); out.conflicts++;
    return false;
  };

  // 1. Judge new decisions, oldest first, so a decision can be compared with ones found in the same run.
  type Fresh = { id: string; sessionId: string; day: string; at: string; what: string; why: string };
  const fresh: Fresh[] = [];
  for (const day of [...new Set(deps.days)].sort()) {
    for (const rec of await store.listSessionsOn(day)) {
      sessions.set(rec.session.id, rec);
      const analysis = rec.analysis as Analysis | null;
      if (!analysis) continue;
      const ids = decisionIds(rec.session.id, analysis.decisions);
      // A re-analysis that changed the wording leaves records of decisions that no longer exist: drop them.
      for (const r of [...records.values()]) {
        if (r.sessionId === rec.session.id && !ids.includes(r.id)) { await store.deleteDecisionRecord(r.day, r.id); records.delete(r.id); }
      }
      analysis.decisions.forEach((d, i) => {
        if (!records.has(ids[i]!)) fresh.push({ id: ids[i]!, sessionId: rec.session.id, day, at: normAt(d.at, rec.session.startedAt), what: d.what, why: d.why });
      });
    }
  }
  fresh.sort((a, b) => a.at.localeCompare(b.at));
  for (const f of fresh) {
    const oldest = addDays(f.day, -WINDOW_DAYS);
    const prior = [...records.values()].filter(r => r.sessionId !== f.sessionId && r.at < f.at && r.day >= oldest).sort((a, b) => b.at.localeCompare(a.at));
    const candidates: (Candidate & { rec: DecisionRecord })[] = [];
    for (const r of prior) {
      if (candidates.length >= MAX_CANDIDATES) break;
      const t = await textOf(r);
      if (t) candidates.push({ id: r.id, date: r.day, what: t.what, rec: r });
    }
    const j = await judgeDecision({ what: f.what, why: f.why, candidates: candidates.map(({ rec: _r, ...c }) => c), converse });
    if (!j) { out.judgeFailed++; continue; }
    out.judged++;
    const isFresh = now.getTime() - Date.parse(f.at) <= FRESH_MS;
    const rec: DecisionRecord = { id: f.id, sessionId: f.sessionId, day: f.day, at: f.at, v: 0 };
    const target = candidates.find(c => c.id === j.priorId)?.rec;
    if (j.relation !== 'unrelated' && target) {
      rec.relation = { kind: j.relation, priorId: target.id, priorDay: target.day };
      if (raisesAlert(j.relation)) rec.alert = { state: isFresh ? 'pending' : 'skipped' };
    }
    // The same step already tracked (a decision repeated in another session that the judge did not call a restatement) gets no second todo.
    const step = j.nextStep && isFresh ? followUpText(j.nextStep) : '';
    const duplicate = step && [...records.values()].some(r => r.followUp && !['closed', 'gone', 'skipped'].includes(r.followUp.state) && similarity(r.followUp.text, step) >= SAME_STEP);
    if (step && !duplicate) rec.followUp = { state: 'pending', text: step, checked: [] };
    if (!(await store.createDecisionRecord(rec))) continue; // another writer judged it first
    if (rec.relation) {
      affected.add(rec.day); affected.add(rec.relation.priorDay);
      if (rec.relation.kind === 'reversal') out.reversals++; else if (rec.relation.kind === 'refinement') out.refinements++; else out.restatements++;
    }
    records.set(rec.id, rec);
    affected.add(f.day);
  }

  // 2. Bee writes that are due. A run stops talking to Bee after a few failures (offline or signed out); the writes stay pending.
  let failures = 0, successes = 0;
  let budget = deps.maxTodosPerRun ?? 8;
  const failed: { r: DecisionRecord; slot: Slot | 'complete'; notFound: boolean }[] = [];
  const bee = async <T>(r: DecisionRecord, slot: Slot | 'complete', what: string, fn: () => Promise<T>): Promise<{ value: T } | null> => {
    if (!todos || failures >= MAX_FAILURES_PER_RUN) return null;
    try { const value = await fn(); successes++; return { value }; } catch (err) {
      failures++; out.beeFailed++;
      const info = errorInfo(err);
      log({ level: 'warn', msg: 'bee_todo_failed', action: what, decision: r.id, ...info }); // class, exit code, not-found flag: never the CLI's output
      failed.push({ r, slot, notFound: info.notFound });
      return null;
    }
  };
  const give = async (r: DecisionRecord, slot: Slot | 'complete') => {
    out.gone++; affected.add(r.day);
    if (slot === 'alert') r.alert = { ...r.alert!, state: 'gone' };
    else r.followUp = { ...r.followUp!, state: 'gone' };
    await save(r);
  };

  /** Creates the Bee todo of a slot once: saved as `creating` first; an unfinished earlier attempt is looked up in Bee and adopted. */
  const ensure = async (r: DecisionRecord, slot: Slot): Promise<void> => {
    const cur = slot === 'alert' ? r.alert! : r.followUp!;
    let text = cur.text;
    if (!text) { // alerts compose their wording when first due
      const t = await textOf(r); const old = r.relation ? records.get(r.relation.priorId) : undefined; const was = old ? await textOf(old) : null;
      if (!t || !was) { r.alert = { ...r.alert!, state: 'skipped' }; await save(r); return; } // a side was forgotten: nothing left to confirm
      text = alertText(t.topic, was.what, t.what);
    }
    const set = (state: string, todoId?: string) => {
      const extra = todoId ? { todoId } : {};
      if (slot === 'alert') r.alert = { ...r.alert!, ...extra, state: state as 'done', text };
      else r.followUp = { ...r.followUp!, ...extra, state: state as 'open' };
    };
    if (cur.state === 'pending' && now.getTime() - Date.parse(r.at) > FRESH_MS) { set('skipped'); await save(r); return; } // too late to act on
    if (cur.state === 'creating') {
      const found = await bee(r, slot, 'list', async () => (await todos!.list()).find(t => plainText(t.text).toLowerCase() === plainText(text!).toLowerCase()));
      if (!found) return; // listing failed: stay as is, try again next run
      if (found.value) {
        set(slot === 'alert' ? 'done' : 'open', found.value.id);
        if (await save(r)) { out.adopted++; affected.add(r.day); }
        return;
      }
    } else {
      set('creating');
      if (!(await save(r))) return;
    }
    const made = await bee(r, slot, 'create', () => todos!.create(text!, slot === 'alert' ? new Date(now.getTime() + ALERT_DELAY_MS).toISOString() : undefined));
    if (!made) return;
    budget--;
    set(slot === 'alert' ? 'done' : 'open', made.value);
    if (await save(r)) { if (slot === 'alert') out.alertsCreated++; else out.followUpsCreated++; affected.add(r.day); }
  };

  const complete = async (r: DecisionRecord): Promise<void> => {
    const f = r.followUp!;
    if (!(await bee(r, 'complete', 'complete', async () => { await todos!.complete(f.todoId!); return true; }))) return;
    r.followUp = { ...f, state: 'closed' };
    if (await save(r)) { out.followUpsClosed++; affected.add(r.day); }
  };

  const ordered = [...records.values()].sort((a, b) => a.at.localeCompare(b.at));
  for (const r of ordered) {
    if (!todos) break;
    if ((r.alert?.state === 'pending' || r.alert?.state === 'creating') && r.relation && budget > 0) await ensure(r, 'alert');
    if ((r.followUp?.state === 'pending' || r.followUp?.state === 'creating') && budget > 0) await ensure(r, 'followUp');
    if (r.followUp?.state === 'closing' && r.followUp.todoId) await complete(r);
  }

  // 3. Close follow-ups that a new commit carries out. Each follow-up is judged on its own, so a commit that serves two decisions closes both only if each passes.
  const open = ordered.filter(r => r.followUp?.state === 'open' && r.followUp.todoId && !lost.has(r.id));
  if (todos && open.length > 0) {
    const commits: CommitRef[] = await commitsSince(open.map(r => r.day).sort()[0]!, deps.repos, deps.timeZone, deps.fetchFn);
    for (const r of open) {
      const f = r.followUp!;
      const unseen = commits.filter(c => c.at >= r.at && !f.checked.includes(c.sha));
      if (unseen.length === 0) continue;
      const t = await textOf(r);
      if (!t) continue;
      const verdict = await closingCommit({ what: t.what, step: f.text, decisionAt: r.at, commits: unseen, converse });
      if (!verdict) continue; // judge unavailable: look at these commits again next run
      const checked = [...f.checked, ...unseen.map(c => c.sha)].slice(-MAX_CHECKED);
      if (!verdict.commit) { r.followUp = { ...f, checked }; await save(r); continue; }
      r.followUp = { ...f, state: 'closing', closedBy: verdict.commit, checked };
      if (!(await save(r))) continue;
      affected.add(r.day);
      await complete(r);
    }
  }

  // 4. Poison pills. A todo Bee reports as missing is given up at once. Other failures count against the todo only when Bee
  // worked for something else in this run (an outage must not use up anyone's tries).
  for (const x of failed) {
    const cur = x.slot === 'alert' ? x.r.alert : x.r.followUp;
    if (!cur || lost.has(x.r.id) || ['gone', 'closed', 'done', 'open', 'skipped'].includes(cur.state)) continue;
    if (x.notFound && x.slot === 'complete') { await give(x.r, 'complete'); continue; }
    if (successes === 0) continue;
    const attempts = (cur.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) { await give(x.r, x.slot); continue; }
    if (x.slot === 'alert') x.r.alert = { ...x.r.alert!, attempts }; else x.r.followUp = { ...x.r.followUp!, attempts };
    await save(x.r);
  }
  out.affectedDays = [...affected].sort();
  log({ level: 'info', msg: 'ledger', ...out, affectedDays: out.affectedDays.length });
  return out;
}
