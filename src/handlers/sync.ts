import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { HttpBeeSource } from '../bee/http.js';
import { bedrockConverse } from '../nova.js';
import { readEnv, runSync } from '../runtime.js';
import { DynamoStore } from '../store/dynamo.js';

const env = readEnv();
const secrets = new SecretsManagerClient({ region: env.REGION });
const token = async () => (await secrets.send(new GetSecretValueCommand({ SecretId: env.BEE_SECRET_ARN }))).SecretString ?? '';

export const handler = async () => runSync({
  source: new HttpBeeSource(env.BEE_BASE_URL ?? '', token),
  store: new DynamoStore(env.TABLE, { region: env.REGION }),
  converse: bedrockConverse(new BedrockRuntimeClient({ region: env.REGION }), env.MODEL_ID),
  repos: env.REPOS.split(',').filter(Boolean), timeZone: env.TIME_ZONE, now: new Date()
});
