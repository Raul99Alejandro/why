import type { CommitRef } from '../domain/types.js';
import type { DaySource } from './source.js';

/** A decision as agents see it: no original-language quote, commits resolved. */
export type AgentDecision = {
  id: string; date: string; sessionId: string; what: string; why: string; quote: string; commits: CommitRef[];
  followUp?: { text: string; status: 'open' | 'closed'; closedBy?: CommitRef };
  changedLater?: { id: string; date: string };
};

const MAX_SEARCH = 20;
/** Agents see the last 30 days of logs. */
export const WINDOW_DAYS = 30;

/** Loads the newest `days` days and maps decisions field by field (never spread, so quoteOriginal cannot leak). */
async function load(src: DaySource, days: number): Promise<AgentDecision[]> {
  const dates = (await src.listDays()).slice(0, days);
  const logs = await Promise.all(dates.map(d => src.getDay(d)));
  const out: AgentDecision[] = [];
  for (const log of logs) {
    if (!log) continue;
    const seen = new Map<string, number>();
    for (const d of log.decisions) {
      const index = seen.get(d.sessionId) ?? 0;
      seen.set(d.sessionId, index + 1);
      out.push({
        id: d.id ?? `${d.sessionId}#${index}`, date: log.date, sessionId: d.sessionId, what: d.what, why: d.why, quote: d.quote,
        commits: d.commits.map(sha => log.commits.find(c => c.sha === sha) ?? { repo: '', sha, message: '', url: '', at: '' }),
        ...(d.followUp ? { followUp: { text: d.followUp.text, status: d.followUp.status, ...(d.followUp.closedBy ? { closedBy: d.followUp.closedBy } : {}) } } : {}),
        ...(d.changedLater ? { changedLater: { id: d.changedLater.id, date: d.changedLater.date } } : {}),
      });
    }
  }
  return out;
}

/** Decisions of the newest `days` days, newest day first. */
export const recentDecisions = (src: DaySource, days = WINDOW_DAYS) => load(src, days);

/** Case-insensitive: every query token (longer than one char) appears in what, why, quote or commit messages. */
export async function searchDecisions(src: DaySource, query: string): Promise<AgentDecision[]> {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (!tokens.length) return [];
  const all = await load(src, WINDOW_DAYS);
  return all.filter(d => {
    const hay = [d.what, d.why, d.quote, ...d.commits.map(c => c.message)].join(' ').toLowerCase();
    return tokens.every(t => hay.includes(t));
  }).slice(0, MAX_SEARCH);
}

/** Decisions that made or closed the given commit (sha prefix match either way), optionally in one repo. */
export async function explainCommit(src: DaySource, sha: string, repo?: string): Promise<AgentDecision[]> {
  const s = sha.toLowerCase();
  if (!s) return [];
  const hit = (c: CommitRef) => !!c.sha && (!repo || c.repo === repo) && (c.sha.toLowerCase().startsWith(s) || s.startsWith(c.sha.toLowerCase()));
  const all = await load(src, WINDOW_DAYS);
  return all.filter(d => d.commits.some(hit) || (d.followUp?.closedBy && hit(d.followUp.closedBy)));
}

/** Decisions whose follow-up is still open. */
export async function openFollowUps(src: DaySource): Promise<AgentDecision[]> {
  return (await load(src, WINDOW_DAYS)).filter(d => d.followUp?.status === 'open');
}
