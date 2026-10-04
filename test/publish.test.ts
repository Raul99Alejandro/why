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
    await publishDay({ store, day: '2026-10-03', excludeSessions: [], now: new Date() });
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
});
