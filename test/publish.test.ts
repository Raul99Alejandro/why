import { describe, expect, it } from 'vitest';
import { forgetSession, publishDay } from '../src/publish.js';
import { MemoryStore } from '../src/store/memory.js';
import type { DayLog } from '../src/domain/types.js';

const day: DayLog = {
  date: '2026-10-03', summary: 'Called ana@example.com about the voices.',
  sessions: [{ id: 's1', startedAt: 'a', endedAt: 'b', topic: 'Voices' }, { id: 's2', startedAt: 'c', endedAt: 'd', topic: 'Personal' }],
  decisions: [
    { what: 'Use Polly', why: 'No credits', quote: 'Call +52 81 1234 5678', quoteOriginal: 'Llama al 81 1234 5678', at: 'a', sessionId: 's1', commits: [] },
    { what: 'Private thing', why: 'x', quote: 'q', quoteOriginal: 'q', at: 'c', sessionId: 's2', commits: [] }
  ],
  todos: [{ text: 'Delete old video', sessionId: 's1' }, { text: 'Personal errand', sessionId: 's2' }],
  openQuestions: [], commits: [], updatedAt: 'now'
};

describe('publish', () => {
  it('publishes only approved sessions, without original quotes, with personal data hidden', async () => {
    const store = new MemoryStore();
    await store.putDay(day);
    const pub = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date('2026-10-05T00:00:00Z') });
    expect(pub!.sessions.map(s => s.id)).toEqual(['s1']);
    expect(pub!.decisions).toHaveLength(1);
    expect(JSON.stringify(pub)).not.toContain('quoteOriginal');
    expect(JSON.stringify(pub)).not.toMatch(/example\.com|1234 5678|Personal errand|Private thing/);
    expect(await store.getPublished('2026-10-03')).toEqual(pub);
  });
  it('returns null for a day that does not exist', async () => {
    expect(await publishDay({ store: new MemoryStore(), day: '2026-10-09', excludeSessions: [], now: new Date() })).toBeNull();
  });
  it('forgetting a session republishes its day without it, or unpublishes an emptied day', async () => {
    const store = new MemoryStore();
    await store.putSession({ id: 's1', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:10:00.000Z', utterances: [{ speaker: 'U', text: 'x' }] }, '2026-10-03', 9e9);
    await store.putDay(day);
    await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date() });
    await forgetSession({ store, sessionId: 's1', recompile: async () => null });
    expect(await store.getSession('s1')).toBeNull();
    expect(await store.getPublished('2026-10-03')).toBeNull();
  });
  it('runs the name review over every published text', async () => {
    const store = new MemoryStore();
    await store.putDay({ ...day, summary: 'Talked with Ana about voices.' });
    const pub = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date(), hide: async t => t.map(x => x.replace('Ana', 'a colleague')) });
    expect(pub!.summary).toBe('Talked with a colleague about voices.');
  });
  it('dryRun returns the filtered day but saves nothing', async () => {
    const store = new MemoryStore();
    await store.putDay(day);
    const pub = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date(), dryRun: true });
    expect(pub!.sessions.map(s => s.id)).toEqual(['s1']);
    expect(JSON.stringify(pub)).not.toMatch(/example\.com|Private thing/);
    expect(await store.getPublished('2026-10-03')).toBeNull();
  });
  it('hide covers every text kind, and redact runs again after it', async () => {
    const store = new MemoryStore();
    await store.putDay({
      ...day, summary: 'sum',
      decisions: [{ ...day.decisions[0]!, commits: ['c1'] }],
      openQuestions: [{ text: 'question', sessionId: 's1' }],
      commits: [{ repo: 'r', sha: 'c1', message: 'commit msg', url: 'u', at: 'a' }, { repo: 'r', sha: 'c2', message: 'other', url: 'u', at: 'a' }]
    });
    const seen: string[] = [];
    const pub = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date(), hide: async t => { seen.push(...t); return t.map(x => `H(${x}) ana@example.com`); } });
    for (const x of ['sum', 'Voices', 'Use Polly', 'No credits', 'Delete old video', 'question', 'commit msg']) expect(seen).toContain(x);
    expect(seen.some(x => x.startsWith('Call'))).toBe(true);
    expect(pub!.commits.map(c => c.sha)).toEqual(['c1']);
    expect(pub!.commits[0]!.message).toBe('H(commit msg) [redacted]');
    expect(pub!.sessions[0]!.topic).toBe('H(Voices) [redacted]');
    expect(JSON.stringify(pub)).not.toContain('example.com');
  });
  it('only commits referenced by kept decisions are published', async () => {
    const store = new MemoryStore();
    await store.putDay({
      ...day,
      decisions: [{ ...day.decisions[0]!, commits: ['c1'] }, { ...day.decisions[1]!, commits: ['c2'] }],
      commits: [{ repo: 'r', sha: 'c1', message: 'mail ana@example.com', url: 'u', at: 'a' }, { repo: 'r', sha: 'c2', message: 'secret work', url: 'u', at: 'a' }]
    });
    const pub = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date() });
    expect(pub!.commits).toEqual([{ repo: 'r', sha: 'c1', message: 'mail [redacted]', url: 'u', at: 'a' }]);
  });
  it('forgetting a session filters the existing public copy and keeps earlier exclusions', async () => {
    const store = new MemoryStore();
    const dec = (n: string, s: string, c: string) => ({ what: n, why: n, quote: n, quoteOriginal: n, at: 'a', sessionId: s, commits: [c] });
    await store.putSession({ id: 's3', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:10:00.000Z', utterances: [{ speaker: 'U', text: 'x' }] }, '2026-10-03', 9e9);
    await store.putDay({
      date: '2026-10-03', summary: 'sum mentions topic-s3',
      sessions: ['s1', 's2', 's3'].map(id => ({ id, startedAt: 'a', endedAt: 'b', topic: `topic-${id}` })),
      decisions: [dec('d1', 's1', 'c1'), dec('d2', 's2', 'c2'), dec('d3', 's3', 'c3')],
      todos: ['s1', 's2', 's3'].map(s => ({ text: `todo-${s}`, sessionId: s })),
      openQuestions: ['s1', 's2', 's3'].map(s => ({ text: `q-${s}`, sessionId: s })),
      commits: ['c1', 'c2', 'c3'].map(sha => ({ repo: 'r', sha, message: `m-${sha}`, url: 'u', at: 'a' })),
      updatedAt: 'now'
    });
    const first = await publishDay({ store, day: '2026-10-03', excludeSessions: ['s2'], now: new Date('2026-10-05T00:00:00Z') });
    await forgetSession({ store, sessionId: 's3', recompile: async () => null });
    const pub = await store.getPublished('2026-10-03');
    expect(pub!.sessions.map(s => s.id)).toEqual(['s1']);
    expect(pub!.summary).toBe('topic-s1');
    expect(pub!.publishedAt).toBe(first!.publishedAt);
    expect(pub!.commits.map(c => c.sha)).toEqual(['c1']);
    expect(JSON.stringify(pub)).not.toMatch(/s2|s3|d2|d3|c2|c3/);
  });
});
