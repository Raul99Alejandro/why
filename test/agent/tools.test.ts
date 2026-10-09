import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/store/memory.js';
import type { CommitRef, DayLog } from '../../src/domain/types.js';
import { privateSource, publishedSource, type DaySource } from '../../src/agent/source.js';
import { explainCommit, openFollowUps, recentDecisions, searchDecisions } from '../../src/agent/tools.js';

const c1: CommitRef = { repo: 'Raul99Alejandro/why', sha: 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', message: 'feat: nova answers', url: 'u1', at: '2026-10-05T12:00:00Z' };
const c2: CommitRef = { repo: 'Raul99Alejandro/why', sha: 'def5678bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', message: 'feat: sonnet answers', url: 'u2', at: '2026-10-07T12:00:00Z' };
const base = { summary: '', sessions: [], todos: [], openQuestions: [], updatedAt: '' };
const day5: DayLog = { ...base, date: '2026-10-05', commits: [{ ...c1, sha: 'abc1234' }], decisions: [
  { what: 'Use Nova for the answers', why: 'cheap', quote: 'nova is cheap', quoteOriginal: 'SECRET original', at: '', sessionId: 's1', commits: ['abc1234'],
    changedLater: { id: 's2#0', date: '2026-10-07' }, followUp: { text: 'Record the Alexa demo', status: 'open' } },
] };
const day7: DayLog = { ...base, date: '2026-10-07', commits: [c2], decisions: [
  { what: 'Use Claude Sonnet for the answers', why: 'quality', quote: 'sonnet is better', quoteOriginal: 'SECRET two', at: '', sessionId: 's2', commits: [], id: 's2#0',
    followUp: { text: 'Ship it', status: 'closed', closedBy: c2 } },
] };
const mem = (days: DayLog[]): DaySource => ({ listDays: async () => days.map(d => d.date).sort().reverse(), getDay: async d => days.find(x => x.date === d) ?? null });
const src = mem([day5, day7]);

describe('agent tools', () => {
  it('searches by tokens and resolves commit messages', async () => {
    const out = await searchDecisions(src, 'nova answers');
    expect(out.map(d => d.date)).toEqual(['2026-10-05']);
    expect(out[0]!.commits[0]!.message).toBe('feat: nova answers');
    expect(out[0]!.id).toBe('s1#0');
  });
  it('ignores single-character tokens', async () => expect(await searchDecisions(src, 'x')).toEqual([]));
  it('explains a commit by sha prefix, closedBy, and repo', async () => {
    expect((await explainCommit(src, 'abc1234ffffffffffffffffffffffffffffffff0')).map(d => d.date)).toEqual(['2026-10-05']);
    expect((await explainCommit(src, 'ABC12')).map(d => d.date)).toEqual(['2026-10-05']);
    expect((await explainCommit(src, 'def5678')).map(d => d.date)).toEqual(['2026-10-07']);
    expect(await explainCommit(src, 'abc1234', 'other/repo')).toEqual([]);
  });
  it('lists only open follow-ups', async () => expect((await openFollowUps(src)).map(d => d.date)).toEqual(['2026-10-05']));
  it('returns nothing from an empty source', async () => {
    const e = mem([]);
    expect(await recentDecisions(e)).toEqual([]);
    expect(await searchDecisions(e, 'nova')).toEqual([]);
    expect(await explainCommit(e, 'abc')).toEqual([]);
    expect(await openFollowUps(e)).toEqual([]);
  });
  it('recent decisions are newest first, keep unknown shas, and never leak quoteOriginal', async () => {
    const out = await recentDecisions(src);
    expect(out.map(d => d.date)).toEqual(['2026-10-07', '2026-10-05']);
    expect(JSON.stringify(out)).not.toContain('quoteOriginal');
    expect(JSON.stringify(out)).not.toContain('SECRET');
    const odd = mem([{ ...day5, commits: [] }]);
    expect((await recentDecisions(odd))[0]!.commits).toEqual([{ repo: '', sha: 'abc1234', message: '', url: '', at: '' }]);
    expect(out[1]!.changedLater).toEqual({ id: 's2#0', date: '2026-10-07' });
    expect(await recentDecisions(src, 1)).toHaveLength(1);
  });
  it('the published source reads only published days', async () => {
    const store = new MemoryStore();
    store.listDays = async () => { throw new Error('private'); };
    store.getDay = async () => { throw new Error('private'); };
    await store.putPublished({ ...day5, decisions: [], publishedAt: '' });
    expect(await recentDecisions(publishedSource(store))).toEqual([]);
    await expect(privateSource(store).listDays()).rejects.toThrow('private');
  });
});
