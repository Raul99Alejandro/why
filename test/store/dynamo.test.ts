import { describe } from 'vitest';
import { storeContract } from './contract.js';
import { DynamoStore, createTable } from '../../src/store/dynamo.js';

const endpoint = process.env.DYNAMODB_ENDPOINT;
if (!endpoint) describe.skip('Store contract: dynamo (set DYNAMODB_ENDPOINT)', () => {});
else
  storeContract('dynamo', async () => {
    const table = `why-test-${Math.random().toString(36).slice(2)}`;
    await createTable(table, endpoint);
    return new DynamoStore(table, { endpoint, region: 'us-east-1' });
  });
