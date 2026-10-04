import { describe, expect, it } from 'vitest';
import { collect } from '../src/collect.js';
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
const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('collect', () => {
  it('saves finished sessions on their local day and advances the cursor', async () => {
    const store = new MemoryStore();
    const r = await collect({ source: source([conv('a')]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual(['a']);
    expect((await store.listSessionsOn('2026-10-03')).map(x => x.session.id)).toEqual(['a']);
    expect((await store.getCursor())!.cursor).toBe('v1-2');
  });
  it('leaves a session that is still recording for the next run', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', '2026-10-04T01:00:00.000Z');
    const r = await collect({ source: source([conv('a'), conv('b', true)]), store, timeZone: 'America/Mexico_City', now: NOW });
    expect(r.saved).toEqual(['a']);
    expect(r.skippedCapturing).toEqual(['b']);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
    expect(await store.getSession('b')).toBeNull();
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
    expect(r.saved).toEqual(['a']);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
  });
});
