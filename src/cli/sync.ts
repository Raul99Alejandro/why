import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CliBeeSource } from '../bee/cli.js';
import { bedrockConverse } from '../nova.js';
import { runSync } from '../runtime.js';
import { DynamoStore } from '../store/dynamo.js';
import { readWorkHours } from '../workfilter.js';

const table = process.env.TABLE ?? 'why';
const region = process.env.AWS_REGION ?? 'us-east-1';
const workHours = readWorkHours();
const out = await runSync({
  source: new CliBeeSource(), store: new DynamoStore(table, { region }),
  converse: bedrockConverse(new BedrockRuntimeClient({ region }), process.env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0'),
  repos: (process.env.REPOS ?? 'Raul99Alejandro/counterpart,Raul99Alejandro/why').split(','), timeZone: workHours.timeZone, workHours, now: new Date()
});
// Counts only: never print conversation text.
console.log(JSON.stringify(out));
