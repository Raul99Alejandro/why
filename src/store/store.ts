import type { Analysis, DayLog, PublishedDay, Session, SessionState } from '../domain/types.js';

export interface SessionRecord {
  session: Session;
  state: SessionState;
  day: string;
  analysis: Analysis | null;
}

export interface Store {
  getCursor(): Promise<{ cursor: string; syncedAt: string } | null>;
  setCursor(cursor: string, syncedAt: string): Promise<void>;
  /** Saves a finished session once. Returns false if it already existed (idempotent). */
  putSession(session: Session, day: string, rawTtlEpochSeconds: number): Promise<boolean>;
  getSession(id: string): Promise<SessionRecord | null>;
  setAnalysis(id: string, analysis: Analysis | null, state: SessionState): Promise<void>;
  listSessionsOn(day: string): Promise<SessionRecord[]>;
  listPending(): Promise<string[]>; // ids in state captured or pending_analysis
  putDay(log: DayLog): Promise<void>;
  getDay(date: string): Promise<DayLog | null>;
  deleteDay(date: string): Promise<void>;
  listDays(): Promise<string[]>; // newest first
  putPublished(day: PublishedDay): Promise<void>;
  getPublished(date: string): Promise<PublishedDay | null>;
  listPublished(): Promise<string[]>;
  deletePublished(date: string): Promise<void>;
  /** Deletes every record of a session (META, RAW, ANALYSIS, its DAY# reference). Returns its day, or null. */
  forgetSession(id: string): Promise<string | null>;
}
