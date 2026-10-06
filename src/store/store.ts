import type { Analysis, CommitRef, DayLog, PublishedDay, Session, SessionState } from '../domain/types.js';

export interface SessionRecord {
  session: Session;
  state: SessionState;
  day: string;
  analysis: Analysis | null;
}

/**
 * What Why knows about one analyzed decision beyond its text: how it relates to earlier ones and which Bee todos it owns.
 * It holds ids and short follow-up wording only (the follow-up step is Why's own sentence), never transcript text.
 * Its presence means "already judged": a decision is never judged, alerted or turned into a todo twice.
 */
export type DecisionRecord = {
  id: string; sessionId: string; day: string; at: string;
  relation?: { kind: 'reversal' | 'refinement' | 'restatement'; priorId: string; priorDay: string };
  /** Reversal alert in Bee: pending until the CLI call succeeded, then done with the Bee todo id. 'skipped' for old decisions. */
  alert?: { state: 'pending' | 'done' | 'skipped'; todoId?: string };
  /** Follow-up todo: pending (to create) -> open (in Bee) -> closing (matched, Bee completion to retry) -> closed. */
  followUp?: { state: 'pending' | 'open' | 'closing' | 'closed' | 'skipped'; text: string; todoId?: string; checked: string[]; closedBy?: CommitRef };
};

export type IgnoredKind = 'personal' | 'offHours' | 'unclassified';

export interface Store {
  getCursor(): Promise<{ cursor: string; syncedAt: string } | null>;
  setCursor(cursor: string, syncedAt: string): Promise<void>;
  /** Saves a finished session once. Returns false if it already existed (idempotent). */
  putSession(session: Session, day: string, rawTtlEpochSeconds: number): Promise<boolean>;
  /** Remembers that a segment was discarded by the work filter (id and kind only, never its text). Returns false if it was already recorded. */
  recordIgnored(day: string, sessionId: string, kind: IgnoredKind): Promise<boolean>;
  isIgnored(sessionId: string): Promise<boolean>;
  /** How often the classifier failed for a segment, and when it may be tried again. */
  getClassifyState(sessionId: string): Promise<{ failures: number; retryAfter: string } | null>;
  setClassifyState(sessionId: string, failures: number, retryAfter: string): Promise<void>;
  ignoredCounts(day: string): Promise<{ personal: number; offHours: number }>;
  getSession(id: string): Promise<SessionRecord | null>;
  setAnalysis(id: string, analysis: Analysis | null, state: SessionState): Promise<void>;
  listSessionsOn(day: string): Promise<SessionRecord[]>;
  listPending(): Promise<string[]>; // ids in state captured or pending_analysis (never pending_review)
  putDay(log: DayLog): Promise<void>;
  getDay(date: string): Promise<DayLog | null>;
  deleteDay(date: string): Promise<void>;
  listDays(): Promise<string[]>; // newest first
  putPublished(day: PublishedDay): Promise<void>;
  getPublished(date: string): Promise<PublishedDay | null>;
  listPublished(): Promise<string[]>;
  deletePublished(date: string): Promise<void>;
  putDecisionRecord(record: DecisionRecord): Promise<void>;
  /** Every decision record of a local day (any order). */
  listDecisionRecords(day: string): Promise<DecisionRecord[]>;
  /** Deletes every record of a session (META, RAW, ANALYSIS, its DAY# reference, its decision records). Returns its day, or null. */
  forgetSession(id: string): Promise<string | null>;
}
