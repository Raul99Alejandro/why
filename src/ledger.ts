import type { Analysis, CommitRef } from './domain/types.js';
import { localDay } from './domain/dates.js';
import type { BeeTodos } from './bee/todos.js';
import { commitsSince } from './github.js';
import { log } from './log.js';
import type { ConverseFn } from './nova.js';
import { alertText, closingCommit, followUpText, judgeDecision, raisesAlert, type Candidate } from './relate.js';
import type { DecisionRecord, SessionRecord, Store } from './store/store.js';

export const WINDOW_DAYS = 30;
/** Decisions older than this are linked on the page but never alert or create todos (nothing to act on, and no Bee flood on a first run). */
export const FRESH_MS = 24 * 3_600_000;
export const ALERT_DELAY_MS = 10 * 60_000;
const MAX_CANDIDATES = 40;
const MAX_CHECKED = 200;

export type LedgerResult = {
  judged: number; judgeFailed: number;
  reversals: number; refinements: number; restatements: number;
  alertsCreated: number; followUpsCreated: number; followUpsClosed: number;
  beeFailed: number;
  /** Days whose log must be rebuilt: the day of each new link, the day it points to, the day of a changed follow-up. */
  affectedDays: string[];
};

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const windowDays = (today: string, n = WINDOW_DAYS): string[] => Array.from({ length: n + 1 }, (_, i) => addDays(today, -i)).reverse();
export const decisionId = (sessionId: string, index: number): string => `${sessionId}#${index}`;
const indexOf = (id: string): number => Number(id.slice(id.lastIndexOf('#') + 1));

/** The decision's own time as ISO (the model's `at` when valid, otherwise the session start). */
function normAt(at: string, fallback: string): string {
  const t = Date.parse(at);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/**
 * After sessions are analyzed: judges each not-yet-judged decision of `days` against the last 30 days (reversal / refinement /
 * restatement / unrelated), stores the links, then performs the Bee writes that are still due (alerts, follow-up todos, completions)
 * and closes follow-ups that a new commit carries out. Safe to run every 5 minutes: everything is keyed by decision id.
 * Bee being unreachable never throws; the writes stay pending and are retried on the next run.
 */
export async function reconcile(deps: {
  store: Store; converse: ConverseFn; todos?: BeeTodos; repos: string[]; timeZone: string; now: Date; fetchFn?: typeof fetch;
  days: string[]; maxTodosPerRun?: number;
}): Promise<LedgerResult> {
  const { store, converse, todos, now } = deps;
  const today = localDay(now.toISOString(), deps.timeZone);
  const out: LedgerResult = { judged: 0, judgeFailed: 0, reversals: 0, refinements: 0, restatements: 0, alertsCreated: 0, followUpsCreated: 0, followUpsClosed: 0, beeFailed: 0, affectedDays: [] };
  const affected = new Set<string>();
  const records = new Map<string, DecisionRecord>();
  for (const dayRecords of await Promise.all(windowDays(today).map(d => store.listDecisionRecords(d)))) {
    for (const r of dayRecords) records.set(r.id, r);
  }
  const sessions = new Map<string, SessionRecord | null>();
  const session = async (id: string) => { if (!sessions.has(id)) sessions.set(id, await store.getSession(id)); return sessions.get(id)!; };
  const textOf = async (r: DecisionRecord): Promise<{ what: string; why: string; topic: string } | null> => {
    const s = await session(r.sessionId);
    const d = s?.analysis?.decisions[indexOf(r.id)];
    return s?.analysis && d ? { what: d.what, why: d.why, topic: s.analysis.topic } : null;
  };

  // 1. Judge new decisions, oldest first, so a decision can be compared with ones found in the same run.
  type Fresh = { id: string; sessionId: string; day: string; at: string; what: string; why: string };
  const fresh: Fresh[] = [];
  for (const day of [...new Set(deps.days)].sort()) {
    for (const rec of await store.listSessionsOn(day)) {
      sessions.set(rec.session.id, rec);
      (rec.analysis as Analysis | null)?.decisions.forEach((d, i) => {
        const id = decisionId(rec.session.id, i);
        if (!records.has(id)) fresh.push({ id, sessionId: rec.session.id, day, at: normAt(d.at, rec.session.startedAt), what: d.what, why: d.why });
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
    const rec: DecisionRecord = { id: f.id, sessionId: f.sessionId, day: f.day, at: f.at };
    const target = candidates.find(c => c.id === j.priorId)?.rec;
    if (j.relation !== 'unrelated' && target) {
      rec.relation = { kind: j.relation, priorId: target.id, priorDay: target.day };
      affected.add(f.day); affected.add(target.day);
      if (j.relation === 'reversal') out.reversals++; else if (j.relation === 'refinement') out.refinements++; else out.restatements++;
      if (raisesAlert(j.relation)) rec.alert = { state: isFresh ? 'pending' : 'skipped' };
    }
    // The same step already tracked (a decision repeated in another session that the judge did not call a restatement) gets no second todo.
    const step = j.nextStep && isFresh ? followUpText(j.nextStep) : '';
    const duplicate = step && [...records.values()].some(r => r.followUp && r.followUp.state !== 'closed' && r.followUp.text.toLowerCase() === step.toLowerCase());
    if (step && !duplicate) rec.followUp = { state: 'pending', text: step, checked: [] };
    records.set(rec.id, rec);
    await store.putDecisionRecord(rec);
    affected.add(f.day);
  }

  // 2. Bee writes that are due. The first failure stops them for this run (Bee is offline or signed out); they stay pending.
  let beeDown = false;
  let budget = deps.maxTodosPerRun ?? 8;
  const bee = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (!todos || beeDown) return undefined;
    try { return await fn(); } catch (err) {
      beeDown = true; out.beeFailed++;
      log({ level: 'warn', msg: 'bee_todo_failed', action: what, error: (err as Error).name }); // never the CLI's output
      return undefined;
    }
  };
  const ordered = [...records.values()].sort((a, b) => a.at.localeCompare(b.at));
  for (const r of ordered) {
    if (r.alert?.state === 'pending' && r.relation && budget > 0) {
      const t = await textOf(r);
      const old = records.get(r.relation.priorId);
      const was = old ? await textOf(old) : null;
      if (!t || !was) { r.alert = { state: 'skipped' }; await store.putDecisionRecord(r); continue; } // a side was forgotten: nothing left to confirm
      const id = await bee('alert', () => todos!.create(alertText(t.topic, was.what, t.what), new Date(now.getTime() + ALERT_DELAY_MS).toISOString()));
      if (id) { r.alert = { state: 'done', todoId: id }; budget--; out.alertsCreated++; await store.putDecisionRecord(r); }
    }
    if (r.followUp?.state === 'pending' && budget > 0) {
      const id = await bee('follow_up', () => todos!.create(r.followUp!.text));
      if (id) { r.followUp = { ...r.followUp, state: 'open', todoId: id }; budget--; out.followUpsCreated++; await store.putDecisionRecord(r); affected.add(r.day); }
    }
    if (r.followUp?.state === 'closing' && r.followUp.todoId) {
      if (await bee('complete', async () => { await todos!.complete(r.followUp!.todoId!); return true; })) {
        r.followUp = { ...r.followUp, state: 'closed' }; out.followUpsClosed++; await store.putDecisionRecord(r); affected.add(r.day);
      }
    }
  }

  // 3. Close follow-ups that a new commit carries out. Each follow-up is judged on its own, so a commit that serves two decisions closes both only if each passes.
  const open = ordered.filter(r => r.followUp?.state === 'open' && r.followUp.todoId);
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
      if (!verdict.commit) {
        r.followUp = { ...f, checked: [...f.checked, ...unseen.map(c => c.sha)].slice(-MAX_CHECKED) };
        await store.putDecisionRecord(r);
        continue;
      }
      r.followUp = { ...f, state: 'closing', closedBy: verdict.commit, checked: [...f.checked, ...unseen.map(c => c.sha)].slice(-MAX_CHECKED) };
      await store.putDecisionRecord(r);
      affected.add(r.day);
      if (await bee('complete', async () => { await todos.complete(f.todoId!); return true; })) {
        r.followUp = { ...r.followUp, state: 'closed' }; out.followUpsClosed++; await store.putDecisionRecord(r);
      }
    }
  }
  out.affectedDays = [...affected].sort();
  log({ level: 'info', msg: 'ledger', ...out, affectedDays: out.affectedDays.length });
  return out;
}
