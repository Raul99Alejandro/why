import * as z from 'zod/v4';
import type { ChangeStep, CommitRef, DayDecision, DayLog } from './domain/types.js';
import { addDays, WINDOW_DAYS } from './ledger.js';
import { localDay } from './domain/dates.js';
import { commitsOn } from './github.js';
import { glossary } from './analyze.js';
import { forcedTool, type ConverseFn } from './nova.js';
import type { DecisionRecord, Store } from './store/store.js';

const summarySchema = z.object({ summary: z.string().trim().min(1).describe('One short English sentence, at most 25 words, about what the day was about.') });
const linksSchema = z.object({ links: z.array(z.object({ decision: z.number().int().min(0), commits: z.array(z.string()) })) });
const json = (s: z.ZodType) => { const { $schema: _i, ...rest } = z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown>; return rest; };

export const MAX_COMMITS_PER_DECISION = 3;
const MATCH_SYSTEM = [
  'You link decisions to the commits that carried them out.',
  'Link a commit only when its message clearly implements that specific decision.',
  'Most commits match nothing. When unsure, do not link.',
  'Answer with the tool.'
].join(' ');

export async function matchCommits(decisions: DayDecision[], commits: CommitRef[], converse: ConverseFn): Promise<DayDecision[]> {
  if (decisions.length === 0 || commits.length === 0) return decisions;
  const known = new Set(commits.map(c => c.sha));
  const user = [
    'Decisions:', ...decisions.map((d, i) => `${i}. ${d.what} - ${d.why}`),
    'Commits:', ...commits.map(c => `${c.sha} ${c.message}`),
    'Link a commit to a decision only when the commit clearly carries out that decision. Most commits match nothing.'
  ].join('\n');
  const parsed = linksSchema.safeParse(await forcedTool(converse, { system: MATCH_SYSTEM, user, name: 'save_commit_links', description: 'Save which commits carry out which decisions.', schema: json(linksSchema) }).catch(() => null));
  if (!parsed.success) return decisions;
  const taken = new Set<string>();
  return decisions.map((d, i) => {
    let own = [...new Set(parsed.data.links.filter(l => l.decision === i).flatMap(l => l.commits).filter(s => known.has(s)))];
    if (commits.length >= 6 && own.length > commits.length / 2) own = []; // unreliable reply
    const kept = own.filter(s => !taken.has(s)).slice(0, MAX_COMMITS_PER_DECISION);
    kept.forEach(s => taken.add(s));
    return { ...d, commits: kept };
  });
}

const MAX_CHAIN = 5;

/**
 * Adds what the ledger knows to a day's decisions: the "changed" link back (the whole chain, so A -> B -> A shows both steps) with the
 * commits of the nearest old decision, the "changed later" link forward, refinements, and follow-up status.
 */
export async function decorate(decisions: DayDecision[], day: string, store: Store, now: Date, timeZone: string): Promise<DayDecision[]> {
  const byDay = new Map<string, Promise<DecisionRecord[]>>();
  const recordsOf = (d: string) => { if (!byDay.has(d)) byDay.set(d, store.listDecisionRecords(d)); return byDay.get(d)!; };
  const own = new Map((await recordsOf(day)).map(r => [r.id, r]));
  const today = localDay(now.toISOString(), timeZone);
  const later: DecisionRecord[] = [];
  for (let d = addDays(day, 1); d <= today && d <= addDays(day, WINDOW_DAYS); d = addDays(d, 1)) later.push(...await recordsOf(d));
  later.push(...own.values());
  const recordAt = async (id: string, d: string) => (await recordsOf(d)).find(r => r.id === id);
  const stepOf = async (id: string, d: string): Promise<ChangeStep | null> => {
    const rec = await recordAt(id, d);
    const sess = rec ? await store.getSession(rec.sessionId) : null;
    const what = sess?.analysis?.decisions[Number(id.slice(id.lastIndexOf('#') + 1))]?.what;
    return rec && what ? { id, date: d, what, sessionId: rec.sessionId } : null;
  };
  return Promise.all(decisions.map(async d => {
    const rec = d.id ? own.get(d.id) : undefined;
    if (!d.id || !rec) return d;
    const out: DayDecision = { ...d };
    const rev = later.find(r => r.relation?.kind === 'reversal' && r.relation.priorId === d.id);
    if (rev) out.changedLater = { id: rev.id, date: rev.day };
    if (rec.relation?.kind === 'refinement') out.refines = { id: rec.relation.priorId, date: rec.relation.priorDay };
    if (rec.relation?.kind === 'reversal') {
      const from: ChangeStep[] = [];
      let cur: DecisionRecord | undefined = rec;
      while (cur?.relation?.kind === 'reversal' && from.length < MAX_CHAIN) {
        const step = await stepOf(cur.relation.priorId, cur.relation.priorDay);
        if (!step) break;
        from.push(step);
        cur = await recordAt(cur.relation.priorId, cur.relation.priorDay);
      }
      if (from.length) {
        const oldLog = await store.getDay(from[0]!.date);
        const oldDecision = oldLog?.decisions.find(x => x.id === from[0]!.id);
        const bySha = new Map((oldLog?.commits ?? []).map(c => [c.sha, c]));
        out.change = { from, commits: (oldDecision?.commits ?? []).map(s => bySha.get(s)).filter((c): c is CommitRef => !!c) };
      }
    }
    if (rec.followUp && (rec.followUp.state === 'open' || rec.followUp.state === 'closing' || rec.followUp.state === 'closed')) {
      const closed = rec.followUp.state !== 'open';
      out.followUp = { text: rec.followUp.text, status: closed ? 'closed' : 'open', ...(closed && rec.followUp.closedBy ? { closedBy: rec.followUp.closedBy } : {}) };
    } else if (rec.followUp?.state === 'pending') out.followUp = { text: rec.followUp.text, status: 'open' };
    return out;
  }));
}

export async function compileDay(opts: { day: string; store: Store; converse: ConverseFn; repos: string[]; timeZone: string; now: Date; fetchFn?: typeof fetch }): Promise<DayLog | null> {
  const records = (await opts.store.listSessionsOn(opts.day)).filter(r => r.analysis);
  if (records.length === 0) return null;
  const decisions: DayDecision[] = records.flatMap(r => r.analysis!.decisions.map((d, i) => ({ ...d, id: `${r.session.id}#${i}`, sessionId: r.session.id, commits: [] })));
  const commits = await commitsOn(opts.day, opts.repos, opts.timeZone, opts.fetchFn);
  const summaryOut = summarySchema.safeParse(await forcedTool(opts.converse, {
    system: `You write one short English sentence (at most 25 words) summarizing a workday from its session summaries. Write these names exactly like this: ${glossary()}. Answer with the tool.`,
    user: records.map(r => `- ${r.analysis!.topic}: ${r.analysis!.summary}`).join('\n'),
    name: 'save_day_summary', description: 'Save the headline of the day.', schema: json(summarySchema)
  }).catch(() => null));
  const ignored = await opts.store.ignoredCounts(opts.day);
  const log: DayLog = {
    date: opts.day,
    summary: summaryOut.success ? summaryOut.data.summary : records.map(r => r.analysis!.topic).join(' · '),
    sessions: records.map(r => ({ id: r.session.id, startedAt: r.session.startedAt, endedAt: r.session.endedAt, topic: r.analysis!.topic })),
    decisions: await decorate(await matchCommits(decisions, commits, opts.converse), opts.day, opts.store, opts.now, opts.timeZone),
    todos: records.flatMap(r => r.analysis!.todos.map(text => ({ text, sessionId: r.session.id }))),
    openQuestions: records.flatMap(r => r.analysis!.openQuestions.map(text => ({ text, sessionId: r.session.id }))),
    commits,
    ...(ignored.personal > 0 ? { ignoredPersonal: ignored.personal } : {}),
    updatedAt: opts.now.toISOString()
  };
  await opts.store.putDay(log);
  return log;
}
