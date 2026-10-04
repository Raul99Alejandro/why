import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { PollyClient } from '@aws-sdk/client-polly';
import { Limits } from '../api/limits.js';
import { createRouter } from '../api/router.js';
import { bedrockConverse } from '../nova.js';
import { readEnv } from '../runtime.js';
import { pollySpeaker } from '../speech.js';
import { DynamoStore } from '../store/dynamo.js';
import { NOT_FOUND, toApiRequest, type UrlEvent } from './event.js';

const env = readEnv();
const route = createRouter({
  store: new DynamoStore(env.TABLE, { region: env.REGION }),
  converse: bedrockConverse(new BedrockRuntimeClient({ region: env.REGION }), env.MODEL_ID, 600),
  speak: pollySpeaker(new PollyClient({ region: env.REGION })),
  verify: async () => false, limits: new Limits(60, 2000),
  recompile: async () => { throw new Error('not available in the demo'); }, now: () => new Date()
});

export const handler = async (event: UrlEvent) => {
  const req = toApiRequest(event, { demo: true });
  if (!req) return NOT_FOUND;
  const res = await route(req);
  return { statusCode: res.status, headers: res.headers, body: res.body, isBase64Encoded: res.isBase64Encoded ?? false };
};
