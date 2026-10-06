import { DynamoStore } from '../store/dynamo.js';
import { createLabelServer } from '../label/server.js';

// Local only: reads your own sessions with your own credentials and serves them on 127.0.0.1. Never deploy this.
const table = process.env.TABLE ?? 'why';
const region = process.env.AWS_REGION ?? 'us-east-1';
const port = Number(process.env.PORT ?? 4173);
const server = createLabelServer({ store: new DynamoStore(table, { region }), dataDir: 'data' });
server.listen(port, '127.0.0.1', () => console.log(`Labeling page: http://127.0.0.1:${port}/ (local only, Ctrl+C to stop)`));
