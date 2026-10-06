import type { Answer } from '../ask.js';
import { log } from '../log.js';

export type SkillDeps = {
  skillId: string;
  verify: (headers: Record<string, string | undefined>, rawBody: string) => Promise<boolean>;
  /** Answers from the public demo copy only. */
  answer: (question: string) => Promise<Answer>;
  /** Alexa gives a skill about 8 seconds; past this budget the user hears the friendly fallback. */
  budgetMs?: number;
};

export type SkillResult = { status: number; body: unknown };
const NAME = 'Why decisions';
export const NOT_FOUND_TEXT = "I couldn't find that in the decision log. Try another topic.";
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

export async function handleSkill(deps: SkillDeps, headers: Record<string, string | undefined>, rawBody: string): Promise<SkillResult> {
  const denied = { status: 400, body: { error: 'bad request' } };
  if (!deps.skillId || !(await deps.verify(headers, rawBody))) return denied;
  let body: AlexaBody;
  try { body = JSON.parse(rawBody) as AlexaBody; } catch { return denied; }
  const appId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
  if (appId !== deps.skillId) return denied;

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
        deps.answer(`What did we decide about ${query}?`),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), deps.budgetMs ?? 6000); })
      ]);
    } catch (err) { log({ level: 'error', msg: 'alexa_answer_failed', error: err instanceof Error ? err.name : 'unknown' }); }
    finally { clearTimeout(timer); }
    if (!found || found.citations.length === 0) return { status: 200, body: reply(NOT_FOUND_TEXT, { card: NOT_FOUND_TEXT }) };
    const speech = twoSentences(found.answer);
    const dates = [...new Set(found.citations.map(c => c.date))].slice(0, 3).join(', ');
    return { status: 200, body: reply(speech, { card: `${speech}\n\nFrom the log: ${dates}` }) };
  }
  if (name === 'AMAZON.StopIntent' || name === 'AMAZON.CancelIntent') return { status: 200, body: reply('Goodbye.') };
  return { status: 200, body: reply(HELP, { end: false, reprompt: HELP }) };
}
