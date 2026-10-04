import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { createRouter, type ApiRequest } from '../src/api/router.js';
import { Limits } from '../src/api/limits.js';
import { MemoryStore } from '../src/store/memory.js';
import type { DayLog } from '../src/domain/types.js';

const day: DayLog = { date: '2026-10-03', summary: 'Private summary', sessions: [{ id: 's1', startedAt: 'a', endedAt: 'b', topic: 't' }], decisions: [], todos: [], openQuestions: [], commits: [], updatedAt: 'u' };
const req = (method: string, path: string, extra: Partial<ApiRequest> = {}): ApiRequest => ({ method, path, query: {}, headers: {}, body: null, ip: '1.1.1.1', ...extra });
async function setup() {
  const store = new MemoryStore();
  await store.putDay(day);
  const route = createRouter({
    store, converse: async (): Promise<Message> => ({ role: 'assistant', content: [] }), speak: async () => new Uint8Array([1, 2]),
    verify: async h => h === 'Bearer good', limits: new Limits(100, 1000), recompile: async () => null, now: () => new Date('2026-10-05T00:00:00Z')
  });
  return { store, route };
}

describe('api', () => {
  it('refuses private routes without a valid sign-in', async () => {
    const { route } = await setup();
    expect((await route(req('GET', '/days'))).status).toBe(401);
    expect((await route(req('GET', '/days', { headers: { authorization: 'Bearer bad' } }))).status).toBe(401);
    expect((await route(req('GET', '/days', { headers: { authorization: 'Bearer good' } }))).status).toBe(200);
  });
  it('never shows the demo a private day, and answers it like a missing one', async () => {
    const { route } = await setup();
    const priv = await route(req('GET', '/demo/days/2026-10-03'));
    const missing = await route(req('GET', '/demo/days/2026-10-09'));
    expect(priv.status).toBe(404);
    expect(priv.body).toBe(missing.body);
    expect((await route(req('GET', '/demo/days'))).body).toBe('[]');
  });
  it('shows the demo a day once it is published', async () => {
    const { route } = await setup();
    const pub = await route(req('POST', '/publish', { headers: { authorization: 'Bearer good' }, body: JSON.stringify({ date: '2026-10-03', excludeSessions: [] }) }));
    expect(pub.status).toBe(200);
    expect((await route(req('GET', '/demo/days/2026-10-03'))).status).toBe(200);
  });
  it('has no demo route for publishing or forgetting', async () => {
    const { route } = await setup();
    expect((await route(req('POST', '/demo/publish', { body: '{"date":"2026-10-03"}' }))).status).toBe(404);
    expect((await route(req('POST', '/demo/forget', { body: '{"sessionId":"s1"}' }))).status).toBe(404);
  });
  it('limits the demo', async () => {
    const store = new MemoryStore();
    const route = createRouter({ store, converse: async () => ({ role: 'assistant', content: [] }), speak: async () => new Uint8Array(), verify: async () => false, limits: new Limits(2, 100), recompile: async () => null, now: () => new Date() });
    await route(req('GET', '/demo/days')); await route(req('GET', '/demo/days'));
    expect((await route(req('GET', '/demo/days'))).status).toBe(429);
  });
  it('rejects a bad body and long speech', async () => {
    const { route } = await setup();
    expect((await route(req('POST', '/demo/ask', { body: '{' }))).status).toBe(400);
    expect((await route(req('POST', '/demo/speech', { body: JSON.stringify({ text: 'x'.repeat(601) }) }))).status).toBe(400);
  });
});

describe('api extras', () => {
  const auth = { authorization: 'Bearer good' };
  it('requires sign-in for /status and returns syncedAt', async () => {
    const { store, route } = await setup();
    expect((await route(req('GET', '/status'))).status).toBe(401);
    expect(JSON.parse((await route(req('GET', '/status', { headers: auth }))).body)).toEqual({ syncedAt: null });
    await store.setCursor('c1', '2026-10-05T00:00:00Z');
    expect(JSON.parse((await route(req('GET', '/status', { headers: auth }))).body)).toEqual({ syncedAt: '2026-10-05T00:00:00Z' });
  });
  it('previews a publish without making the day visible to the demo', async () => {
    const { route } = await setup();
    const pre = await route(req('POST', '/publish', { headers: auth, body: JSON.stringify({ date: '2026-10-03', excludeSessions: [], preview: true }) }));
    expect(pre.status).toBe(200);
    expect(JSON.parse(pre.body).date).toBe('2026-10-03');
    expect((await route(req('GET', '/demo/days/2026-10-03'))).status).toBe(404);
    expect((await route(req('GET', '/demo/days'))).body).toBe('[]');
  });
  it('serves demo speech without sign-in as base64 audio', async () => {
    const { route } = await setup();
    const res = await route(req('POST', '/demo/speech', { body: JSON.stringify({ text: 'hello' }) }));
    expect(res.status).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.body).toBe(Buffer.from([1, 2]).toString('base64'));
  });
});
