import type { BeeSource } from './bee/source.js';
import { localDay } from './domain/dates.js';
import type { Store } from './store/store.js';

export interface CollectResult { saved: string[]; skippedCapturing: string[]; cursor: string }
const RAW_TTL_SECONDS = 30 * 24 * 3600;

/** Brings finished Bee sessions into the store. A session still recording keeps the cursor where it was. */
export async function collect(opts: { source: BeeSource; store: Store; timeZone: string; now: Date }): Promise<CollectResult> {
  const previous = await opts.store.getCursor();
  const { ids, nextCursor } = await opts.source.changedSince(previous?.cursor ?? null);
  const saved: string[] = [];
  const skippedCapturing: string[] = [];
  for (const id of ids) {
    const c = await opts.source.conversation(id);
    if (c.capturing || !c.endedAt) { skippedCapturing.push(id); continue; }
    if (c.utterances.length === 0) continue;
    const created = await opts.store.putSession(
      { id: c.id, startedAt: c.startedAt, endedAt: c.endedAt, utterances: c.utterances },
      localDay(c.startedAt, opts.timeZone),
      Math.floor(opts.now.getTime() / 1000) + RAW_TTL_SECONDS
    );
    if (created) saved.push(c.id);
  }
  const cursor = skippedCapturing.length > 0 || !nextCursor ? (previous?.cursor ?? '') : nextCursor;
  await opts.store.setCursor(cursor, opts.now.toISOString());
  return { saved, skippedCapturing, cursor };
}
