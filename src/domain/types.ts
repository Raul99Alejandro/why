export type Utterance = { speaker: string; text: string; at?: string };
export type Session = { id: string; startedAt: string; endedAt: string; utterances: Utterance[] };
export type SessionState = 'captured' | 'analyzed' | 'pending_analysis' | 'pending_review';
export type Decision = { what: string; why: string; quote: string; quoteOriginal: string; at: string };
export type Analysis = { topic: string; summary: string; decisions: Decision[]; todos: string[]; openQuestions: string[] };
export type CommitRef = { repo: string; sha: string; message: string; url: string; at: string };
export type Relation = 'reversal' | 'refinement' | 'restatement' | 'unrelated';
/** One earlier decision in the chain a decision changed (nearest first). */
export type ChangeStep = { id: string; date: string; what: string; sessionId: string };
export type DecisionChange = {
  /** The decision that was contradicted first, then the ones before it: A -> B -> A shows both steps. */
  from: ChangeStep[];
  /** Commits of the nearest old decision: work that may need undoing. */
  commits: CommitRef[];
};
export type FollowUpView = { text: string; status: 'open' | 'closed'; closedBy?: CommitRef };
export type DayDecision = Decision & {
  sessionId: string; commits: string[];
  /** Stable id: session id and position in its analysis. */
  id?: string;
  /** Set when this decision directly contradicts an earlier one. */
  change?: DecisionChange;
  /** Set when a later decision reversed this one. */
  changedLater?: { id: string; date: string };
  /** Set when this decision narrows or extends an earlier one (no alert). */
  refines?: { id: string; date: string };
  followUp?: FollowUpView;
};
export type DayLog = {
  date: string; summary: string;
  sessions: { id: string; startedAt: string; endedAt: string; topic: string }[];
  decisions: DayDecision[];
  todos: { text: string; sessionId: string }[];
  openQuestions: { text: string; sessionId: string }[];
  commits: CommitRef[];
  /** Conversations the work filter discarded as personal that day (a count, never content). */
  ignoredPersonal?: number;
  updatedAt: string;
};
export type PublishedDay = Omit<DayLog, 'decisions'> & {
  decisions: Omit<DayDecision, 'quoteOriginal'>[];
  publishedAt: string;
};
