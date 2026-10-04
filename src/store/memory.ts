import type { Analysis, DayLog, PublishedDay, Session, SessionState } from '../domain/types.js';
import type { SessionRecord, Store } from './store.js';

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
    return [...this.sessions.values()].filter((r) => r.state !== 'analyzed').map((r) => r.session.id);
  }

  async putDay(log: DayLog) {
    this.days.set(log.date, structuredClone(log));
  }

  async getDay(date: string) {
    const d = this.days.get(date);
    return d ? structuredClone(d) : null;
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
