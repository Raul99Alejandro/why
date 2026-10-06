import { describe, expect, it } from 'vitest';
import { decisionIds } from '../src/ledger.js';
import { runSync } from '../src/runtime.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/store.js';
import { FakeTodos } from './helpers/fakes.js';
import { commitFetch, FRESH, id, judge, NOW, run, seed, TZ, type Verdict } from './helpers/ledger.js';

const recOf = (store: Store, day = '2026-10-06') => store.listDecisionRecords(day);

async function reanalyze(store: Store, sessionId: string, decisions: { what: string }[]) {
  const rec = (await store.getSession(sessionId))!;
  await store.setAnalysis(sessionId, { ...rec.analysis!, decisions: decisions.map(d => ({ what: d.what, why: 'No reason given', quote: 'q', quoteOriginal: 'o', at: FRESH })) }, 'analyzed');
}

describe('crash safety, single writer, poison pills, stable ids', () => {
  it('saves the todo as creating before calling Bee', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    const { model } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' } });
    let seen: unknown;
    todos.beforeCreate = async () => { seen = (await recOf(store))[0]!.followUp; };
    await run(store, model, ['2026-10-06'], todos);
    expect(seen).toMatchObject({ state: 'creating', text: 'Record the demo' });
  });

  it('adopts a todo that Bee already has after a crash, creates one when it has none, and waits when listing fails', async () => {
    const mk = async () => {
      const store = new MemoryStore(); const todos = new FakeTodos();
      await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
      await store.createDecisionRecord({ id: id('s1', 'Record the demo'), sessionId: 's1', day: '2026-10-06', at: FRESH, v: 0, followUp: { state: 'creating', text: 'Record the demo', checked: [] } });
      return { store, todos };
    };
    const { model } = judge({});
    const a = await mk();
    a.todos.created.push({ id: 'b77', text: 'Record the demo' }); // the crash happened after Bee accepted it
    expect(await run(a.store, model, ['2026-10-06'], a.todos)).toMatchObject({ adopted: 1, followUpsCreated: 0 });
    expect(a.todos.created).toHaveLength(1);
    expect((await recOf(a.store))[0]!.followUp).toMatchObject({ state: 'open', todoId: 'b77' });

    const b = await mk();
    expect(await run(b.store, model, ['2026-10-06'], b.todos)).toMatchObject({ adopted: 0, followUpsCreated: 1 });
    expect(b.todos.created).toHaveLength(1);

    const c = await mk(); c.todos.listFails = true;
    await run(c.store, model, ['2026-10-06'], c.todos);
    expect(c.todos.created).toHaveLength(0); // never creates blind
    expect((await recOf(c.store))[0]!.followUp!.state).toBe('creating');
  });

  it('the cloud sync never judges or writes; only the PC sync (ledger: true) does', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    const { model, calls } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' } });
    const source = { changedSince: async () => ({ ids: [], nextCursor: 'c' }), conversation: async () => { throw new Error('none'); } };
    await runSync({ source, store, converse: model, repos: [], timeZone: TZ, now: NOW, todos });
    expect(calls.judge).toBe(0); expect(todos.calls).toBe(0); expect(await recOf(store)).toEqual([]);
  });

  it('survives a second writer: records are created once and a lost race is skipped', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    const { model } = judge({ 'Record the demo': { relation: 'unrelated', nextStep: 'Record the demo' } });
    // The other writer changes the record while ours is talking to Bee.
    todos.beforeCreate = async () => { const r = (await recOf(store))[0]!; await store.saveDecisionRecord({ ...r, followUp: { ...r.followUp!, attempts: 1 } }); };
    const r = await run(store, model, ['2026-10-06'], todos);
    expect(r.conflicts).toBe(1);
    expect(r.followUpsCreated).toBe(0);
    expect(await store.createDecisionRecord({ id: id('s1', 'Record the demo'), sessionId: 's1', day: '2026-10-06', at: FRESH, v: 0 })).toBe(false);
  });

  it('gives up on a todo that keeps failing while others work, but never because of an outage', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 'bad', day: '2026-10-06', at: '2026-10-06T15:00:00.000Z', decisions: [{ what: 'Poison step' }] });
    const verdicts: Record<string, Verdict> = { 'Poison step': { relation: 'unrelated', nextStep: 'Poison step' } };
    todos.failTexts.add('Poison step');
    const { model } = judge(verdicts);
    todos.offline = true;
    for (let i = 0; i < 6; i++) await run(store, model, ['2026-10-06'], todos);
    todos.offline = false;
    expect((await recOf(store))[0]!.followUp!.state).toBe('creating'); // an outage used no tries
    for (let i = 1; i <= 5; i++) {
      verdicts[`Good step ${i}`] = { relation: 'unrelated', nextStep: `Good step number ${i} alpha${i}` };
      await seed(store, { id: `ok${i}`, day: '2026-10-06', at: `2026-10-06T16:0${i}:00.000Z`, decisions: [{ what: `Good step ${i}` }] });
      await run(store, model, ['2026-10-06'], todos);
    }
    expect((await recOf(store)).find(r => r.sessionId === 'bad')!.followUp!.state).toBe('gone');
    expect(todos.created).toHaveLength(5);
    const calls = todos.calls;
    await run(store, model, [], todos);
    expect(todos.calls).toBe(calls); // nothing left to try
  });

  it('marks a follow-up gone when Bee says the todo no longer exists', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Add a work filter' }] });
    const { model } = judge({ 'Add a work filter': { relation: 'unrelated', nextStep: 'Add a work filter' } }, { 'Add a work filter': ['work filter'] });
    await run(store, model, ['2026-10-06'], todos, { repos: ['o/r'], fetchFn: commitFetch([]) });
    todos.missing.add('t1');
    const r = await run(store, model, [], todos, { repos: ['o/r'], fetchFn: commitFetch([{ sha: 'c0ffee1', message: 'feat: work filter', date: '2026-10-06T17:30:00Z' }]) });
    expect(r.gone).toBe(1);
    expect((await recOf(store))[0]!.followUp!.state).toBe('gone');
  });

  it('skips an alert that became too old before it was sent', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-04', at: '2026-10-04T20:00:00.000Z', decisions: [{ what: 'Use Nova' }] });
    await seed(store, { id: 's2', day: '2026-10-04', at: '2026-10-04T21:00:00.000Z', decisions: [{ what: 'Use Sonnet' }] });
    await store.createDecisionRecord({ id: id('s2', 'Use Sonnet'), sessionId: 's2', day: '2026-10-04', at: '2026-10-04T21:00:00.000Z', v: 0,
      relation: { kind: 'reversal', priorId: id('s1', 'Use Nova'), priorDay: '2026-10-04' }, alert: { state: 'pending' } });
    await run(store, judge({}).model, [], todos);
    expect(todos.calls).toBe(0);
    expect((await recOf(store, '2026-10-04'))[0]!.alert!.state).toBe('skipped');
  });

  it('keeps links across a re-analysis with the same wording and drops records of decisions that vanished', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Use Nova' }, { what: 'Ship on Friday' }] });
    const { model, calls } = judge({});
    await run(store, model, ['2026-10-06'], todos);
    expect(calls.judge).toBe(2);
    await reanalyze(store, 's1', [{ what: 'Ship on Friday' }, { what: 'Use Nova with reasoning' }, { what: 'Use Nova' }]);
    const r = await run(store, model, ['2026-10-06'], todos);
    expect(r.judged).toBe(1); // only the reworded one is new
    expect((await recOf(store)).map(x => x.id).sort()).toEqual([id('s1', 'Use Nova'), id('s1', 'Ship on Friday'), id('s1', 'Use Nova with reasoning')].sort());
    await reanalyze(store, 's1', [{ what: 'Use Nova' }]);
    await run(store, model, ['2026-10-06'], todos);
    expect((await recOf(store)).map(x => x.id)).toEqual([id('s1', 'Use Nova')]);
  });

  it('gives the same wording twice in one session two ids', () => {
    expect(new Set(decisionIds('s', [{ what: 'A b' }, { what: 'a  B' }, { what: 'c' }])).size).toBe(3);
  });

  const STEP = 'Record the Alexa demo in the simulator';
  async function withLiveTodo() {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: STEP }] });
    const verdicts: Record<string, Verdict> = { [STEP]: { relation: 'unrelated', nextStep: STEP } };
    const j = judge(verdicts);
    await run(store, j.model, ['2026-10-06'], todos);
    expect((await recOf(store))[0]!.followUp).toMatchObject({ state: 'open', todoId: 't1' });
    return { store, todos, verdicts, j };
  }

  it('a reworded decision keeps its one live todo', async () => {
    const { store, todos, j } = await withLiveTodo();
    await reanalyze(store, 's1', [{ what: `${STEP} tomorrow` }]);
    const r = await run(store, j.model, ['2026-10-06'], todos);
    expect(r.judged).toBe(0);
    const recs = await recOf(store);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ id: id('s1', `${STEP} tomorrow`), followUp: { state: 'open', todoId: 't1' } });
    expect(todos.created).toHaveLength(1);
    expect(todos.completed).toEqual([]);
  });

  it('a vanished decision never loses its live todo: it is completed in Bee, and meanwhile counts as a duplicate', async () => {
    const { store, todos, verdicts, j } = await withLiveTodo();
    verdicts['Something else'] = { relation: 'unrelated', nextStep: 'Record the Alexa demo in the simulator today' };
    await reanalyze(store, 's1', [{ what: 'Something else' }]);
    todos.offline = true;
    await run(store, j.model, ['2026-10-06'], todos);
    const held = await recOf(store);
    expect(held.find(r => r.id === id('s1', STEP))!.followUp).toMatchObject({ state: 'orphaned', todoId: 't1' });
    expect(held.find(r => r.id === id('s1', 'Something else'))!.followUp).toBeUndefined(); // same step as the live one: no second todo
    todos.offline = false;
    await run(store, j.model, ['2026-10-06'], todos);
    expect(todos.completed).toEqual(['t1']);
    expect(todos.created).toHaveLength(1);
    expect((await recOf(store)).find(r => r.id === id('s1', STEP))!.followUp!.state).toBe('closed');
  });

  it('adopts a todo whose stored text differs in case and punctuation', async () => {
    const store = new MemoryStore(); const todos = new FakeTodos();
    await seed(store, { id: 's1', day: '2026-10-06', at: FRESH, decisions: [{ what: 'Record the demo' }] });
    await store.createDecisionRecord({ id: id('s1', 'Record the demo'), sessionId: 's1', day: '2026-10-06', at: FRESH, v: 0, followUp: { state: 'creating', text: 'Record the demo -> now.', checked: [] } });
    todos.created.push({ id: 'b9', text: 'RECORD  the demo  → now!!' });
    expect(await run(store, judge({}).model, ['2026-10-06'], todos)).toMatchObject({ adopted: 1 });
    expect(todos.created).toHaveLength(1);
  });
});
