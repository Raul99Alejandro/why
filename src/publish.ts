import type { DayDecision, DayLog, PublishedDay } from './domain/types.js';
import { redact } from './redact.js';
import type { Store } from './store/store.js';

export async function publishDay(opts: { store: Store; day: string; excludeSessions: string[]; now: Date; dryRun?: boolean; hide?: (texts: string[]) => Promise<string[]> }): Promise<PublishedDay | null> {
  const log = await opts.store.getDay(opts.day);
  if (!log) return null;
  const keep = (id: string) => !opts.excludeSessions.includes(id);
  const sessions = log.sessions.filter(s => keep(s.id)).map(s => ({ ...s, topic: redact(s.topic) }));
  if (sessions.length === 0) { if (!opts.dryRun) await opts.store.deletePublished(opts.day); return null; }
  const decisions = log.decisions.filter(d => keep(d.sessionId));
  const referenced = new Set(decisions.flatMap(d => d.commits));
  const pub: PublishedDay = {
    date: log.date,
    summary: redact(log.summary),
    sessions,
    decisions: decisions.map(({ quoteOriginal: _hidden, ...d }) => withLinks({ ...d, what: redact(d.what), why: redact(d.why), quote: redact(d.quote) }, keep)),
    todos: log.todos.filter(t => keep(t.sessionId)).map(t => ({ ...t, text: redact(t.text) })),
    openQuestions: log.openQuestions.filter(q => keep(q.sessionId)).map(q => ({ ...q, text: redact(q.text) })),
    commits: log.commits.filter(c => referenced.has(c.sha)).map(c => ({ ...c, message: redact(c.message) })),
    ...(log.ignoredPersonal ? { ignoredPersonal: log.ignoredPersonal } : {}),
    updatedAt: log.updatedAt,
    publishedAt: opts.now.toISOString()
  };
  if (opts.hide) await applyHide(pub, opts.hide);
  mapSlots(pub, redact); // the guarantee must not depend on `hide`
  if (!opts.dryRun) await opts.store.putPublished(pub);
  return pub;
}

/** Texts that came from other decisions (the old side of a change, a follow-up step) are cleaned like the rest; an excluded session never shows through a link. */
function withLinks<T extends Omit<DayDecision, 'quoteOriginal'>>(d: T, keep: (sessionId: string) => boolean): T {
  const out: T = { ...d };
  if (d.change) {
    const from = d.change.from.filter(f => keep(f.sessionId)).map(f => ({ ...f, what: redact(f.what) }));
    if (from.length && from[0]!.id === d.change.from[0]!.id) out.change = { from, commits: d.change.commits.map(c => ({ ...c, message: redact(c.message) })) };
    else delete out.change;
  }
  const owner = (id: string) => id.slice(0, id.lastIndexOf('#'));
  if (d.changedLater && !keep(owner(d.changedLater.id))) delete out.changedLater;
  if (d.refines && !keep(owner(d.refines.id))) delete out.refines;
  if (d.followUp) out.followUp = { ...d.followUp, text: redact(d.followUp.text), ...(d.followUp.closedBy ? { closedBy: { ...d.followUp.closedBy, message: redact(d.followUp.closedBy.message) } } : {}) };
  return out;
}

function slotsOf(pub: PublishedDay): [object, string][] {
  return [
    [pub, 'summary'], ...pub.sessions.map(s => [s, 'topic'] as [object, string]),
    ...pub.decisions.flatMap(d => (['what', 'why', 'quote'] as const).map(k => [d, k] as [object, string])),
    ...pub.decisions.flatMap(d => [
      ...(d.change?.from ?? []).map(f => [f, 'what'] as [object, string]), ...(d.change?.commits ?? []).map(c => [c, 'message'] as [object, string]),
      ...(d.followUp ? [[d.followUp, 'text'] as [object, string]] : [])
    ]),
    ...pub.todos.map(t => [t, 'text'] as [object, string]), ...pub.openQuestions.map(q => [q, 'text'] as [object, string]),
    ...pub.commits.map(c => [c, 'message'] as [object, string])
  ];
}

/** Applies a text function to every published text in place. */
function mapSlots(pub: PublishedDay, fn: (t: string) => string): void {
  for (const [o, k] of slotsOf(pub)) (o as Record<string, string>)[k] = fn((o as Record<string, string>)[k]!);
}

/** Sends every published text through `hide` in one call and puts the results back in the same places. */
async function applyHide(pub: PublishedDay, hide: (texts: string[]) => Promise<string[]>): Promise<void> {
  const slots = slotsOf(pub);
  const before = slots.map(([o, k]) => (o as Record<string, string>)[k]!);
  const after = await hide(before);
  if (after.length !== before.length) return;
  slots.forEach(([o, k], i) => { (o as Record<string, string>)[k] = after[i]!; });
}

export async function unpublishDay(store: Store, day: string): Promise<void> { await store.deletePublished(day); }

/** Forgets a session. The public copy is never rebuilt from the private log: the existing one is filtered, so earlier exclusions and name review stay in force. */
export async function forgetSession(opts: { store: Store; sessionId: string; recompile: (day: string) => Promise<DayLog | null> }): Promise<{ day: string | null }> {
  const day = await opts.store.forgetSession(opts.sessionId);
  if (!day) return { day: null };
  await scrubLinks(opts.store, opts.sessionId);
  const published = await opts.store.getPublished(day);
  await opts.recompile(day);
  if (published) {
    const sessions = published.sessions.filter(s => s.id !== opts.sessionId);
    if (sessions.length === 0) await opts.store.deletePublished(day);
    else {
      const decisions = published.decisions.filter(d => d.sessionId !== opts.sessionId);
      const referenced = new Set(decisions.flatMap(d => d.commits));
      await opts.store.putPublished({
        ...published, sessions, decisions,
        summary: sessions.map(s => s.topic).join(' · '),
        todos: published.todos.filter(t => t.sessionId !== opts.sessionId),
        openQuestions: published.openQuestions.filter(q => q.sessionId !== opts.sessionId),
        commits: published.commits.filter(c => referenced.has(c.sha))
      });
    }
  }
  return { day };
}

/** Removes every link to a forgotten session (text of its decisions and its ids) from the other days, private and published, without rebuilding them. */
async function scrubLinks(store: Store, sessionId: string): Promise<void> {
  const mine = (id: string) => id.startsWith(`${sessionId}#`);
  const scrub = <T extends Pick<DayDecision, 'change' | 'changedLater' | 'refines'>>(d: T): T => {
    const out: T = { ...d };
    if (d.change) {
      const cut = d.change.from.findIndex(f => f.sessionId === sessionId);
      const from = cut < 0 ? d.change.from : d.change.from.slice(0, cut);
      if (cut === 0 || from.length === 0) delete out.change; else if (cut > 0) out.change = { ...d.change, from };
    }
    if (d.changedLater && mine(d.changedLater.id)) delete out.changedLater;
    if (d.refines && mine(d.refines.id)) delete out.refines;
    return out;
  };
  for (const date of await store.listDays()) {
    const log = await store.getDay(date);
    if (log && log.decisions.some(d => d.change || d.changedLater || d.refines)) await store.putDay({ ...log, decisions: log.decisions.map(scrub) });
  }
  for (const date of await store.listPublished()) {
    const pub = await store.getPublished(date);
    if (pub && pub.decisions.some(d => d.change || d.changedLater || d.refines)) await store.putPublished({ ...pub, decisions: pub.decisions.map(scrub) });
  }
}
