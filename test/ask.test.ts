import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { ask } from '../src/ask.js';
import type { ConverseFn } from '../src/nova.js';

const days = [{ date: '2026-10-03', summary: 's', sessions: [], todos: [], openQuestions: [], commits: [], updatedAt: 'u', publishedAt: 'p',
  decisions: [{ what: 'Use Polly for the mechanic', why: 'ElevenLabs ran out of credits', quote: 'q', at: 'a', sessionId: 's1', commits: [] }] }];
const reply = (input: unknown): Message => ({ role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'answer_question', input: input as never } }] });

describe('ask', () => {
  it('answers from the stored decisions and cites them', async () => {
    const converse: ConverseFn = async () => reply({ answer: 'You chose Polly because ElevenLabs ran out of credits.', citations: [{ date: '2026-10-03', sessionId: 's1', decision: 'Use Polly for the mechanic' }] });
    const out = await ask({ question: 'Why Polly?', days, converse });
    expect(out.citations[0]!.date).toBe('2026-10-03');
  });
  it('drops citations to decisions that do not exist', async () => {
    const converse: ConverseFn = async () => reply({ answer: 'x', citations: [{ date: '2026-10-09', sessionId: 'zz', decision: 'made up' }] });
    expect((await ask({ question: 'q', days, converse })).citations).toEqual([]);
  });
  it('says so when it cannot answer', async () => {
    const converse: ConverseFn = async () => ({ role: 'assistant', content: [{ text: 'hmm' }] });
    expect((await ask({ question: 'q', days, converse })).answer).toMatch(/couldn't find/i);
  });
});
