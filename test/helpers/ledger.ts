import { compileDay } from '../../src/compile.js';
import { decisionIds, reconcile, type LedgerResult } from '../../src/ledger.js';
import { publishDay, forgetSession } from '../../src/publish.js';
import { runSync } from '../../src/runtime.js';
import { MemoryStore } from '../../src/store/memory.js';
import type { Store } from '../../src/store/store.js';
import { fakeModel, FakeTodos } from './fakes.js';

export const TZ = 'America/Mexico_City';
export const NOW = new Date('2026-10-06T18:00:00.000Z'); // noon in Mexico City
export const FRESH = '2026-10-06T17:00:00.000Z';

export type Seed = { id: string; day: string; at: string; topic?: string; decisions: { what: string; why?: string; at?: string }[] };
export async function seed(store: Store, s: Seed) {
  await store.putSession({ id: s.id, startedAt: s.at, endedAt: s.at, utterances: [{ speaker: 'Unknown', text: 'private words that must not travel' }] }, s.day, 9e9);
  await store.setAnalysis(s.id, {
    topic: s.topic ?? 'Answers model', summary: 's',
    decisions: s.decisions.map(d => ({ what: d.what, why: d.why ?? 'No reason given', quote: `quote of ${d.what}`, quoteOriginal: 'original', at: d.at ?? s.at })),
    todos: [], openQuestions: []
  }, 'analyzed');
}

export type Verdict = { relation: string; prior?: string; nextStep?: string };
/** Judge fake: verdicts keyed by the text of the current decision; the prior is named by its text and turned into its label. */
export function judge(verdicts: Record<string, Verdict>, closes: Record<string, string[]> = {}) {
  const calls = { judge: 0, close: 0 };
  const model = fakeModel((tool, _system, user) => {
    if (tool === 'save_closing_commits') {
      calls.close++;
      const step = /<step>(.*?) \(from the decision:/s.exec(user)![1]!;
      const shas = [...user.matchAll(/<commit sha="([^"]+)">([^<]*)<\/commit>/g)].filter(m => (closes[step] ?? []).some(k => m[2]!.includes(k))).map(m => m[1]);
      return { commits: shas };
    }
    if (tool === 'save_judgement') {
      calls.judge++;
      const current = /<current>(.*?) \(reason:/s.exec(user)![1]!;
      const v = verdicts[current] ?? { relation: 'unrelated' };
      const label = v.prior ? [...user.matchAll(/<prior label="(P\d+)"[^>]*>([^<]*)<\/prior>/g)].find(m => m[2] === v.prior)?.[1] ?? '' : '';
      return { relation: v.relation, priorId: label, nextStep: v.nextStep ?? '' };
    }
    if (tool === 'save_day_summary') return { summary: 'A day.' };
    return { links: [] };
  });
  return { model, calls };
}

export const id = (sessionId: string, what: string) => decisionIds(sessionId, [{ what }])[0]!;
export const run = (store: Store, model: ReturnType<typeof judge>['model'], days: string[], todos?: FakeTodos, extra: Record<string, unknown> = {}) =>
  reconcile({ store, converse: model, ...(todos ? { todos } : {}), repos: [], timeZone: TZ, now: NOW, days, ...extra });

export const commitFetch = (commits: { sha: string; message: string; date: string }[]) =>
  (async () => new Response(JSON.stringify(commits.map(c => ({ sha: `${c.sha}0000`, html_url: `https://github.com/o/r/commit/${c.sha}`, commit: { message: c.message, author: { date: c.date } } }))), { status: 200 })) as typeof fetch;

