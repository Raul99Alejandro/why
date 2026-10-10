import './mcp-env.js';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { privateSource, publishedSource } from '../agent/source.js';
import { createWhyServer } from '../agent/server.js';
import { bedrockConverse } from '../nova.js';
import { DynamoStore } from '../store/dynamo.js';

// stdio is the protocol channel: logs go to stderr only (see mcp-env.ts).
const region = process.env.AWS_REGION ?? 'us-east-1';
const store = new DynamoStore(process.env.TABLE ?? 'why', { region });
const demo = process.argv.includes('--demo');
const server = createWhyServer({
  src: demo ? publishedSource(store) : privateSource(store),
  converse: bedrockConverse(new BedrockRuntimeClient({ region }), process.env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0', 800),
  label: demo ? 'demo' : 'private'
});
await server.connect(new StdioServerTransport());
