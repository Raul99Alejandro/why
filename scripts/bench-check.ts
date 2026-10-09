// Runs checkChange with the real Bedrock model on the synthetic BENCH_CASES (no owner data) and prints precision/recall for "conflicts".
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { checkChange } from '../src/agent/check.js';
import type { DaySource } from '../src/agent/source.js';
import type { DayLog } from '../src/domain/types.js';
import { bedrockConverse } from '../src/nova.js';
import { BENCH_CASES, type BenchCase } from '../test/agent/bench-cases.js';

const region = process.env.AWS_REGION ?? 'us-east-1';
const modelId = process.env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';
const model = bedrockConverse(new BedrockRuntimeClient({ region }), modelId, 1000);
// checkChange turns a failed call into 'unknown'; count the failures so a broken login is not read as a bad score.
const errors = new Map<string, number>();
const converse: typeof model = async input => {
  try { return await model(input); } catch (e) {
    const key = `${(e as Error).name}: ${(e as Error).message}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
    throw e;
  }
};
const today = new Date().toISOString().slice(0, 10);

const sourceOf = (c: BenchCase): DaySource => {
  const day: DayLog = {
    date: today, summary: '', sessions: [], todos: [], openQuestions: [], commits: [], updatedAt: '',
    decisions: c.decisions.map((d, i) => ({ ...d, quote: '', quoteOriginal: '', at: '', sessionId: `bench${i}`, commits: [] }))
  };
  return { listDays: async () => [today], getDay: async d => (d === today ? day : null) };
};

let tp = 0, fp = 0, fn = 0, correct = 0;
console.log(`model ${modelId}`);
for (const [i, c] of BENCH_CASES.entries()) {
  const got = (await checkChange({ src: sourceOf(c), change: c.change, converse })).verdict;
  if (got === c.expect) correct++;
  if (got === 'conflicts' && c.expect === 'conflicts') tp++;
  else if (got === 'conflicts') fp++;
  else if (c.expect === 'conflicts') fn++;
  console.log(`case ${String(i + 1).padStart(2)}: expected ${c.expect.padEnd(9)} got ${got}${got === c.expect ? '' : '  <- miss'}`);
}
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;
const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
const f = (n: number) => n.toFixed(2);
console.log(`conflicts: precision ${f(precision)} recall ${f(recall)} F1 ${f(f1)} (tp ${tp}, fp ${fp}, fn ${fn})`);
for (const [e, n] of errors) console.log(`model error x${n}: ${e}`);
console.log(`accuracy ${f(correct / BENCH_CASES.length)} (${correct}/${BENCH_CASES.length})`);
