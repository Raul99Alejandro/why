import { describe, expect, it } from 'vitest';
import { compileDay } from '../src/compile.js';
import { reconcile, type LedgerResult } from '../src/ledger.js';
import { publishDay, forgetSession } from '../src/publish.js';
import { runSync } from '../src/runtime.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/store.js';
import { fakeModel, FakeTodos } from './helpers/fakes.js';

const TZ = 'America/Mexico_City';
const NOW = new Date('2026-10-06T18:00:00.000Z'); // noon in Mexico City
const FRESH = '2026-10-06T17:00:00.000Z';

type Seed = { id: string; day: string; at: string; topic?: string; decisions: { what: string; why?: string; at?: string }[] };
async function seed(store: Store, s: Seed) {
  await store.putSession({ id: s.id, startedAt: s.at, endedAt: s.at, utterances: [{ speaker: 'Unknown', text: 'private words that must not travel' }] }, s.day, 9e9);
  await store.setAnalysis(s.id, {
    topic: s.topic ?? 'Answers model', summary: 's',
    decisions: s.decisions.map(d => ({ what: d.what, why: d.why ?? 'No reason given', quote: `quote of ${d.what}`, quoteOriginal: 'original', at: d.at ?? s.at })),
    todos: [], openQuestions: []
  }, 'analyzed');
}

type Verdict = { relation: string; prior?: string; nextStep?: string };
/** Judge fake: verdicts keyed by the text of the current decision; the prior is named by its text and turned into its label. */
function judge(verdicts: Record<string, Verdict>, closes: Record<string, string[]> = {}) {
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

const run = (store: Store, model: ReturnType<typeof judge>['model'], days: string[], todos?: FakeTodos, extra: Record<string, unknown> = {}) =>
  reconcile({ store, converse: model, ...(todos ? { todos } : {}), repos: [], timeZone: TZ, now: NOW, days, ...extra });

const commitFetch = (commits: { sha: string; message: string; date: string }[]) =>
  (async () => new Response(JSON.stringify(commits.map(c => ({ sha: `${c.sha}0000`, html_url: `https://github.com/o/r/commit/${c.sha}`, commit: { message: c.message, author: { date: c.date } } }))), { status: 200 })) as typeof fetch;

describe('reversal detection (W-02)', () => {
  it('links a direct contradiction, alerts once in Bee with a 10 minute alarm, and never again', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-03', at: '2026-10-03T16:00:00.000Z', decisions: [{ what: 'Use Nova for the answers' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Claude Sonnet for the answers' }] });
    const { model, calls } = judge({ 'Use Claude Sonnet for the answers': { relation: 'reversal', prior: 'Use Nova for the answers' } });
    const r = await run(store, model, ['2026-10-03', '2026-10-06'], todos);
    expect(r).toMatchObject({ judged: 2, reversals: 1, alertsCreated: 1, beeFailed: 0 });
    expect(r.affectedDays).toEqual(['2026-10-03', '2026-10-06']);
    expect(todos.created).toHaveLength(1);
    const t = todos.created[0]!;
    expect(t.text).toBe('You changed your mind about Answers model: Use Nova for the answers → Use Claude Sonnet for the answers. Confirm?');
    expect(t.text.length).toBeLessThanOrEqual(120);
    expect(t.alarmAt).toBe('2026-10-06T18:10:00.000Z');
    expect(JSON.stringify(todos.created)).not.toMatch(/quote of|private words/);
    expect((await store.listDecisionRecords('2026-10-06'))[0]).toMatchObject({ relation: { kind: 'reversal', priorId: 's1#0', priorDay: '2026-10-03' }, alert: { state: 'done', todoId: 't1' } });
    const again = await run(store, model, ['2026-10-03', '2026-10-06'], todos);
    expect(again).toMatchObject({ judged: 0, alertsCreated: 0 });
    expect(todos.created).toHaveLength(1);
    expect(calls.judge).toBe(2);
  });

  it('keeps long wording inside 120 characters', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    const long = (w: string) => `${w} ${'the whole answering pipeline and every single prompt '.repeat(5)}`;
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', topic: 'A very long topic name that goes on', decisions: [{ what: long('Use Nova for') }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, topic: 'A very long topic name that goes on', decisions: [{ what: long('Use Sonnet for') }] });
    const { model } = judge({ [long('Use Sonnet for')]: { relation: 'reversal', prior: long('Use Nova for') } });
    await run(store, model, ['2026-10-05', '2026-10-06'], todos);
    expect(todos.created[0]!.text.length).toBeLessThanOrEqual(120);
    expect(todos.created[0]!.text).toMatch(/^You changed your mind about .*: .* → .*\. Confirm\?$/);
  });

  it('links a refinement without an alert', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', decisions: [{ what: 'Use Nova for the answers' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Nova with reasoning turned on' }] });
    const { model } = judge({ 'Use Nova with reasoning turned on': { relation: 'refinement', prior: 'Use Nova for the answers' } });
    const r = await run(store, model, ['2026-10-05', '2026-10-06'], todos);
    expect(r).toMatchObject({ refinements: 1, reversals: 0, alertsCreated: 0 });
    expect(todos.created).toHaveLength(0);
    const rec = (await store.listDecisionRecords('2026-10-06'))[0]!;
    expect(rec.relation).toMatchObject({ kind: 'refinement', priorId: 's1#0' });
    expect(rec.alert).toBeUndefined();
  });

  it('review focus 2: a restatement is neither a reversal nor a second todo', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', decisions: [{ what: 'Ship the demo video on Friday' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'As we said, the demo video ships Friday' }] });
    const { model } = judge({
      'Ship the demo video on Friday': { relation: 'unrelated', nextStep: 'Ship the demo video on Friday' },
      'As we said, the demo video ships Friday': { relation: 'restatement', prior: 'Ship the demo video on Friday', nextStep: 'Ship the demo video on Friday' }
    });
    const r = await run(store, model, ['2026-10-05', '2026-10-06'], todos);
    expect(r).toMatchObject({ restatements: 1, reversals: 0 });
    expect(todos.created.map(t => t.text)).toEqual(['Ship the demo video on Friday']); // the original only; the restatement adds none
    expect((await store.listDecisionRecords('2026-10-06'))[0]!.followUp).toBeUndefined();
  });

  it('does not create a second todo for the same step when the judge misses the restatement', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: '2026-10-06T15:00:00.000Z', decisions: [{ what: 'Ship the demo video on Friday' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'The demo video goes out Friday' }] });
    const { model } = judge({
      'Ship the demo video on Friday': { relation: 'unrelated', nextStep: 'Ship the demo video on Friday' },
      'The demo video goes out Friday': { relation: 'unrelated', nextStep: 'ship the demo video on friday' }
    });
    await run(store, model, ['2026-10-06'], todos);
    expect(todos.created).toHaveLength(1);
  });

  it('ignores a relation to an id that was never offered', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', decisions: [{ what: 'Use Nova for the answers' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Claude Sonnet for the answers' }] });
    const model = fakeModel(() => ({ relation: 'reversal', priorId: 'P9', nextStep: '' }));
    const r = await run(store, model, ['2026-10-05', '2026-10-06'], todos);
    expect(r.reversals).toBe(0);
    expect(todos.created).toHaveLength(0);
  });

  it('review focus 4: A -> B -> A keeps both steps readable, with the old commits', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 'a1', day: '2026-10-01', at: '2026-10-01T20:00:00.000Z', decisions: [{ what: 'Use Nova' }] });
    await seed(store, { id: 'b', day: '2026-10-03', at: '2026-10-03T20:00:00.000Z', decisions: [{ what: 'Use Claude Sonnet' }] });
    await seed(store, { id: 'a2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Nova again' }] });
    const { model } = judge({
      'Use Claude Sonnet': { relation: 'reversal', prior: 'Use Nova' },
      'Use Nova again': { relation: 'reversal', prior: 'Use Claude Sonnet' }
    });
    const days = ['2026-10-01', '2026-10-03', '2026-10-06'];
    const r = await run(store, model, days, todos);
    expect(r.reversals).toBe(2);
    // Day 1 is the only one with a commit (the fetch answers the same list for every day; only 10-01 matches its local day).
    const linkModel = fakeModel((tool, _s, user) => tool === 'save_commit_links' ? { links: [{ decision: 0, commits: [/commit_sha_(\w+)/.exec(user)?.[1] ?? /(abc1234)/.exec(user)![1]] }] } : { summary: 'A day.' });
    const fetchFn = commitFetch([{ sha: 'abc1234', message: 'feat: use Nova', date: '2026-10-01T21:00:00Z' }]);
    for (const day of days) await compileDay({ day, store, converse: linkModel, repos: ['o/r'], timeZone: TZ, now: NOW, fetchFn });
    const d1 = (await store.getDay('2026-10-01'))!.decisions[0]!;
    const d2 = (await store.getDay('2026-10-03'))!.decisions[0]!;
    const d3 = (await store.getDay('2026-10-06'))!.decisions[0]!;
    expect(d3.change!.from.map(f => [f.date, f.what])).toEqual([['2026-10-03', 'Use Claude Sonnet'], ['2026-10-01', 'Use Nova']]);
    expect(d2.change!.from.map(f => f.date)).toEqual(['2026-10-01']);
    expect(d2.change!.commits.map(c => c.sha)).toEqual(['abc1234']); // work that may need undoing
    expect(d1.changedLater).toMatchObject({ date: '2026-10-03' });
    expect(d2.changedLater).toMatchObject({ date: '2026-10-06' });
    expect(d1.change).toBeUndefined();
  });

  it('only links old decisions (no alert, no todo) so a first run cannot flood Bee', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-01', at: '2026-10-01T20:00:00.000Z', decisions: [{ what: 'Use Nova' }] });
    await seed(store, { id: 's2', day: '2026-10-02', at: '2026-10-02T20:00:00.000Z', decisions: [{ what: 'Use Sonnet', at: '2026-10-02T20:00:00.000Z' }] });
    const { model } = judge({ 'Use Sonnet': { relation: 'reversal', prior: 'Use Nova', nextStep: 'Switch the answers to Sonnet' } });
    const r = await run(store, model, ['2026-10-01', '2026-10-02'], todos);
    expect(r).toMatchObject({ reversals: 1, alertsCreated: 0, followUpsCreated: 0 });
    expect(todos.calls).toBe(0);
    expect((await store.listDecisionRecords('2026-10-02'))[0]).toMatchObject({ relation: { kind: 'reversal' }, alert: { state: 'skipped' } });
  });
});

describe('Bee todos', () => {
  it('review focus 3: Bee offline never throws, stops after the first failure, and retries next run', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos(); todos.offline = true;
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }, { what: 'Write the README' }] });
    const { model, calls } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' }, 'Write the README': { relation: 'unrelated', nextStep: 'Write the README' } });
    const first = await run(store, model, ['2026-10-06'], todos);
    expect(first).toMatchObject({ judged: 2, beeFailed: 1, followUpsCreated: 0 });
    expect(todos.calls).toBe(1);
    todos.offline = false;
    const second = await run(store, model, [], todos);
    expect(second).toMatchObject({ judged: 0, followUpsCreated: 2, beeFailed: 0 });
    expect(todos.created.map(t => t.text)).toEqual(['Record the demo', 'Write the README']);
    expect(calls.judge).toBe(2);
    expect((await run(store, model, [], todos)).followUpsCreated).toBe(0);
  });

  it('keeps links and todos pending without a Bee adapter (cloud sync)', async () => {
    const store = new MemoryStore();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    const { model } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' } });
    await run(store, model, ['2026-10-06']);
    expect((await store.listDecisionRecords('2026-10-06'))[0]!.followUp).toMatchObject({ state: 'pending', text: 'Record the demo' });
  });

  it('retries a decision whose judging failed', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    let fail = true;
    const model = fakeModel(() => { if (fail) throw new Error('throttled'); return { relation: 'unrelated', priorId: '', nextStep: 'Record the demo' }; });
    expect(await run(store, model, ['2026-10-06'], todos)).toMatchObject({ judged: 0, judgeFailed: 1 });
    fail = false;
    expect(await run(store, model, ['2026-10-06'], todos)).toMatchObject({ judged: 1, followUpsCreated: 1 });
  });
});

describe('follow-ups close on commits (W-03)', () => {
  async function twoDecisions() {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Add a work filter' }, { what: 'Sync every 5 minutes' }] });
    return { store, todos };
  }
  const steps = { 'Add a work filter': { relation: 'unrelated', nextStep: 'Add a work filter' }, 'Sync every 5 minutes': { relation: 'unrelated', nextStep: 'Sync every 5 minutes' } };
  const commit = commitFetch([{ sha: 'c0ffee1', message: 'feat: work filter and 5-minute sync', date: '2026-10-06T17:30:00Z' }]);

  it('review focus 5: one commit for two decisions closes both only if each passes', async () => {
    const both = await twoDecisions();
    const j1 = judge(steps, { 'Add a work filter': ['work filter'], 'Sync every 5 minutes': ['5-minute sync'] });
    await run(both.store, j1.model, ['2026-10-06'], both.todos, { repos: ['o/r'], fetchFn: commit });
    expect(both.todos.completed.sort()).toEqual(['t1', 't2']);

    const one = await twoDecisions();
    const j2 = judge(steps, { 'Add a work filter': ['work filter'] }); // the second judgement says no
    const r = await run(one.store, j2.model, ['2026-10-06'], one.todos, { repos: ['o/r'], fetchFn: commit });
    expect(r.followUpsClosed).toBe(1);
    expect(one.todos.completed).toEqual(['t1']);
    const recs = await one.store.listDecisionRecords('2026-10-06');
    expect(recs.map(x => x.followUp!.state).sort()).toEqual(['closed', 'open']);
  });

  it('judges a commit once per follow-up, ignores older commits, and shows closed on the page data', async () => {
    const { store, todos } = await twoDecisions();
    const j = judge(steps, {});
    const old = commitFetch([{ sha: 'dead001', message: 'feat: work filter', date: '2026-10-06T16:00:00Z' }]); // before the decision
    await run(store, j.model, ['2026-10-06'], todos, { repos: ['o/r'], fetchFn: old });
    expect(j.calls.close).toBe(0);
    await run(store, j.model, [], todos, { repos: ['o/r'], fetchFn: commit });
    expect(j.calls.close).toBe(2);
    await run(store, j.model, [], todos, { repos: ['o/r'], fetchFn: commit });
    expect(j.calls.close).toBe(2); // already checked

    const j2 = judge(steps, { 'Add a work filter': ['work filter'] });
    const s2 = await twoDecisions();
    await run(s2.store, j2.model, ['2026-10-06'], s2.todos, { repos: ['o/r'], fetchFn: commit });
    const day = await compileDay({ day: '2026-10-06', store: s2.store, converse: j2.model, repos: ['o/r'], timeZone: TZ, now: NOW, fetchFn: commit });
    expect(day!.decisions.map(d => d.followUp)).toEqual([
      expect.objectContaining({ status: 'closed', text: 'Add a work filter', closedBy: expect.objectContaining({ sha: 'c0ffee1' }) }),
      { text: 'Sync every 5 minutes', status: 'open' }
    ]);
  });

  it('retries the Bee completion when it failed after the commit matched', async () => {
    const { store, todos } = await twoDecisions();
    const j = judge(steps, { 'Add a work filter': ['work filter'] });
    await run(store, j.model, ['2026-10-06'], todos, { repos: ['o/r'], fetchFn: commitFetch([]) });
    todos.offline = true;
    const r1 = await run(store, j.model, [], todos, { repos: ['o/r'], fetchFn: commit });
    expect(r1).toMatchObject({ followUpsClosed: 0, beeFailed: 1 });
    expect((await store.listDecisionRecords('2026-10-06')).map(x => x.followUp!.state).sort()).toEqual(['closing', 'open']);
    todos.offline = false;
    const r2 = await run(store, j.model, [], todos, { repos: ['o/r'], fetchFn: commit });
    expect(r2.followUpsClosed).toBe(1);
    expect(todos.completed).toEqual(['t1']);
  });
});

describe('forgetting a session', () => {
  it('removes its records and every link to it, in private and published days', async () => {
    const store = new MemoryStore();
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', decisions: [{ what: 'Use Nova' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Sonnet' }] });
    const { model } = judge({ 'Use Sonnet': { relation: 'reversal', prior: 'Use Nova' } });
    await run(store, model, ['2026-10-05', '2026-10-06']);
    const compile = (day: string) => compileDay({ day, store, converse: model, repos: [], timeZone: TZ, now: NOW });
    await compile('2026-10-05'); await compile('2026-10-06');
    await publishDay({ store, day: '2026-10-06', excludeSessions: [], now: NOW });
    expect((await store.getPublished('2026-10-06'))!.decisions[0]!.change!.from[0]!.what).toBe('Use Nova');
    await forgetSession({ store, sessionId: 's1', recompile: compile });
    expect(await store.listDecisionRecords('2026-10-05')).toEqual([]);
    expect((await store.getDay('2026-10-06'))!.decisions[0]!.change).toBeUndefined();
    expect((await store.getPublished('2026-10-06'))!.decisions[0]!.change).toBeUndefined();
    expect(JSON.stringify(await store.getDay('2026-10-06'))).not.toContain('Use Nova');
  });

  it('never publishes the old side of a change from an excluded session', async () => {
    const store = new MemoryStore();
    await seed(store, { id: 's1', day: '2026-10-05', at: '2026-10-05T20:00:00.000Z', decisions: [{ what: 'Use Nova' }] });
    await seed(store, { id: 's2', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Sonnet' }] });
    const { model } = judge({ 'Use Sonnet': { relation: 'reversal', prior: 'Use Nova' } });
    await run(store, model, ['2026-10-05', '2026-10-06']);
    await compileDay({ day: '2026-10-05', store, converse: model, repos: [], timeZone: TZ, now: NOW });
    await compileDay({ day: '2026-10-06', store, converse: model, repos: [], timeZone: TZ, now: NOW });
    const pub = await publishDay({ store, day: '2026-10-06', excludeSessions: ['s1'], now: NOW });
    expect(pub!.decisions[0]!.change).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('Use Nova');
  });
});

describe('runSync wiring', () => {
  it('creates todos and reports counts only, and survives a Bee outage', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos(); todos.offline = true;
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    const { model } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' } });
    const source = { changedSince: async () => ({ ids: [], nextCursor: 'c' }), conversation: async () => { throw new Error('none'); } };
    const deps = { source, store, converse: model, repos: [], timeZone: TZ, now: NOW, todos };
    const out = await runSync(deps);
    expect(out).toMatchObject({ beeFailed: 1, todosCreated: 0 });
    todos.offline = false;
    const out2 = await runSync({ ...deps, now: new Date(NOW.getTime() + 60_000) });
    expect(out2).toMatchObject({ todosCreated: 1, followUpsCreated: 1, beeFailed: 0 });
    expect(JSON.stringify(out2)).not.toContain('Record the demo');
    const day = (await store.getDay('2026-10-06'))!;
    expect(day.decisions[0]!.followUp).toEqual({ text: 'Record the demo', status: 'open' });
  });
});

export type { LedgerResult };
