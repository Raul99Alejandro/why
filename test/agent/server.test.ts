import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DayLog } from '../../src/domain/types.js';
import type { DaySource } from '../../src/agent/source.js';
import { createWhyServer } from '../../src/agent/server.js';
import { fakeModel } from '../helpers/fakes.js';

const base = { summary: '', sessions: [], todos: [], openQuestions: [], updatedAt: '' };
const day: DayLog = { ...base, date: '2026-10-05', commits: [{ repo: 'o/r', sha: 'abc1234', message: 'feat: nova', url: 'u', at: '' }], decisions: [
  { what: 'Use Nova for the answers', why: 'cheap', quote: 'nova is cheap', quoteOriginal: 'SECRET original', at: '', sessionId: 's1', commits: ['abc1234'], followUp: { text: 'Record the demo', status: 'open' } },
] };
const src: DaySource = { listDays: async () => [day.date], getDay: async d => (d === day.date ? day : null) };

async function connect(model = fakeModel(() => ({ items: [] }))) {
  const server = createWhyServer({ src, converse: model, label: 'demo' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const text = (r: unknown) => JSON.stringify(r);

describe('Why MCP server', () => {
  it('lists the five tools, read-only', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['why_ask', 'why_check_change', 'why_explain_commit', 'why_open_followups', 'why_search']);
    expect(tools.every(t => t.annotations?.readOnlyHint === true)).toBe(true);
  });
  it('searches decisions without the original quote', async () => {
    const r = await (await connect()).callTool({ name: 'why_search', arguments: { query: 'nova' } });
    expect((r.structuredContent as { decisions: { what: string }[] }).decisions[0]!.what).toBe('Use Nova for the answers');
    expect(text(r)).not.toContain('SECRET');
  });
  it('rejects a bad sha as an error result, not a crash', async () => {
    const r = await (await connect()).callTool({ name: 'why_explain_commit', arguments: { sha: 'zz' } });
    expect(r.isError).toBe(true);
  });
  it('explains a commit and lists open follow-ups', async () => {
    const c = await connect();
    const e = await c.callTool({ name: 'why_explain_commit', arguments: { sha: 'abc1234', repo: 'o/r' } });
    expect((e.structuredContent as { decisions: unknown[] }).decisions).toHaveLength(1);
    const f = await c.callTool({ name: 'why_open_followups', arguments: {} });
    expect((f.structuredContent as { decisions: unknown[] }).decisions).toHaveLength(1);
  });
  it('checks a change with the model verdict', async () => {
    const model = fakeModel(() => ({ items: [{ label: 'D1', relation: 'conflicts', reason: 'swaps the model' }] }));
    const r = await (await connect(model)).callTool({ name: 'why_check_change', arguments: { change: 'Replace Nova with another model', files: ['src/ask.ts'] } });
    expect((r.structuredContent as { verdict: string }).verdict).toBe('conflicts');
    expect(text(r)).not.toContain('SECRET');
  });
  it('answers a question with citations', async () => {
    const model = fakeModel(() => ({ answer: 'Nova, because cheap.', citations: [{ date: '2026-10-05', sessionId: 's1', decision: 'Use Nova for the answers' }] }));
    const r = await (await connect(model)).callTool({ name: 'why_ask', arguments: { question: 'Which model?' } });
    expect((r.structuredContent as { answer: string }).answer).toContain('Nova');
  });
});
