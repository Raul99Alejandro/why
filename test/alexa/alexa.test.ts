import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleSkill, NOT_FOUND_TEXT, twoSentences, type SkillDeps } from '../../src/alexa/skill.js';
import { createRequestVerifier, validChainUrl } from '../../src/alexa/verify.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const URL_OK = 'https://s3.amazonaws.com/echo.api/echo-api-cert.pem';
const NOW = new Date('2026-10-07T12:00:00Z');
const SKILL = 'amzn1.ask.skill.test';

const bodyOf = (request: unknown, appId = SKILL) => JSON.stringify({ version: '1.0', session: { application: { applicationId: appId } }, context: { System: { application: { applicationId: appId } } }, request });
const intent = (name: string, query?: string, timestamp = NOW.toISOString()) =>
  ({ type: 'IntentRequest', timestamp, intent: { name, slots: query ? { query: { name: 'query', value: query } } : {} } });
const sign = (body: string, algo = 'RSA-SHA256') => createSign(algo).update(body).sign(fx('leaf.key'), 'base64');

const verifier = (pem = fx('leaf.pem'), now = NOW) => createRequestVerifier({ fetchChain: async () => pem, now: () => now, roots: [fx('ca.pem')] });
const signed = (body: string) => ({ signaturecertchainurl: URL_OK, 'signature-256': sign(body) });

describe('Alexa request verification', () => {
  it('accepts a correctly signed, fresh request (SHA-256 and legacy SHA-1)', async () => {
    const body = bodyOf(intent('AskWhyIntent', 'nova'));
    expect(await verifier()(signed(body), body)).toBe(true);
    expect(await verifier()({ signaturecertchainurl: URL_OK, signature: sign(body, 'RSA-SHA1') }, body)).toBe(true);
  });
  it('rejects a tampered body', async () => {
    const body = bodyOf(intent('AskWhyIntent', 'nova'));
    expect(await verifier()(signed(body), body.replace('nova', 'other'))).toBe(false);
  });
  it('rejects a stale or future timestamp', async () => {
    for (const ts of ['2026-10-07T11:55:00Z', '2026-10-07T12:05:00Z']) {
      const body = bodyOf(intent('AskWhyIntent', 'nova', ts));
      expect(await verifier()(signed(body), body)).toBe(false);
    }
  });
  it('rejects missing headers, bad certificate URLs, and a certificate for another name', async () => {
    const body = bodyOf(intent('AskWhyIntent', 'nova'));
    expect(await verifier()({}, body)).toBe(false);
    for (const u of ['http://s3.amazonaws.com/echo.api/c.pem', 'https://s3.amazonaws.com.evil.com/echo.api/c.pem', 'https://s3.amazonaws.com/evil/c.pem', 'https://s3.amazonaws.com:8443/echo.api/c.pem', 'not a url'])
      expect(await verifier()({ ...signed(body), signaturecertchainurl: u }, body), u).toBe(false);
    expect(validChainUrl(URL_OK)).toBe(true);
    expect(await verifier(fx('bad.pem'))(signed(body), body)).toBe(false);
  });
  it('rejects a chain that does not lead to a trusted root, and an expired certificate', async () => {
    const body = bodyOf(intent('AskWhyIntent', 'nova'));
    expect(await createRequestVerifier({ fetchChain: async () => fx('leaf.pem'), now: () => NOW, roots: [] })(signed(body), body)).toBe(false);
    expect(await verifier(fx('leaf.pem'), new Date('2200-01-01T00:00:00Z'))(signed(body), body)).toBe(false);
  });
  it('rejects a signature made with another key', async () => {
    const body = bodyOf(intent('AskWhyIntent', 'nova'));
    const other = createSign('RSA-SHA256').update(body).sign(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, 'base64');
    expect(await verifier()({ signaturecertchainurl: URL_OK, 'signature-256': other }, body)).toBe(false);
  });
});

const answer = { answer: 'We chose Nova 2 Lite for cost. It was cheaper than the alternatives. A third sentence.', citations: [{ date: '2026-09-30', sessionId: 's1', decision: 'Use Nova' }] };
const deps = (over: Partial<SkillDeps> = {}): SkillDeps & { asked: string[] } => {
  const asked: string[] = [];
  return { skillId: SKILL, verify: async () => true, answer: async q => { asked.push(q); return answer; }, asked, ...over };
};
const run = (d: SkillDeps, body: string) => handleSkill(d, {}, body);
type Resp = { response: { outputSpeech?: { text: string }; card?: { type: string; content: string }; shouldEndSession?: boolean } };

describe('Why decisions skill', () => {
  it('answers in at most two sentences, with a simple card', async () => {
    const d = deps();
    const r = await run(d, bodyOf(intent('AskWhyIntent', 'the voice model')));
    const b = r.body as Resp;
    expect(r.status).toBe(200);
    expect(d.asked).toEqual(['What did we decide about the voice model?']);
    expect(b.response.outputSpeech!.text).toBe('We chose Nova 2 Lite for cost. It was cheaper than the alternatives.');
    expect(b.response.card!.type).toBe('Simple');
    expect(b.response.card!.content).toContain('2026-09-30');
    expect(b.response.shouldEndSession).toBe(true);
  });
  it('says a friendly fallback when nothing matches, is uncited, or the model fails or is too slow', async () => {
    const cases: SkillDeps['answer'][] = [
      async () => ({ answer: "I couldn't find that in your log.", citations: [] }),
      async () => { throw new Error('boom'); },
      () => new Promise(() => {})
    ];
    for (const a of cases) {
      const r = await run(deps({ answer: a, budgetMs: 20 }), bodyOf(intent('AskWhyIntent', 'unicorns')));
      expect((r.body as Resp).response.outputSpeech!.text).toBe(NOT_FOUND_TEXT);
    }
  });
  it('rejects unverified requests and requests from another skill, before answering', async () => {
    const d = deps({ verify: async () => false });
    expect((await run(d, bodyOf(intent('AskWhyIntent', 'x')))).status).toBe(400);
    const d2 = deps();
    expect((await run(d2, bodyOf(intent('AskWhyIntent', 'x'), 'amzn1.ask.skill.other'))).status).toBe(400);
    expect((await run(deps({ skillId: '' }), bodyOf(intent('AskWhyIntent', 'x')))).status).toBe(400);
    expect((await run(d2, 'not json')).status).toBe(400);
    expect(d.asked).toEqual([]);
    expect(d2.asked).toEqual([]);
  });
  it('handles launch, help, fallback, stop, cancel, an empty slot and session end', async () => {
    const say = async (req: unknown) => ((await run(deps(), bodyOf(req))).body as Resp).response;
    expect((await say({ type: 'LaunchRequest', timestamp: NOW.toISOString() })).shouldEndSession).toBe(false);
    for (const n of ['AMAZON.HelpIntent', 'AMAZON.FallbackIntent']) expect((await say(intent(n))).shouldEndSession, n).toBe(false);
    for (const n of ['AMAZON.StopIntent', 'AMAZON.CancelIntent']) expect((await say(intent(n))).shouldEndSession, n).toBe(true);
    expect((await say(intent('AskWhyIntent'))).shouldEndSession).toBe(false);
    expect((await run(deps(), bodyOf({ type: 'SessionEndedRequest', timestamp: NOW.toISOString() }))).status).toBe(200);
  });
  it('trims to two sentences', () => {
    expect(twoSentences('One. Two! Three?')).toBe('One. Two!');
    expect(twoSentences('Only one')).toBe('Only one');
  });
});
