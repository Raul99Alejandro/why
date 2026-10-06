import type { Analysis, DayLog, PublishedDay, Session, SessionState } from '../domain/types.js';
import type { IgnoredKind, SessionRecord, Store } from './store.js';

export class MemoryStore implements Store {
  private sessions = new Map<string, SessionRecord>();
  private days = new Map<string, DayLog>();
  private published = new Map<string, PublishedDay>();
  private cursor: { cursor: string; syncedAt: string } | null = null;

  async getCursor() {
    return this.cursor;
  }

  async setCursor(cursor: string, syncedAt: string) {
    this.cursor = { cursor, syncedAt };
  }

  async putSession(session: Session, day: string, rawTtlEpochSeconds?: number): Promise<boolean> {
    if (this.sessions.has(session.id)) return false;
    this.sessions.set(session.id, {
      session: structuredClone(session),
      state: 'captured',
      day,
      analysis: null,
    });
    return true;
  }

  private ignored = new Map<string, { day: string; kind: IgnoredKind }>();

  async recordIgnored(day: string, sessionId: string, kind: IgnoredKind) {
    if (this.ignored.has(sessionId)) return false;
    this.ignored.set(sessionId, { day, kind });
    return true;
  }

  private classify = new Map<string, { failures: number; retryAfter: string }>();

  async getClassifyState(sessionId: string) {
    const s = this.classify.get(sessionId);
    return s ? { ...s } : null;
  }

  async setClassifyState(sessionId: string, failures: number, retryAfter: string) {
    this.classify.set(sessionId, { failures, retryAfter });
  }

  async isIgnored(sessionId: string) {
    return this.ignored.has(sessionId);
  }

  async ignoredCounts(day: string) {
    const all = [...this.ignored.values()].filter((i) => i.day === day);
    return { personal: all.filter((i) => i.kind === 'personal').length, offHours: all.filter((i) => i.kind === 'offHours').length };
  }

  async getSession(id: string) {
    const r = this.sessions.get(id);
    return r ? structuredClone(r) : null;
  }

  async setAnalysis(id: string, analysis: Analysis | null, state: SessionState) {
    const r = this.sessions.get(id);
    if (r) this.sessions.set(id, { ...r, analysis: structuredClone(analysis), state });
  }

  async listSessionsOn(day: string) {
    return [...this.sessions.values()]
      .filter((r) => r.day === day)
      .sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt))
      .map((r) => structuredClone(r));
  }

  async listPending() {
    return [...this.sessions.values()].filter((r) => r.state !== 'analyzed' && r.state !== 'pending_review').map((r) => r.session.id);
  }

  async putDay(log: DayLog) {
    this.days.set(log.date, structuredClone(log));
  }

  async getDay(date: string) {
    const d = this.days.get(date);
    return d ? structuredClone(d) : null;
  }

  async deleteDay(date: string) {
    this.days.delete(date);
  }

  async listDays() {
    return [...this.days.keys()].sort().reverse();
  }

  async putPublished(day: PublishedDay) {
    this.published.set(day.date, structuredClone(day));
  }

  async getPublished(date: string) {
    const d = this.published.get(date);
    return d ? structuredClone(d) : null;
  }

  async listPublished() {
    return [...this.published.keys()].sort().reverse();
  }

  async deletePublished(date: string) {
    this.published.delete(date);
  }

  async forgetSession(id: string) {
    const r = this.sessions.get(id);
    if (!r) return null;
    this.sessions.delete(id);
    return r.day;
  }
}
