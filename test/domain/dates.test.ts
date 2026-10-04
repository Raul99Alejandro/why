import { describe, expect, it } from 'vitest';
import { localDay } from '../../src/domain/dates.js';

describe('localDay', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 19:30 in Mexico City is 01:30 UTC the next day.
    expect(localDay('2026-10-04T01:30:00.000Z', 'America/Mexico_City')).toBe('2026-10-03');
  });
  it('keeps a midday session on its day', () => {
    expect(localDay('2026-10-03T18:00:00.000Z', 'America/Mexico_City')).toBe('2026-10-03');
  });
});
