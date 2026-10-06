import { describe, expect, it } from 'vitest';
import type { Analysis, DayLog, Session } from '../../src/domain/types.js';
import type { DecisionRecord, Store } from '../../src/store/store.js';

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

    it('deletes a day log', async () => {
      const s = await make();
      await s.putDay(day('2026-10-03'));
      await s.putDay(day('2026-10-04'));
      await s.deleteDay('2026-10-03');
      expect(await s.getDay('2026-10-03')).toBeNull();
      expect(await s.listDays()).toEqual(['2026-10-04']);
      await s.deleteDay('2026-10-03');
    });

    it('counts discarded segments once per id and per day', async () => {
      const s = await make();
      expect(await s.isIgnored('p1')).toBe(false);
      expect(await s.recordIgnored('2026-10-03', 'p1', 'personal')).toBe(true);
      expect(await s.recordIgnored('2026-10-03', 'p1', 'personal')).toBe(false);
      await s.recordIgnored('2026-10-03', 'p2', 'offHours');
      await s.recordIgnored('2026-10-04', 'p3', 'personal');
      expect(await s.isIgnored('p1')).toBe(true);
      expect(await s.ignoredCounts('2026-10-03')).toEqual({ personal: 1, offHours: 1 });
      expect(await s.ignoredCounts('2026-10-05')).toEqual({ personal: 0, offHours: 0 });
      expect(await s.listSessionsOn('2026-10-03')).toEqual([]);
    });

    it('keeps versioned decision records per day and deletes them with their session', async () => {
      const s = await make();
      const rec = (id: string, sessionId: string, day: string): DecisionRecord => ({ id, sessionId, day, at: `${day}T18:00:00.000Z`, v: 0 });
      await s.putSession(session('a'), '2026-10-03', 9_999_999_999);
      expect(await s.createDecisionRecord({ ...rec('a#0', 'a', '2026-10-03'), relation: { kind: 'reversal', priorId: 'z#0', priorDay: '2026-10-01' }, alert: { state: 'done', todoId: '7' } })).toBe(true);
      expect(await s.createDecisionRecord(rec('a#0', 'a', '2026-10-03'))).toBe(false); // never created twice
      const a1 = { ...rec('a#1', 'a', '2026-10-03'), followUp: { state: 'open' as const, text: 'Do it', todoId: '8', checked: [] } };
      await s.createDecisionRecord(a1);
      await s.createDecisionRecord(rec('b#0', 'b', '2026-10-03'));
      const mine = { ...a1, followUp: { ...a1.followUp, state: 'closed' as const, checked: ['c1'] } };
      const other = { ...a1 }; // a second writer that read the same version
      expect(await s.saveDecisionRecord(mine)).toBe(true);
      expect(mine.v).toBe(1);
      expect(await s.saveDecisionRecord({ ...other, followUp: { ...a1.followUp, state: 'closing' as const } })).toBe(false); // stale version loses
      expect((await s.listDecisionRecords('2026-10-03')).map((r) => r.id).sort()).toEqual(['a#0', 'a#1', 'b#0']);
      expect((await s.listDecisionRecords('2026-10-03')).find((r) => r.id === 'a#1')!.followUp!.state).toBe('closed');
      expect(await s.listDecisionRecords('2026-10-04')).toEqual([]);
      await s.deleteDecisionRecord('2026-10-03', 'b#0');
      await s.forgetSession('a');
      expect(await s.listDecisionRecords('2026-10-03')).toEqual([]);
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
