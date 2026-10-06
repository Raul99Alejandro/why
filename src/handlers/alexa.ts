import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createRequestVerifier, fetchChainOverHttps } from '../alexa/verify.js';
import { handleSkill } from '../alexa/skill.js';
import { ask } from '../ask.js';
import { bedrockConverse } from '../nova.js';
import { readEnv } from '../runtime.js';
import { DynamoStore } from '../store/dynamo.js';
import type { UrlEvent } from './event.js';

const env = readEnv();
const store = new DynamoStore(env.TABLE, { region: env.REGION });
const converse = bedrockConverse(new BedrockRuntimeClient({ region: env.REGION }), env.MODEL_ID, 300);
const verify = createRequestVerifier({ fetchChain: fetchChainOverHttps, now: () => new Date() });
const skillId = process.env.ALEXA_SKILL_ID ?? '';

const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const handler = async (event: UrlEvent) => {
  if (event.requestContext.http.method !== 'POST' || !event.body) return json(404, { error: 'not found' });
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const res = await handleSkill({
    skillId, verify,
    // Public demo copy only: this function's role can read PUB# keys and nothing else.
    answer: async question => {
      const days = (await Promise.all((await store.listPublished()).slice(0, 30).map(d => store.getPublished(d)))).filter(d => d !== null);
      return ask({ question, days, converse });
    }
  }, event.headers ?? {}, raw);
  return json(res.status, res.body);
};
