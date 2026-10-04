import { describe, expect, it } from 'vitest';
import { collect, splitSessions } from '../src/collect.js';
import { MemoryStore } from '../src/store/memory.js';
import type { BeeConversation, BeeSource } from '../src/bee/source.js';

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
    const r = await collect({ source: source([conv('a')]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([`a-${EPOCH_A}`]);
    expect((await store.listSessionsOn('2026-10-03')).map(x => x.session.id)).toEqual([`a-${EPOCH_A}`]);
    expect((await store.getCursor())!.cursor).toBe('v1-2');
  });
  it('leaves a session that is still recording for the next run', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', '2026-10-04T01:00:00.000Z');
    const r = await collect({ source: source([conv('a'), conv('b', true)]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([`a-${EPOCH_A}`]);
    expect(r.skippedCapturing).toEqual([`b-${EPOCH_A}`]);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
    expect(await store.getSession(`b-${EPOCH_A}`)).toBeNull();
  });
  it('does not save the same session twice', async () => {
    const store = new MemoryStore();
    await collect({ source: source([conv('a')]), store, timeZone: 'America/Mexico_City', now: NOW });
    const r = await collect({ source: source([conv('a')]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([]);
  });
  it('skips empty transcripts', async () => {
    const store = new MemoryStore();
    const r = await collect({ source: source([{ ...conv('a'), utterances: [] }]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual([]);
  });
  it('keeps the previous cursor when nextCursor is empty', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', '2026-10-04T01:00:00.000Z');
    const r = await collect({ source: source([conv('a')], ''), store, timeZone: 'America/Mexico_City', now: NOW });
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
      const r = await collect({ source: source([live([...burstA, ...burstB])]), store, timeZone: 'America/Mexico_City', now });
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
      const r = await collect({ source: source([live([...burstA, ...burstB])]), store, timeZone: 'America/Mexico_City', now });
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
      const r1 = await collect({ source: source([live(burstA)]), store, timeZone: tz, now: new Date(T0 + 2 * HOUR) });
      expect(r1.saved).toHaveLength(1);
      const r2 = await collect({ source: source([live([...burstA, ...burstB])]), store, timeZone: tz, now: new Date(T0 + 22 * HOUR) });
      expect(r2.saved).toEqual([`c-${Math.floor((T0 + 20 * HOUR) / 1000)}`]);
    });
  });
});
