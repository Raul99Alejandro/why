import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { compileDay, matchCommits } from '../src/compile.js';
import type { ConverseFn } from '../src/nova.js';
import { MemoryStore } from '../src/store/memory.js';

const tool = (name: string, input: unknown): Message => ({ role: 'assistant', content: [{ toolUse: { toolUseId: 't', name, input: input as never } }] });
const scripted = (...replies: Message[]): ConverseFn => async () => { const r = replies.shift(); if (!r) throw new Error('no reply'); return r; };
const decision = { what: 'Use Polly', why: 'No credits left', quote: 'We use Polly.', quoteOriginal: 'Usamos Polly.', at: '2026-10-03T18:05:00.000Z', sessionId: 's1', commits: [] as string[] };
const commits = [{ repo: 'o/r', sha: 'aaa1111', message: 'feat: Polly voice', url: 'u', at: '2026-10-03T19:00:00.000Z' }];

describe('compile', () => {
  it('builds the day from analyzed sessions with a one-line summary and linked commits', async () => {
    const store = new MemoryStore();
    await store.putSession({ id: 's1', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:20:00.000Z', utterances: [{ speaker: 'U', text: 'x' }] }, '2026-10-03', 9e9);
    await store.setAnalysis('s1', { topic: 'Voices', summary: 'Moved to Polly.', decisions: [decision], todos: ['Delete old video'], openQuestions: ['Retake florist?'] }, 'analyzed');
    const fetchFn = (async () => new Response(JSON.stringify([{ sha: 'aaa1111xxxx', html_url: 'u', commit: { message: 'feat: Polly voice', author: { date: '2026-10-03T19:00:00Z' } } }]), { status: 200 })) as typeof fetch;
    const converse = scripted(tool('save_day_summary', { summary: 'Switched voices to Polly.' }), tool('save_commit_links', { links: [{ decision: 0, commits: ['aaa1111', 'zzz9999'] }] }));
    const day = await compileDay({ day: '2026-10-03', store, converse, repos: ['o/r'], timeZone: 'America/Mexico_City', now: new Date('2026-10-04T03:00:00Z'), fetchFn });
    expect(day).toMatchObject({ date: '2026-10-03', summary: 'Switched voices to Polly.', todos: [{ text: 'Delete old video', sessionId: 's1' }], openQuestions: [{ text: 'Retake florist?', sessionId: 's1' }] });
    expect(day!.sessions).toEqual([{ id: 's1', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:20:00.000Z', topic: 'Voices' }]);
    expect(day!.decisions[0]!.commits).toEqual(['aaa1111']);
    expect(await store.getDay('2026-10-03')).toEqual(day);
  });
  it('returns null and saves nothing for a day without analyzed sessions', async () => {
    const store = new MemoryStore();
    expect(await compileDay({ day: '2026-10-03', store, converse: scripted(), repos: [], timeZone: 'America/Mexico_City', now: new Date() })).toBeNull();
    expect(await store.getDay('2026-10-03')).toBeNull();
  });
  it('keeps decisions without commits when there are none to match', async () => {
    expect(await matchCommits([decision], [], scripted())).toEqual([decision]);
  });
});
