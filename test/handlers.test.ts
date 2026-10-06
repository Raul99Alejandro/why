import { describe, expect, it } from 'vitest';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { readEnv, recompiler, runSync } from '../src/runtime.js';
import { toApiRequest, type UrlEvent } from '../src/handlers/event.js';
import { MemoryStore } from '../src/store/memory.js';
import type { BeeSource } from '../src/bee/source.js';

const analysis = { topic: 'Voices', summary: 's', decisions: [], todos: ['t'], openQuestions: [] };
const converse = async (input: { toolConfig: { tools?: { toolSpec?: { name?: string } }[] } }): Promise<Message> => {
  const name = input.toolConfig.tools?.[0]?.toolSpec?.name ?? '';
  const data = name === 'save_session_analysis' ? analysis : name === 'save_day_summary' ? { summary: 'Day' } : name === 'classify_segment' ? { label: 'work' } : { links: [] };
  return { role: 'assistant', content: [{ toolUse: { toolUseId: 't', name, input: data as never } }] };
};
const source: BeeSource = {
  async changedSince() { return { ids: ['a'], nextCursor: 'v1-2' }; },
  async conversation() { return { id: 'a', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:20:00.000Z', capturing: false, utterances: [{ speaker: 'U', text: 'x' }] }; }
};

describe('runSync', () => {
  it('collects, analyzes and compiles the day in one run', async () => {
    const store = new MemoryStore();
    const out = await runSync({ source, store, converse: converse as never, repos: [], timeZone: 'America/Mexico_City', now: new Date('2026-10-04T00:00:00Z') });
    expect(out).toEqual({ saved: 1, analyzed: 1, failed: 0, ignoredPersonal: 0, ignoredOffHours: 0, classifyFailed: 0, days: ['2026-10-03'] });
    expect((await store.getDay('2026-10-03'))!.summary).toBe('Day');
  });
});

describe('recompiler', () => {
  it('deletes the day log when no sessions are left', async () => {
    const store = new MemoryStore();
    await store.putDay({ date: '2026-10-03', summary: 's', sessions: [], decisions: [], todos: [], openQuestions: [], commits: [], updatedAt: 'x' });
    const out = await recompiler({ store, converse: converse as never, repos: [], timeZone: 'America/Mexico_City' })('2026-10-03');
    expect(out).toBeNull();
    expect(await store.getDay('2026-10-03')).toBeNull();
  });
});

describe('readEnv', () => {
  it('requires TABLE and applies defaults', () => {
    expect(() => readEnv({})).toThrow('missing TABLE');
    const e = readEnv({ TABLE: 't' });
    expect(e).toMatchObject({ TABLE: 't', REGION: 'us-east-1', BEE_MODE: 'http', REPOS: '' });
    expect(readEnv({ TABLE: 't', BEE_MODE: 'cli' }).BEE_MODE).toBe('cli');
  });
});

const ev = (over: Partial<UrlEvent> & { path?: string } = {}): UrlEvent => ({
  requestContext: { http: { method: 'GET', sourceIp: '1.1.1.1' } },
  rawPath: over.path ?? '/api/days',
  ...over
});

describe('toApiRequest', () => {
  it('strips /api and maps the token header only', () => {
    const r = toApiRequest(ev({ headers: { 'x-why-token': 'Bearer abc', authorization: 'AWS4 junk' }, queryStringParameters: { q: 'x' } }), { demo: false })!;
    expect(r.path).toBe('/days');
    expect(r.query).toEqual({ q: 'x' });
    expect(r.headers).toEqual({ authorization: 'Bearer abc' });
  });
  it('routes /demo/ only to the demo handler', () => {
    const e = ev({ path: '/api/demo/days' });
    expect(toApiRequest(e, { demo: false })).toBeNull();
    expect(toApiRequest(e, { demo: true })!.path).toBe('/demo/days');
    expect(toApiRequest(ev({ path: '/api/days' }), { demo: true })).toBeNull();
    expect(toApiRequest(ev({ path: '/api/demoish' }), { demo: false })!.path).toBe('/demoish');
  });
  it('gives demo requests empty headers', () => {
    expect(toApiRequest(ev({ path: '/demo/days', headers: { 'x-why-token': 'Bearer abc' } }), { demo: true })!.headers).toEqual({});
  });
  it('decodes base64 bodies and keeps plain ones', () => {
    const b64 = Buffer.from('{"a":"é"}').toString('base64');
    expect(toApiRequest(ev({ body: b64, isBase64Encoded: true }), { demo: false })!.body).toBe('{"a":"é"}');
    expect(toApiRequest(ev({ body: 'plain' }), { demo: false })!.body).toBe('plain');
    expect(toApiRequest(ev(), { demo: false })!.body).toBeNull();
  });
  it('uses the last x-forwarded-for entry, else the source ip', () => {
    expect(toApiRequest(ev({ headers: { 'x-forwarded-for': '9.9.9.9, 2.2.2.2' } }), { demo: false })!.ip).toBe('2.2.2.2');
    expect(toApiRequest(ev(), { demo: false })!.ip).toBe('1.1.1.1');
  });
});
