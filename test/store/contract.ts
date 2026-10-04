import { describe, expect, it } from 'vitest';
import type { Analysis, DayLog, Session } from '../../src/domain/types.js';
import type { Store } from '../../src/store/store.js';

export const session = (id: string, startedAt = '2026-10-03T18:00:00.000Z'): Session => ({
  id,
  startedAt,
  endedAt: '2026-10-03T18:20:00.000Z',
  utterances: [{ speaker: 'Unknown', text: 'We decided to ship on Friday.' }],
});

export const analysis: Analysis = {
  topic: 'Release',
  summary: 'Picked a date.',
  decisions: [],
  todos: ['Ship'],
  openQuestions: [],
};

export const day = (date: string): DayLog => ({
  date,
  summary: 's',
  sessions: [],
  decisions: [],
  todos: [],
  openQuestions: [],
  commits: [],
  updatedAt: '2026-10-03T20:00:00.000Z',
});

export function storeContract(name: string, make: () => Promise<Store>): void {
  describe(`Store contract: ${name}`, () => {
    it('saves a session once and lists it on its day', async () => {
      const s = await make();
      expect(await s.putSession(session('a'), '2026-10-03', 9_999_999_999)).toBe(true);
      expect(await s.putSession(session('a'), '2026-10-03', 9_999_999_999)).toBe(false);
      const on = await s.listSessionsOn('2026-10-03');
      expect(on.map((r) => r.session.id)).toEqual(['a']);
      expect(on[0]!.state).toBe('captured');
    });

    it('records the analysis and leaves pending only what is not analyzed', async () => {
      const s = await make();
      await s.putSession(session('a'), '2026-10-03', 9_999_999_999);
      await s.putSession(session('b'), '2026-10-03', 9_999_999_999);
      await s.setAnalysis('a', analysis, 'analyzed');
      expect((await s.getSession('a'))!.analysis!.topic).toBe('Release');
      expect((await s.listPending()).sort()).toEqual(['b']);
    });

    it('keeps the cursor', async () => {
      const s = await make();
      expect(await s.getCursor()).toBeNull();
      await s.setCursor('v1-1', '2026-10-03T20:00:00.000Z');
      expect(await s.getCursor()).toEqual({
        cursor: 'v1-1',
        syncedAt: '2026-10-03T20:00:00.000Z',
      });
    });

    it('keeps private days and published days apart', async () => {
      const s = await make();
      await s.putDay(day('2026-10-03'));
      await s.putDay(day('2026-10-04'));
      expect(await s.listDays()).toEqual(['2026-10-04', '2026-10-03']);
      expect(await s.listPublished()).toEqual([]);
      expect(await s.getPublished('2026-10-03')).toBeNull();
      await s.putPublished({
        ...day('2026-10-03'),
        decisions: [],
        publishedAt: '2026-10-05T00:00:00.000Z',
      });
      expect(await s.listPublished()).toEqual(['2026-10-03']);
      await s.deletePublished('2026-10-03');
      expect(await s.listPublished()).toEqual([]);
    });

    it('forgets a session completely', async () => {
      const s = await make();
      await s.putSession(session('a'), '2026-10-03', 9_999_999_999);
      await s.setAnalysis('a', analysis, 'analyzed');
      expect(await s.forgetSession('a')).toBe('2026-10-03');
      expect(await s.getSession('a')).toBeNull();
      expect(await s.listSessionsOn('2026-10-03')).toEqual([]);
      expect(await s.forgetSession('a')).toBeNull();
    });
  });
}
