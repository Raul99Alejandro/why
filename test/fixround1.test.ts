import { describe, expect, it } from 'vitest';
import { collect, MAX_CLASSIFY_FAILURES, classifyBackoffMs } from '../src/collect.js';
import { DynamoStore } from '../src/store/dynamo.js';
import { MemoryStore } from '../src/store/memory.js';
import { classifierText, DEFAULT_HOURS, readWorkHours } from '../src/workfilter.js';
import type { BeeConversation, BeeSource } from '../src/bee/source.js';

const OFFICE = DEFAULT_HOURS;
const WORK = '2026-10-05T16:00:00.000Z';
const conv: BeeConversation = { id: 'w', startedAt: WORK, endedAt: WORK, capturing: false, utterances: [{ speaker: 'U', text: 'secret', at: WORK }] };
const source = (nextCursor = 'v1-2'): BeeSource => ({ async changedSince() { return { ids: ['w'], nextCursor }; }, async conversation() { return conv; } });
const run = (store: MemoryStore, now: Date, classify: () => Promise<'work' | 'personal' | null>) =>
  collect({ source: source(), store, timeZone: 'America/Mexico_City', now, workHours: OFFICE, classify });

describe('classifier retry cap', () => {
  it('backs off between tries, then drops the text, keeps only a marker and moves the cursor on', async () => {
    const store = new MemoryStore();
    await store.setCursor('v1-1', 'x');
    let calls = 0;
    const fail = async () => { calls++; return null; };
    let now = new Date('2026-10-06T12:00:00.000Z');
    const first = await run(store, now, fail);
    expect(first.classifyFailed).toHaveLength(1);
    // Still backing off: no new call, cursor held.
    const again = await run(store, new Date(now.getTime() + 60_000), fail);
    expect(calls).toBe(1);
    expect(again.classifyFailed).toHaveLength(1);
    expect((await store.getCursor())!.cursor).toBe('v1-1');
    let last = first;
    for (let i = 1; i < MAX_CLASSIFY_FAILURES; i++) {
      now = new Date(now.getTime() + classifyBackoffMs(i) + 1000);
      last = await run(store, now, fail);
    }
    expect(calls).toBe(MAX_CLASSIFY_FAILURES);
    expect(last.classifyGaveUp).toHaveLength(1);
    expect((await store.getCursor())!.cursor).toBe('v1-2');
    const id = last.classifyGaveUp[0]!;
    expect(await store.getSession(id)).toBeNull(); // no utterance text stored
    expect(await store.isIgnored(id)).toBe(true);
    expect(await store.listPending()).toEqual([]);
    expect(await store.ignoredCounts('2026-10-05')).toEqual({ personal: 0, offHours: 0 }); // not shown as personal
    // Seen again: not judged again.
    await run(store, new Date(now.getTime() + 3_600_000), fail);
    expect(calls).toBe(MAX_CLASSIFY_FAILURES);
  });

  it('a success after some failures stores the segment normally', async () => {
    const store = new MemoryStore();
    const now = new Date('2026-10-06T12:00:00.000Z');
    await run(store, now, async () => null);
    const r = await run(store, new Date(now.getTime() + 10 * 60_000), async () => 'work');
    expect(r.saved).toHaveLength(1);
    expect(r.classifyGaveUp).toEqual([]);
  });
});

describe('ignored count ordering in DynamoStore', () => {
  // A tiny fake of the document client: keyed puts with the one condition recordIgnored uses.
  const fake = (failOn?: (item: Record<string, unknown>) => boolean) => {
    const items = new Map<string, Record<string, unknown>>();
    const doc = {
      async send(cmd: { constructor: { name: string }; input: Record<string, any> }) {
        const i = cmd.input;
        if (cmd.constructor.name === 'PutCommand') {
          if (failOn?.(i.Item)) throw new Error('crash');
          const k = `${i.Item.pk}|${i.Item.sk}`;
          if (i.ConditionExpression && items.has(k)) { const e = new Error('x'); e.name = 'ConditionalCheckFailedException'; throw e; }
          items.set(k, i.Item);
          return {};
        }
        if (cmd.constructor.name === 'QueryCommand') {
          const pk = i.ExpressionAttributeValues[':pk'], p = i.ExpressionAttributeValues[':p'];
          return { Items: [...items.values()].filter(x => x.pk === pk && (!p || String(x.sk).startsWith(p))) };
        }
        throw new Error(`unexpected ${cmd.constructor.name}`);
      }
    };
    const store = new DynamoStore('t', { region: 'us-east-1' });
    (store as unknown as { doc: unknown }).doc = doc;
    return { store, items };
  };

  it('never leaves a marker without its count: a crash after the count is repaired by the retry', async () => {
    let crash = true;
    const { store, items } = fake(item => crash && item.sk === 'IGN');
    await expect(store.recordIgnored('2026-10-05', 'p1', 'personal')).rejects.toThrow('crash');
    expect([...items.keys()].some(k => k.endsWith('|IGN'))).toBe(false);
    expect(await store.ignoredCounts('2026-10-05')).toEqual({ personal: 1, offHours: 0 });
    crash = false;
    expect(await store.recordIgnored('2026-10-05', 'p1', 'personal')).toBe(true);
    expect(await store.recordIgnored('2026-10-05', 'p1', 'personal')).toBe(false);
    expect(await store.ignoredCounts('2026-10-05')).toEqual({ personal: 1, offHours: 0 });
  });
});

describe('classifierText sampling', () => {
  it('keeps the head, the middle and the tail within the cap', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => ({ speaker: 'U', text: `line-${String(i).padStart(4, '0')}` }));
    const t = classifierText({ id: 's', startedAt: 'a', endedAt: 'b', utterances: lines });
    expect(t.length).toBeLessThanOrEqual(6000);
    expect(t).toContain('line-0000');
    expect(t).toContain('line-2999');
    expect(t).toMatch(/line-1[45]\d\d/); // from the middle
  });
});

describe('invalid TIME_ZONE', () => {
  it('falls back to the default instead of throwing', () => {
    expect(readWorkHours({ TIME_ZONE: 'Not/AZone' }).timeZone).toBe('America/Mexico_City');
    expect(readWorkHours({ TIME_ZONE: 'UTC' }).timeZone).toBe('UTC');
  });
});
