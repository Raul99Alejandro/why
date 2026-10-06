import type { Answer } from '../ask.js';
import { log } from '../log.js';

export type SkillDeps = {
  skillId: string;
  verify: (headers: Record<string, string | undefined>, rawBody: Buffer, signal?: AbortSignal) => Promise<boolean>;
  /** Answers from the public demo copy only. */
  answer: (question: string, signal?: AbortSignal) => Promise<Answer>;
  /** Absolute time (ms since epoch) by which a reply must be sent: Alexa gives a skill 8 seconds from the request. */
  deadlineAt: number;
  clock?: () => number;
};

export type SkillResult = { status: number; body: unknown };
const NAME = 'Why decisions';
export const NOT_FOUND_TEXT = "I couldn't find that in the decision log. Try another topic.";
export const TOO_SLOW_TEXT = 'That is taking too long right now. Please try again.';
const HELP = 'Ask me what we decided about a topic, for example: what did we decide about the voice model.';

/** At most two sentences, so the answer is quick to hear. */
export function twoSentences(text: string): string {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return parts.slice(0, 2).map(p => p.trim()).join(' ').trim();
}

const reply = (speech: string, opts: { end?: boolean; card?: string; reprompt?: string } = {}) => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text: speech },
    ...(opts.card ? { card: { type: 'Simple', title: NAME, content: opts.card } } : {}),
    ...(opts.reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: opts.reprompt } } } : {}),
    shouldEndSession: opts.end ?? true
  }
});

type AlexaBody = {
  session?: { application?: { applicationId?: string } };
  context?: { System?: { application?: { applicationId?: string } } };
  request?: { type?: string; intent?: { name?: string; slots?: Record<string, { value?: string } | undefined> } };
};

export async function handleSkill(deps: SkillDeps, headers: Record<string, string | undefined>, rawBody: Buffer): Promise<SkillResult> {
  const denied = { status: 400, body: { error: 'bad request' } };
  const clock = deps.clock ?? Date.now;
  if (!deps.skillId) return denied;
  let body: AlexaBody;
  try { body = JSON.parse(rawBody.toString('utf8')) as AlexaBody; } catch { return denied; }
  // Cheap check first: a request for another skill never causes a certificate download.
  const appId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
  if (appId !== deps.skillId) return denied;
  const signal = AbortSignal.timeout(Math.max(1, deps.deadlineAt - clock()));
  const tooSlow = { status: 200, body: reply(TOO_SLOW_TEXT, { card: TOO_SLOW_TEXT }) };
  const ok = await deps.verify(headers, rawBody, signal);
  if (!ok) return signal.aborted ? tooSlow : denied;

  const type = body.request?.type;
  if (type === 'LaunchRequest') return { status: 200, body: reply(`Welcome to ${NAME}. ${HELP}`, { end: false, reprompt: HELP }) };
  if (type === 'SessionEndedRequest') return { status: 200, body: { version: '1.0', response: {} } };
  if (type !== 'IntentRequest') return denied;

  const name = body.request?.intent?.name;
  if (name === 'AskWhyIntent') {
    const query = body.request?.intent?.slots?.query?.value?.trim().slice(0, 200);
    if (!query) return { status: 200, body: reply(HELP, { end: false, reprompt: HELP }) };
    let found: Answer | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      found = await Promise.race([
        deps.answer(`What did we decide about ${query}?`, signal),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deps.deadlineAt - clock())); })
      ]);
    } catch (err) { log({ level: 'error', msg: 'alexa_answer_failed', error: err instanceof Error ? err.name : 'unknown' }); }
    finally { clearTimeout(timer); }
    if (!found) return tooSlow; // deadline hit or the call failed: not the same as "nothing matches"
    if (found.citations.length === 0) return { status: 200, body: reply(NOT_FOUND_TEXT, { card: NOT_FOUND_TEXT }) };
    const speech = twoSentences(found.answer);
    const dates = [...new Set(found.citations.map(c => c.date))].slice(0, 3).join(', ');
    return { status: 200, body: reply(speech, { card: `${speech}\n\nFrom the log: ${dates}` }) };
  }
  if (name === 'AMAZON.StopIntent' || name === 'AMAZON.CancelIntent') return { status: 200, body: reply('Goodbye.') };
  return { status: 200, body: reply(HELP, { end: false, reprompt: HELP }) };
}
