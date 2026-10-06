import { describe, expect, it } from 'vitest';
import { collect, splitSessions } from '../src/collect.js';
import { MemoryStore } from '../src/store/memory.js';
import type { BeeConversation, BeeSource } from '../src/bee/source.js';
import type { WorkHours } from '../src/workfilter.js';

const ALL_DAY: WorkHours = { days: [1, 2, 3, 4, 5, 6, 7], startMin: 0, endMin: 24 * 60, timeZone: 'America/Mexico_City' };
const open = { workHours: ALL_DAY, classify: async () => 'work' as const };
const OFFICE: WorkHours = { days: [1, 2, 3, 4, 5, 6], startMin: 9 * 60, endMin: 20 * 60, timeZone: 'America/Mexico_City' };

const conv = (id: string, capturing = false, startedAt = '2026-10-04T01:30:00.000Z'): BeeConversation => ({
  id, startedAt, endedAt: capturing ? null : '2026-10-04T01:50:00.000Z', capturing,
  utterances: [{ speaker: 'Unknown', text: 'Decidimos usar Polly.' }]
});
const source = (convs: BeeConversation[], nextCursor = 'v1-2'): BeeSource => ({
  async changedSince() { return { ids: convs.map(c => c.id), nextCursor }; },
  async conversation(id) { return convs.find(c => c.id === id)!; }
});
const EPOCH_A = Math.floor(Date.parse('2026-10-04T01:30:00.000Z') / 1000);
const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('collect', () => {
  it('saves finished sessions on their local day and advances the cursor', async () => {
    const store = new MemoryStore();
    const r = await collect({ source: source([conv('a')]), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([`a-${EPOCH_A}`]);
    expect((await store.listSessionsOn('2026-10-03')).map(x => x.session.id)).toEqual([`a-${EPOCH_A}`]);
    expect((await store.getCursor())!.cursor).toBe('v1-2');
  });
  it('leaves a session that is still recording for the next run', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', '2026-10-04T01:00:00.000Z');
    const r = await collect({ source: source([conv('a'), conv('b', true)]), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([`a-${EPOCH_A}`]);
    expect(r.skippedCapturing).toEqual([`b-${EPOCH_A}`]);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
    expect(await store.getSession(`b-${EPOCH_A}`)).toBeNull();
  });
  it('does not save the same session twice', async () => {
    const store = new MemoryStore();
    await collect({ source: source([conv('a')]), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    const r = await collect({ source: source([conv('a')]), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([]);
  });
  it('skips empty transcripts', async () => {
    const store = new MemoryStore();
    const r = await collect({ source: source([{ ...conv('a'), utterances: [] }]), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([]);
  });
  it('keeps the previous cursor when nextCursor is empty', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', '2026-10-04T01:00:00.000Z');
    const r = await collect({ source: source([conv('a')], ''), store, ...open, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([`a-${EPOCH_A}`]);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
  });

  describe('sessions inside one conversation', () => {
    const MIN = 60_000;
    const T0 = Date.parse('2026-10-03T01:42:00.000Z');
    const at = (ms: number) => new Date(ms).toISOString();
    const u = (ms: number) => ({ speaker: 'Unknown', text: `invented ${ms}`, at: at(ms) });
    const live = (utterances: BeeConversation['utterances'], capturing = true): BeeConversation => ({
      id: 'c', startedAt: at(T0), endedAt: capturing ? null : at(T0 + 1), capturing, utterances
    });
    const HOUR = 60 * MIN;
    const burstA = [u(T0), u(T0 + 5 * MIN)];
    const burstB = [u(T0 + 20 * HOUR), u(T0 + 20 * HOUR + 3 * MIN)];

    it('saves the old burst of a capturing conversation and skips the recent one', async () => {
      const store = new MemoryStore();
      const now = new Date(T0 + 20 * HOUR + 10 * MIN);
      const r = await collect({ source: source([live([...burstA, ...burstB])]), store, ...open, timeZone: 'America/Mexico_City', now });
      const idA = `c-${Math.floor(T0 / 1000)}`;
      const idB = `c-${Math.floor((T0 + 20 * HOUR) / 1000)}`;
      expect(r.saved).toEqual([idA]);
      expect(r.skippedCapturing).toEqual([idB]);
      expect((await store.getSession(idA))!.session.utterances).toHaveLength(2);
      expect(await store.getSession(idB)).toBeNull();
      expect(r.cursor).toBe('');
    });
    it('saves both bursts when both are old', async () => {
      const store = new MemoryStore();
      const now = new Date(T0 + 22 * HOUR);
      const r = await collect({ source: source([live([...burstA, ...burstB])]), store, ...open, timeZone: 'America/Mexico_City', now });
      expect(r.saved).toHaveLength(2);
      expect(r.skippedCapturing).toEqual([]);
      expect(r.cursor).toBe('v1-2');
    });
    it('does not split on a gap of exactly 20 minutes, but does on a longer one', () => {
      const now = new Date(T0 + 5 * HOUR);
      expect(splitSessions(live([u(T0), u(T0 + 20 * MIN)]), now)).toHaveLength(1);
      expect(splitSessions(live([u(T0), u(T0 + 20 * MIN + 1)]), now)).toHaveLength(2);
    });
    it('splits sorted by time and sets bounds and id', () => {
      const s = splitSessions(live([u(T0 + 5 * MIN), u(T0)]), new Date(T0 + 5 * HOUR))[0]!;
      expect(s.session).toMatchObject({ id: `c-${Math.floor(T0 / 1000)}`, startedAt: at(T0), endedAt: at(T0 + 5 * MIN) });
      expect(s.finished).toBe(true);
    });
    it('treats a segment as finished once the conversation stops capturing', () => {
      const r = splitSessions(live(burstA, false), new Date(T0 + 6 * MIN));
      expect(r.map(x => x.finished)).toEqual([true]);
    });
    it('falls back to one session spanning the conversation without timestamps', () => {
      const c: BeeConversation = { ...live([{ speaker: 'Unknown', text: 'x' }], false), endedAt: at(T0 + 9 * MIN) };
      const s = splitSessions(c, NOW)[0]!;
      expect(s.session).toMatchObject({ id: `c-${Math.floor(T0 / 1000)}`, startedAt: at(T0), endedAt: at(T0 + 9 * MIN) });
      expect(s.finished).toBe(true);
      expect(splitSessions({ ...c, capturing: true, endedAt: null }, NOW)[0]).toMatchObject({ finished: false });
      expect(splitSessions({ ...c, capturing: true, endedAt: null }, NOW)[0]!.session.endedAt).toBe(at(T0));
    });
    it('attaches untimed utterances to the preceding timed one', () => {
      const x = { speaker: 'Unknown', text: 'untimed' };
      const r = splitSessions(live([x, u(T0), x, u(T0 + 21 * MIN), x], false), new Date(T0 + 5 * HOUR));
      expect(r.map(s => s.session.utterances.length)).toEqual([3, 2]);
    });
    it('keeps the first session idempotent when the conversation grows', async () => {
      const store = new MemoryStore();
      const tz = 'America/Mexico_City';
      const r1 = await collect({ source: source([live(burstA)]), store, ...open, timeZone: tz, now: new Date(T0 + 2 * HOUR) });
      expect(r1.saved).toHaveLength(1);
      const r2 = await collect({ source: source([live([...burstA, ...burstB])]), store, ...open, timeZone: tz, now: new Date(T0 + 22 * HOUR) });
      expect(r2.saved).toEqual([`c-${Math.floor((T0 + 20 * HOUR) / 1000)}`]);
    });
  });
});

describe('work filter (W-01)', () => {
  const tz = 'America/Mexico_City';
  const MIN = 60_000;
  const say = (iso: string, text = 'secret words') => ({ speaker: 'Unknown', text, at: iso });
  const mk = (id: string, utterances: BeeConversation['utterances']): BeeConversation => ({
    id, startedAt: utterances[0]!.at!, endedAt: utterances.at(-1)!.at!, capturing: false, utterances
  });
  // Monday 2026-10-05, Mexico City is UTC-6: 16:00Z = 10:00 local, 03:00Z next day = 21:00 local.
  const WORK = '2026-10-05T16:00:00.000Z';
  const NIGHT = '2026-10-06T03:00:00.000Z';
  const NOW = new Date('2026-10-06T12:00:00.000Z');
  const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * MIN).toISOString();

  it('stores work, drops personal with a counter, and never calls the classifier outside hours', async () => {
    const store = new MemoryStore();
    const seen: string[] = [];
    const classify = async (s: { id: string }) => { seen.push(s.id); return s.id.startsWith('p') ? 'personal' as const : 'work' as const; };
    const r = await collect({
      source: source([mk('w', [say(WORK)]), mk('p', [say(plus(WORK, 120))]), mk('n', [say(NIGHT)])]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify
    });
    expect(r.saved).toHaveLength(1);
    expect(r.ignoredPersonal).toBe(1);
    expect(r.ignoredOffHours).toBe(1);
    expect(seen).toHaveLength(2); // the night segment was never sent to the classifier
    expect(await store.ignoredCounts('2026-10-05')).toEqual({ personal: 1, offHours: 1 });
    expect((await store.listSessionsOn('2026-10-05')).map(x => x.session.id)).toEqual(r.saved);
    expect(r.ignoredDays).toEqual(['2026-10-05']);
  });

  it('cuts a conversation that crosses the end of the work day (review focus 1)', async () => {
    const store = new MemoryStore();
    const before = plus('2026-10-06T02:00:00.000Z', -10); // 19:50 local
    const after = plus('2026-10-06T02:00:00.000Z', 15); // 20:15 local
    let sent = '';
    const classify = async (s: { utterances: { text: string }[] }) => { sent = s.utterances.map(u => u.text).join('|'); return 'work' as const; };
    const r = await collect({ source: source([mk('x', [say(before, 'work talk'), say(after, 'dinner talk')])]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify });
    expect(sent).toBe('work talk');
    const stored = (await store.getSession(r.saved[0]!))!;
    expect(stored.session.utterances.map(u => u.text)).toEqual(['work talk']);
  });

  it('keeps a segment pending when the classifier fails, and retries it next run', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', NOW.toISOString());
    const conv = mk('w', [say(WORK)]);
    const r1 = await collect({ source: source([conv]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify: async () => null });
    expect(r1.saved).toEqual([]);
    expect(r1.classifyFailed).toHaveLength(1);
    expect(await store.getSession(r1.classifyFailed[0]!)).toBeNull();
    expect(await store.isIgnored(r1.classifyFailed[0]!)).toBe(false);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
    const r2 = await collect({ source: source([conv]), store, timeZone: tz, now: new Date(NOW.getTime() + 10 * MIN), workHours: OFFICE, classify: async () => 'work' });
    expect(r2.saved).toHaveLength(1);
    expect(r2.classifyFailed).toEqual([]);
    expect((await store.getCursor())!.cursor).toBe('v1-2');
  });

  it('does not count or judge an ignored conversation again when it is seen again', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const classify = async () => { calls++; return 'personal' as const; };
    const conv = mk('p', [say(WORK)]);
    await collect({ source: source([conv]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify });
    const r = await collect({ source: source([conv]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify });
    expect(r.ignoredPersonal).toBe(0);
    expect(calls).toBe(1);
    expect(await store.ignoredCounts('2026-10-05')).toEqual({ personal: 1, offHours: 0 });
  });

  it('follows the configured days: Sunday is off by default', async () => {
    const store = new MemoryStore();
    const sunday = '2026-10-04T16:00:00.000Z';
    const r = await collect({ source: source([mk('s', [say(sunday)])]), store, timeZone: tz, now: NOW, workHours: OFFICE, classify: async () => 'work' });
    expect(r.ignoredOffHours).toBe(1);
    const r2 = await collect({ source: source([mk('t', [say(sunday)])]), store: new MemoryStore(), timeZone: tz, now: NOW, workHours: { ...OFFICE, days: [7] }, classify: async () => 'work' });
    expect(r2.saved).toHaveLength(1);
  });
});
