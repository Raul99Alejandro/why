import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { PollyClient } from '@aws-sdk/client-polly';
import { cognitoVerifier } from '../api/auth.js';
import { Limits } from '../api/limits.js';
import { createRouter } from '../api/router.js';
import { bedrockConverse } from '../nova.js';
import { readEnv, recompiler } from '../runtime.js';
import { pollySpeaker } from '../speech.js';
import { DynamoStore } from '../store/dynamo.js';
import { NOT_FOUND, toApiRequest, type UrlEvent } from './event.js';

const env = readEnv();
const store = new DynamoStore(env.TABLE, { region: env.REGION });
const converse = bedrockConverse(new BedrockRuntimeClient({ region: env.REGION }), env.MODEL_ID, 600);
const repos = env.REPOS.split(',').filter(Boolean);
const route = createRouter({
  store, converse, speak: pollySpeaker(new PollyClient({ region: env.REGION })),
  verify: cognitoVerifier(env.USER_POOL_ID ?? '', env.CLIENT_ID ?? ''),
  limits: new Limits(60, 2000), recompile: recompiler({ store, converse, repos, timeZone: env.TIME_ZONE }), now: () => new Date()
});

export const handler = async (event: UrlEvent) => {
  const req = toApiRequest(event, { demo: false });
  if (!req) return NOT_FOUND;
  const res = await route(req);
  return { statusCode: res.status, headers: res.headers, body: res.body, isBase64Encoded: res.isBase64Encoded ?? false };
};
