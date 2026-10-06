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
export type TodoSlot = {
  /** pending -> creating (text saved, Bee call in flight or crashed) -> done; skipped: nothing to do; gone: the Bee todo was deleted or kept failing. */
  state: 'pending' | 'creating' | 'done' | 'skipped' | 'gone';
  text?: string; todoId?: string; attempts?: number;
};
export type DecisionRecord = {
  id: string; sessionId: string; day: string; at: string;
  /** Version for optimistic writes: a save succeeds only if the stored version is still this one. */
  v: number;
  relation?: { kind: 'reversal' | 'refinement' | 'restatement'; priorId: string; priorDay: string };
  /** Reversal alert in Bee. 'skipped' for old decisions. */
  alert?: TodoSlot;
  /** Follow-up todo: pending/creating/done(open in Bee) -> closing (matched, completion to retry) -> closed. */
  followUp?: {
    state: 'pending' | 'creating' | 'open' | 'closing' | 'closed' | 'skipped' | 'gone';
    text: string; todoId?: string; checked: string[]; closedBy?: CommitRef; attempts?: number;
  };
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
  /** Stores a new record (version 0). Returns false if one with that id already exists. */
  createDecisionRecord(record: DecisionRecord): Promise<boolean>;
  /** Saves a changed record if its stored version is still `record.v`; on success bumps `record.v`. Returns false when another writer got there first. */
  saveDecisionRecord(record: DecisionRecord): Promise<boolean>;
  deleteDecisionRecord(day: string, id: string): Promise<void>;
  /** Every decision record of a local day (any order). */
  listDecisionRecords(day: string): Promise<DecisionRecord[]>;
  /** Deletes every record of a session (META, RAW, ANALYSIS, its DAY# reference, its decision records). Returns its day, or null. */
  forgetSession(id: string): Promise<string | null>;
}
