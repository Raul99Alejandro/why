import { describe } from 'vitest';
import { storeContract } from './contract.js';
import { DynamoStore, createTable } from '../../src/store/dynamo.js';

const endpoint = process.env.DYNAMODB_ENDPOINT;
if (!endpoint) describe.skip('Store contract: dynamo (set DYNAMODB_ENDPOINT)', () => {});
else {
  // Set test credentials for DynamoDB Local only
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';

  storeContract('dynamo', async () => {
    const table = `why-test-${Math.random().toString(36).slice(2)}`;
    await createTable(table, endpoint);
    return new DynamoStore(table, { endpoint, region: 'us-east-1' });
  });
}
