import { DynamoStore } from '../store/dynamo.js';
import { computeAccuracy, formatAccuracy, isDay, loadLabels, unreviewed } from '../label/accuracy.js';

const i = process.argv.indexOf('--day');
const day = i >= 0 ? process.argv[i + 1] : undefined;
if (!isDay(day)) { console.error('usage: npm run accuracy -- --day YYYY-MM-DD'); process.exit(2); }
const labels = loadLabels('data', day);
if (!labels) { console.error(`no labels for ${day}: run npm run label first`); process.exit(2); }
const store = new DynamoStore(process.env.TABLE ?? 'why', { region: process.env.AWS_REGION ?? 'us-east-1' });
const why = ((await store.getDay(day))?.decisions ?? []).map(d => d.what);
const open = unreviewed(why, labels);
if (open.length > 0) { console.error(`${open.length} of Why's decisions are not judged in the labels (was the day re-analyzed?): label the day again`); process.exit(1); }
// Numbers only: never print decision or conversation text.
console.log(formatAccuracy(computeAccuracy(why, labels)));
