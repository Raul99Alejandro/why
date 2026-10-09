import { describe, expect, it } from 'vitest';
import type { DayLog } from '../../src/domain/types.js';
import type { DaySource } from '../../src/agent/source.js';
import { Limits } from '../../src/api/limits.js';
import type { UrlEvent } from '../../src/handlers/event.js';
import { createMcpHandler } from '../../src/handlers/mcp.js';
import { fakeModel } from '../helpers/fakes.js';

const base = { summary: '', sessions: [], todos: [], openQuestions: [], updatedAt: '' };
const day: DayLog = { ...base, date: '2026-10-05', commits: [], decisions: [
  { what: 'Answer Alexa with Nova', why: 'cheap', quote: 'q', quoteOriginal: 'SECRET original', at: '', sessionId: 's1', commits: [] }
] };
const src: DaySource = { listDays: async () => [day.date], getDay: async d => (d === day.date ? day : null) };
const now = () => new Date('2026-10-09T12:00:00Z');

const make = (opts: { limits?: Limits; src?: DaySource } = {}) =>
  createMcpHandler({ src: opts.src ?? src, converse: fakeModel(() => ({ items: [] })), limits: opts.limits ?? new Limits(30, 1000), now });

const event = (method: string, body?: string, headers: Record<string, string> = {}, ip = '1.2.3.4'): UrlEvent => ({
  requestContext: { http: { method, sourceIp: '9.9.9.9' } }, rawPath: '/mcp',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.1, ${ip}`, ...headers }, ...(body === undefined ? {} : { body })
});
const rpc = (id: number, method: string, params: object = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const init = rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
const json = (r: { body?: string }) => JSON.parse(r.body ?? 'null');
const noLeak = (r: { body?: string }) => { expect(r.body ?? '').not.toMatch(/stack|Error:/); };

describe('public MCP endpoint', () => {
  it('initializes as the why server', async () => {
    const r = await make()(event('POST', init));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(json(r).result.serverInfo.name).toBe('why');
  });
  it('lists the five tools without a session (stateless)', async () => {
    const r = await make()(event('POST', rpc(2, 'tools/list')));
    expect(r.statusCode).toBe(200);
    expect(json(r).result.tools).toHaveLength(5);
  });
  it('calls why_search', async () => {
    const r = await make()(event('POST', rpc(3, 'tools/call', { name: 'why_search', arguments: { query: 'alexa' } })));
    expect(r.statusCode).toBe(200);
    expect(json(r).result.structuredContent.decisions[0].what).toBe('Answer Alexa with Nova');
    expect(r.body).not.toContain('SECRET');
  });
  it('accepts a missing accept header and a base64 body', async () => {
    const e = event('POST', Buffer.from(rpc(2, 'tools/list')).toString('base64'));
    e.isBase64Encoded = true;
    const r = await make()(e);
    expect(json(r).result.tools).toHaveLength(5);
  });
  it('rejects GET and DELETE with 405', async () => {
    for (const m of ['GET', 'DELETE']) {
      const r = await make()(event(m));
      expect(r.statusCode).toBe(405);
      expect(r.headers.allow).toBe('POST');
    }
  });
  it('answers a non-JSON body with a JSON-RPC parse error', async () => {
    const r = await make()(event('POST', 'not json'));
    expect(r.statusCode).toBe(400);
    expect(json(r).error.code).toBe(-32700);
    noLeak(r);
  });
  it('rejects a body over 16 KB with 413', async () => {
    const r = await make()(event('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(16_384) } })));
    expect(r.statusCode).toBe(413);
    noLeak(r);
  });
  it('limits 30 requests per IP per hour', async () => {
    const h = make();
    for (let i = 0; i < 30; i++) expect((await h(event('POST', 'x'))).statusCode).toBe(400);
    const r = await h(event('POST', rpc(2, 'tools/list')));
    expect(r.statusCode).toBe(429);
    expect((await h(event('POST', rpc(2, 'tools/list'), {}, '5.6.7.8'))).statusCode).toBe(200);
  });
  it('handles a batch without a 500', async () => {
    const r = await make()(event('POST', `[${rpc(2, 'tools/list')},${rpc(3, 'tools/call', { name: 'why_search', arguments: { query: 'alexa' } })}]`));
    expect(r.statusCode).toBeLessThan(500);
    noLeak(r);
  });
  it('never leaks a stack trace when the store fails', async () => {
    const broken: DaySource = { listDays: async () => { throw new Error('boom at Dynamo'); }, getDay: async () => null };
    const r = await make({ src: broken })(event('POST', rpc(3, 'tools/call', { name: 'why_search', arguments: { query: 'alexa' } })));
    expect(r.statusCode).toBeLessThan(500);
    noLeak(r);
    expect(r.body).not.toContain('Dynamo');
  });
  it('never leaks on an unknown tool or bad arguments', async () => {
    const h = make();
    for (const body of [rpc(4, 'tools/call', { name: 'nope', arguments: {} }), rpc(5, 'tools/call', { name: 'why_search', arguments: { query: 5 } }), rpc(6, 'no/such')]) {
      const r = await h(event('POST', body));
      expect(r.statusCode).toBeLessThan(500);
      noLeak(r);
    }
  });
});
