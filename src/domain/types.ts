export type Utterance = { speaker: string; text: string; at?: string };
export type Session = { id: string; startedAt: string; endedAt: string; utterances: Utterance[] };
export type SessionState = 'captured' | 'analyzed' | 'pending_analysis';
export type Decision = { what: string; why: string; quote: string; quoteOriginal: string; at: string };
export type Analysis = { topic: string; summary: string; decisions: Decision[]; todos: string[]; openQuestions: string[] };
export type CommitRef = { repo: string; sha: string; message: string; url: string; at: string };
export type DayDecision = Decision & { sessionId: string; commits: string[] };
export type DayLog = {
  date: string; summary: string;
  sessions: { id: string; startedAt: string; endedAt: string; topic: string }[];
  decisions: DayDecision[];
  todos: { text: string; sessionId: string }[];
  openQuestions: { text: string; sessionId: string }[];
  commits: CommitRef[];
  updatedAt: string;
};
export type PublishedDay = Omit<DayLog, 'decisions'> & {
  decisions: Omit<DayDecision, 'quoteOriginal'>[];
  publishedAt: string;
};
