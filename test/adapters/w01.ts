import { segmentOutcome, trimToHours, type WorkHours } from '../../src/workfilter.js';
import type { Adapter } from './index.js';

const toHours = (h: { days: number[]; start: string; end: string; timeZone: string }): WorkHours => ({
  days: h.days, startMin: Number(h.start.slice(0, 2)) * 60 + Number(h.start.slice(3)), endMin: Number(h.end.slice(0, 2)) * 60 + Number(h.end.slice(3)), timeZone: h.timeZone
});

export const w01: Adapter = (given, when) => {
  const hours = toHours(given.hours);
  if (when.trim) {
    const session = { id: 's', startedAt: given.utterancesAt[0], endedAt: given.utterancesAt.at(-1), utterances: given.utterancesAt.map((at: string) => ({ speaker: 'Unknown', text: 'x', at })) };
    return { kept: trimToHours(session, hours)?.utterances.length ?? 0 };
  }
  const session = { id: 's', startedAt: given.session.startedAt, endedAt: given.session.endedAt, utterances: [{ speaker: 'Unknown', text: 'x', at: given.session.startedAt }] };
  const kept = trimToHours(session, hours);
  return { outcome: segmentOutcome(kept !== null, given.label) };
};
