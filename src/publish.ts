import type { DayLog, PublishedDay } from './domain/types.js';
import { redact } from './redact.js';
import type { Store } from './store/store.js';

export async function publishDay(opts: { store: Store; day: string; excludeSessions: string[]; now: Date; dryRun?: boolean; hide?: (texts: string[]) => Promise<string[]> }): Promise<PublishedDay | null> {
  const log = await opts.store.getDay(opts.day);
  if (!log) return null;
  const keep = (id: string) => !opts.excludeSessions.includes(id);
  const sessions = log.sessions.filter(s => keep(s.id)).map(s => ({ ...s, topic: redact(s.topic) }));
  if (sessions.length === 0) { if (!opts.dryRun) await opts.store.deletePublished(opts.day); return null; }
  const pub: PublishedDay = {
    date: log.date,
    summary: redact(log.summary),
    sessions,
    decisions: log.decisions.filter(d => keep(d.sessionId)).map(({ quoteOriginal: _hidden, ...d }) => ({ ...d, what: redact(d.what), why: redact(d.why), quote: redact(d.quote) })),
    todos: log.todos.filter(t => keep(t.sessionId)).map(t => ({ ...t, text: redact(t.text) })),
    openQuestions: log.openQuestions.filter(q => keep(q.sessionId)).map(q => ({ ...q, text: redact(q.text) })),
    commits: log.commits,
    updatedAt: log.updatedAt,
    publishedAt: opts.now.toISOString()
  };
  if (opts.hide) await applyHide(pub, opts.hide);
  if (!opts.dryRun) await opts.store.putPublished(pub);
  return pub;
}

/** Sends every published text through `hide` in one call and puts the results back in the same places. */
async function applyHide(pub: PublishedDay, hide: (texts: string[]) => Promise<string[]>): Promise<void> {
  const slots: [object, string][] = [
    [pub, 'summary'], ...pub.sessions.map(s => [s, 'topic'] as [object, string]),
    ...pub.decisions.flatMap(d => (['what', 'why', 'quote'] as const).map(k => [d, k] as [object, string])),
    ...pub.todos.map(t => [t, 'text'] as [object, string]), ...pub.openQuestions.map(q => [q, 'text'] as [object, string])
  ];
  const before = slots.map(([o, k]) => (o as Record<string, string>)[k]!);
  const after = await hide(before);
  if (after.length !== before.length) return;
  slots.forEach(([o, k], i) => { (o as Record<string, string>)[k] = after[i]!; });
}

export async function unpublishDay(store: Store, day: string): Promise<void> { await store.deletePublished(day); }

export async function forgetSession(opts: { store: Store; sessionId: string; recompile: (day: string) => Promise<DayLog | null> }): Promise<{ day: string | null }> {
  const day = await opts.store.forgetSession(opts.sessionId);
  if (!day) return { day: null };
  const wasPublished = await opts.store.getPublished(day);
  const log = await opts.recompile(day);
  if (wasPublished) {
    if (!log) await opts.store.deletePublished(day);
    else await publishDay({ store: opts.store, day, excludeSessions: [], now: new Date() });
  }
  return { day };
}
