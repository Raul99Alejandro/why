import * as z from 'zod/v4';
import type { CommitRef, DayDecision, DayLog } from './domain/types.js';
import { commitsOn } from './github.js';
import { forcedTool, type ConverseFn } from './nova.js';
import type { Store } from './store/store.js';

const summarySchema = z.object({ summary: z.string().trim().min(1).describe('One English sentence about what the day was about.') });
const linksSchema = z.object({ links: z.array(z.object({ decision: z.number().int().min(0), commits: z.array(z.string()) })) });
const json = (s: z.ZodType) => { const { $schema: _i, ...rest } = z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown>; return rest; };

export async function matchCommits(decisions: DayDecision[], commits: CommitRef[], converse: ConverseFn): Promise<DayDecision[]> {
  if (decisions.length === 0 || commits.length === 0) return decisions;
  const known = new Set(commits.map(c => c.sha));
  const user = [
    'Decisions:', ...decisions.map((d, i) => `${i}. ${d.what} — ${d.why}`),
    'Commits:', ...commits.map(c => `${c.sha} ${c.message}`),
    'Link a commit to a decision only when the commit clearly carries out that decision.'
  ].join('\n');
  const parsed = linksSchema.safeParse(await forcedTool(converse, { system: 'You link decisions to the commits that carried them out. Answer with the tool.', user, name: 'save_commit_links', description: 'Save which commits carry out which decisions.', schema: json(linksSchema) }).catch(() => null));
  if (!parsed.success) return decisions;
  return decisions.map((d, i) => ({ ...d, commits: [...new Set(parsed.data.links.filter(l => l.decision === i).flatMap(l => l.commits).filter(s => known.has(s)))] }));
}

export async function compileDay(opts: { day: string; store: Store; converse: ConverseFn; repos: string[]; timeZone: string; now: Date; fetchFn?: typeof fetch }): Promise<DayLog | null> {
  const records = (await opts.store.listSessionsOn(opts.day)).filter(r => r.analysis);
  if (records.length === 0) return null;
  const decisions: DayDecision[] = records.flatMap(r => r.analysis!.decisions.map(d => ({ ...d, sessionId: r.session.id, commits: [] })));
  const commits = await commitsOn(opts.day, opts.repos, opts.timeZone, opts.fetchFn);
  const summaryOut = summarySchema.safeParse(await forcedTool(opts.converse, {
    system: 'You write a one-sentence English headline for a workday from its session summaries. Answer with the tool.',
    user: records.map(r => `- ${r.analysis!.topic}: ${r.analysis!.summary}`).join('\n'),
    name: 'save_day_summary', description: 'Save the headline of the day.', schema: json(summarySchema)
  }).catch(() => null));
  const log: DayLog = {
    date: opts.day,
    summary: summaryOut.success ? summaryOut.data.summary : records.map(r => r.analysis!.topic).join(' · '),
    sessions: records.map(r => ({ id: r.session.id, startedAt: r.session.startedAt, endedAt: r.session.endedAt, topic: r.analysis!.topic })),
    decisions: await matchCommits(decisions, commits, opts.converse),
    todos: records.flatMap(r => r.analysis!.todos.map(text => ({ text, sessionId: r.session.id }))),
    openQuestions: records.flatMap(r => r.analysis!.openQuestions.map(text => ({ text, sessionId: r.session.id }))),
    commits,
    updatedAt: opts.now.toISOString()
  };
  await opts.store.putDay(log);
  return log;
}
