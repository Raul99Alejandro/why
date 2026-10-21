// Owner-side publish from the PC, with the same gate as the private page (redaction, name review that fails
// closed, a second redaction pass) plus a deterministic block list for names the model misses.
//   AWS_PROFILE=why-sync TABLE=<table> npm run publish:day -- 2026-10-20 [more days] [--exclude s1,s2] [--block Name1,Name2] [--publish]
// Without --publish it is a dry run: the filtered copy is written to data/preview-<day>.json (git-ignored) and nothing is saved.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import fs from 'node:fs';
import { publishDay } from '../src/publish.js';
import { hideNames } from '../src/redact.js';
import { bedrockConverse } from '../src/nova.js';
import { DynamoStore } from '../src/store/dynamo.js';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '').split(',').filter(Boolean) : []; };
const days = args.filter((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && !['--exclude', '--block'].includes(args[i - 1] ?? ''));
const publish = args.includes('--publish');
const region = process.env.AWS_REGION ?? 'us-east-1';
const store = new DynamoStore(process.env.TABLE ?? 'why', { region });
const converse = bedrockConverse(new BedrockRuntimeClient({ region }), process.env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0', 600);
fs.mkdirSync('data', { recursive: true });
for (const day of days) {
  const pub = await publishDay({ store, day, excludeSessions: opt('--exclude'), blockTerms: opt('--block'), now: new Date(), dryRun: !publish, hide: t => hideNames(t, converse) });
  if (!pub) { console.log(day, 'no day (or every session excluded)'); continue; }
  if (!publish) fs.writeFileSync(`data/preview-${day}.json`, JSON.stringify(pub, null, 1));
  // Counts only: the texts stay in the preview file.
  console.log(day, publish ? 'published' : 'preview', { decisions: pub.decisions.length, todos: pub.todos.length, openQuestions: pub.openQuestions.length });
}
