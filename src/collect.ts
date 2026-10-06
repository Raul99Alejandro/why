import type { BeeConversation, BeeSource } from './bee/source.js';
import { localDay } from './domain/dates.js';
import type { Session, Utterance } from './domain/types.js';
import type { Store } from './store/store.js';
import { log } from './log.js';
import { segmentOutcome, trimToHours, type SegmentLabel, type WorkHours } from './workfilter.js';

export interface CollectResult {
  saved: string[]; skippedCapturing: string[]; cursor: string;
  /** Segments discarded in this run (counts only). */
  ignoredPersonal: number; ignoredOffHours: number;
  /** Segments the classifier could not judge: not stored, retried next run. */
  classifyFailed: string[];
  /** Days whose ignored counters changed. */
  ignoredDays: string[];
}
const RAW_TTL_SECONDS = 30 * 24 * 3600;
/** A longer pause between utterances starts a new session. */
export const GAP_MS = 20 * 60_000;
/** A segment whose last utterance is older than this counts as finished even if Bee still says CAPTURING. */
export const QUIET_MS = 30 * 60_000;

/**
 * Bee can keep one conversation CAPTURING for many hours and append every new recording to it,
 * so a conversation is cut into sessions at pauses longer than GAP_MS.
 */
export function splitSessions(conv: BeeConversation, now: Date): { session: Session; finished: boolean }[] {
  const timed = conv.utterances
    .filter((u): u is Utterance & { at: string } => !!u.at)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (timed.length === 0) {
    const startMs = Date.parse(conv.startedAt);
    return [{
      session: { id: `${conv.id}-${Math.floor(startMs / 1000)}`, startedAt: conv.startedAt, endedAt: conv.endedAt ?? conv.startedAt, utterances: conv.utterances },
      finished: !conv.capturing
    }];
  }
  // Segment index and sort position of every timed utterance.
  const segOf = new Map<Utterance, number>();
  const posOf = new Map<Utterance, number>();
  let seg = 0;
  timed.forEach((u, i) => {
    if (i > 0 && Date.parse(u.at) - Date.parse(timed[i - 1]!.at) > GAP_MS) seg++;
    segOf.set(u, seg);
    posOf.set(u, i);
  });
  // Untimed utterances follow the preceding timed one (in Bee's order), or join the first session.
  const placed: { u: Utterance; seg: number; key: number }[] = [];
  let prev: Utterance | null = null;
  conv.utterances.forEach(u => {
    if (u.at) { prev = u; placed.push({ u, seg: segOf.get(u)!, key: posOf.get(u)! }); }
    else placed.push({ u, seg: prev ? segOf.get(prev)! : 0, key: prev ? posOf.get(prev)! + 0.5 : -1 });
  });
  placed.sort((a, b) => a.key - b.key); // stable: untimed keep their relative order
  return Array.from({ length: seg + 1 }, (_, i) => {
    const utterances = placed.filter(p => p.seg === i).map(p => p.u);
    const times = utterances.filter(u => u.at).map(u => u.at!);
    const startedAt = times[0]!;
    const endedAt = times[times.length - 1]!;
    return {
      session: { id: `${conv.id}-${Math.floor(Date.parse(startedAt) / 1000)}`, startedAt, endedAt, utterances },
      finished: !conv.capturing || now.getTime() - Date.parse(endedAt) > QUIET_MS
    };
  });
}

/**
 * Brings finished Bee sessions into the store through the work filter (W-01): what was said outside work hours is cut,
 * then one classifier call per finished segment decides work or personal. Only work is stored; the rest leaves a count.
 * A session still recording, or one the classifier could not judge, keeps the cursor where it was.
 */
export async function collect(opts: {
  source: BeeSource; store: Store; timeZone: string; now: Date;
  workHours: WorkHours;
  /** Null means the classifier failed: the segment stays pending. */
  classify: (session: Session) => Promise<SegmentLabel | null>;
}): Promise<CollectResult> {
  const previous = await opts.store.getCursor();
  const { ids, nextCursor } = await opts.source.changedSince(previous?.cursor ?? null);
  const saved: string[] = [];
  const skippedCapturing: string[] = [];
  const classifyFailed: string[] = [];
  const ignoredDays = new Set<string>();
  let ignoredPersonal = 0;
  let ignoredOffHours = 0;
  for (const id of ids) {
    const c = await opts.source.conversation(id);
    for (const { session, finished } of splitSessions(c, opts.now)) {
      if (!finished) { skippedCapturing.push(session.id); continue; }
      if (session.utterances.length === 0) continue;
      // A conversation seen again (the cursor was held back) is not judged or counted twice.
      if (await opts.store.getSession(session.id) || await opts.store.isIgnored(session.id)) continue;
      const kept = trimToHours(session, opts.workHours);
      const label = kept ? await opts.classify(kept) : null;
      const outcome = segmentOutcome(kept !== null, label);
      if (outcome === 'ignoredOffHours' || outcome === 'ignoredPersonal') {
        const day = localDay(session.startedAt, opts.timeZone);
        const kind = outcome === 'ignoredPersonal' ? 'personal' : 'offHours';
        if (await opts.store.recordIgnored(day, session.id, kind)) {
          if (kind === 'personal') ignoredPersonal++; else ignoredOffHours++;
          ignoredDays.add(day);
        }
      } else if (outcome === 'pending') {
        classifyFailed.push(session.id);
      } else {
        const stored = kept!;
        const created = await opts.store.putSession(
          stored,
          localDay(stored.startedAt, opts.timeZone),
          Math.floor(opts.now.getTime() / 1000) + RAW_TTL_SECONDS
        );
        if (created) saved.push(stored.id);
      }
    }
  }
  const hold = skippedCapturing.length > 0 || classifyFailed.length > 0 || !nextCursor;
  const cursor = hold ? (previous?.cursor ?? '') : nextCursor;
  await opts.store.setCursor(cursor, opts.now.toISOString());
  log({ level: 'info', msg: 'work_filter', stored: saved.length, ignoredPersonal, ignoredOffHours, classifyFailed: classifyFailed.length });
  return { saved, skippedCapturing, cursor, ignoredPersonal, ignoredOffHours, classifyFailed, ignoredDays: [...ignoredDays].sort() };
}
