import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CliBeeSource, parseChanged, parseConversation } from '../../src/bee/source.js';
import { HttpBeeSource } from '../../src/bee/http.js';

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

describe('Bee parsing', () => {
  it('turns a Bee conversation into ISO times and utterances', () => {
    const c = parseConversation(fixture('conversation.json'));
    expect(c).toMatchObject({ id: '1001', startedAt: '2026-09-21T14:13:20.000Z', capturing: false });
    expect(c.endedAt).toBe('2026-09-21T14:33:20.000Z');
    expect(c.utterances).toHaveLength(2); // the blank one is dropped
    expect(c.utterances[0]).toEqual({ speaker: 'speaker_1', text: 'We decided to ship on Friday because the client asked for it.', at: '2026-09-21T14:14:20.000Z' });
    expect(c.utterances[1]?.text).toBe('Agreed, I will tell the team.');
  });
  it('also accepts a flat utterances array', () => {
    const inner = fixture('conversation.json').conversation;
    const c = parseConversation({ ...inner, transcriptions: undefined, utterances: inner.transcriptions[0].utterances });
    expect(c.utterances).toHaveLength(1);
  });
  it('marks a conversation still recording', () => {
    const inner = fixture('conversation.json').conversation;
    const c = parseConversation({ conversation: { ...inner, state: 'CAPTURING', end_time: null } });
    expect(c.capturing).toBe(true);
    expect(c.endedAt).toBeNull();
  });
  it('reads changed ids and the next cursor', () => {
    expect(parseChanged(fixture('changed.json'))).toEqual({ ids: ['1001', '1002'], nextCursor: 'cursor-abc123' });
  });
});

describe('sources', () => {
  it('CLI source calls bee with --json', async () => {
    const calls: string[][] = [];
    const src = new CliBeeSource(async args => { calls.push(args); return JSON.stringify(fixture('conversation.json')); });
    await src.conversation('1001');
    expect(calls[0]).toEqual(['conversations', 'get', '1001', '--json']);
  });
  it('CLI source passes the cursor to bee changed', async () => {
    const calls: string[][] = [];
    const src = new CliBeeSource(async args => { calls.push(args); return JSON.stringify(fixture('changed.json')); });
    await src.changedSince(null);
    await src.changedSince('');
    await src.changedSince('c1');
    expect(calls).toEqual([['changed', '--json'], ['changed', '--json'], ['changed', '--cursor', 'c1', '--json']]);
  });
  it('CLI source rejects unsafe ids and cursors', async () => {
    const src = new CliBeeSource(async () => '{}');
    await expect(src.conversation('1 & calc')).rejects.toThrow(/Invalid/);
    await expect(src.changedSince('a b')).rejects.toThrow(/Invalid/);
    await expect(src.conversation('-x')).rejects.toThrow(/Invalid/);
    await expect(src.changedSince('-x')).rejects.toThrow(/Invalid/);
  });
  it('drops an unparseable utterance time and rejects a bad start_time', () => {
    const inner = fixture('conversation.json').conversation;
    const bad = { ...inner, transcriptions: [{ utterances: [{ speaker: 's', text: 'hi', spoken_at: 'garbage' }] }] };
    expect(parseConversation(bad).utterances).toEqual([{ speaker: 's', text: 'hi' }]);
    expect(() => parseConversation({ ...inner, start_time: 'garbage' })).toThrow(/invalid start_time/);
  });
  it('HTTP source sends the bearer token and never logs it', async () => {
    let auth = '';
    const src = new HttpBeeSource('https://bee.example', async () => 'tok', async (_url, init) => {
      auth = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify(fixture('conversation.json')), { status: 200 });
    });
    await src.conversation('1001');
    expect(auth).toBe('Bearer tok');
  });
  it('HTTP source reports an expired token clearly', async () => {
    const src = new HttpBeeSource('https://bee.example', async () => 'tok', async () => new Response('', { status: 401 }));
    await expect(src.conversation('1001')).rejects.toThrow(/Bee token rejected/);
  });
  it('HTTP errors never contain the token', async () => {
    for (const status of [401, 500]) {
      const src = new HttpBeeSource('https://bee.example', async () => 'secret-tok', async () => new Response('', { status }));
      const err = await src.conversation('1001').catch(e => e as Error);
      expect((err as Error).message).not.toContain('secret-tok');
      expect((err as Error).message).toMatch(status === 401 ? /Bee token rejected/ : /Bee API 500/);
    }
  });
});
