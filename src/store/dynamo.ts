import { CreateTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Analysis, DayLog, PublishedDay, Session, SessionState } from '../domain/types.js';
import type { DecisionRecord, IgnoredKind, SessionRecord, Store } from './store.js';

/** Creates the single table (for DynamoDB Local in tests; on AWS the stack creates it). */
export async function createTable(table: string, endpoint: string): Promise<void> {
  const client = new DynamoDBClient({
    endpoint,
    region: 'us-east-1',
  });
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    })
  );
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: table });
}

export class DynamoStore implements Store {
  private doc: DynamoDBDocumentClient;

  constructor(
    private table: string,
    config: { endpoint?: string; region: string }
  ) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private async get<T>(pk: string, sk: string): Promise<T | null> {
    const out = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk, sk },
        ConsistentRead: true,
      })
    );
    return (out.Item as T | undefined) ?? null;
  }

  private async query(pk: string, prefix?: string) {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        ConsistentRead: true,
        KeyConditionExpression: prefix ? 'pk = :pk AND begins_with(sk, :p)' : 'pk = :pk',
        ExpressionAttributeValues: prefix ? { ':pk': pk, ':p': prefix } : { ':pk': pk },
      })
    );
    return out.Items ?? [];
  }

  async getCursor() {
    const it = await this.get<{ cursor: string; syncedAt: string }>('STATE', 'CURSOR');
    return it ? { cursor: it.cursor, syncedAt: it.syncedAt } : null;
  }

  async setCursor(cursor: string, syncedAt: string) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: 'STATE', sk: 'CURSOR', cursor, syncedAt },
      })
    );
  }

  async putSession(session: Session, day: string, rawTtlEpochSeconds: number): Promise<boolean> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: `SESSION#${session.id}`,
          sk: 'RAW',
          utterances: session.utterances,
          ttl: rawTtlEpochSeconds,
        },
      })
    );
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `DAY#${day}`, sk: `SESSION#${session.id}`, id: session.id },
      })
    );
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          ConditionExpression: 'attribute_not_exists(pk)',
          Item: {
            pk: `SESSION#${session.id}`,
            sk: 'META',
            id: session.id,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            state: 'captured',
            day,
          },
        })
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
    return true;
  }

  // A discarded segment leaves two small items: a marker by id (so a re-seen conversation is not counted twice)
  // and a reference under its day (for the per-day counter). Neither holds any conversation text.
  async recordIgnored(day: string, sessionId: string, kind: IgnoredKind): Promise<boolean> {
    // The counted item goes first (same key every time, so repeating it changes nothing); the marker that
    // makes the call idempotent goes last. A crash in between leaves a count that the retry re-writes, never a marker without a count.
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `DAY#${day}`, sk: `IGNORED#${sessionId}`, kind },
      })
    );
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          ConditionExpression: 'attribute_not_exists(pk)',
          Item: { pk: `IGNORED#${sessionId}`, sk: 'IGN', day, kind },
        })
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
    return true;
  }

  async getClassifyState(sessionId: string) {
    const it = await this.get<{ failures: number; retryAfter: string }>(`CLASSIFY#${sessionId}`, 'STATE');
    return it ? { failures: it.failures, retryAfter: it.retryAfter } : null;
  }

  async setClassifyState(sessionId: string, failures: number, retryAfter: string) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `CLASSIFY#${sessionId}`, sk: 'STATE', failures, retryAfter },
      })
    );
  }

  async isIgnored(sessionId: string): Promise<boolean> {
    return (await this.get(`IGNORED#${sessionId}`, 'IGN')) !== null;
  }

  async ignoredCounts(day: string) {
    const items = await this.query(`DAY#${day}`, 'IGNORED#');
    return { personal: items.filter((i) => i.kind === 'personal').length, offHours: items.filter((i) => i.kind === 'offHours').length };
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const items = await this.query(`SESSION#${id}`);
    const meta = items.find((i) => i.sk === 'META');
    if (!meta) return null;
    const raw = items.find((i) => i.sk === 'RAW');
    const analysis = items.find((i) => i.sk === 'ANALYSIS');
    return {
      session: {
        id,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        utterances: raw?.utterances ?? [],
      },
      state: meta.state,
      day: meta.day,
      analysis: (analysis?.analysis as Analysis | undefined) ?? null,
    };
  }

  async setAnalysis(id: string, analysis: Analysis | null, state: SessionState) {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `SESSION#${id}`, sk: 'META' },
          UpdateExpression: 'SET #s = :s',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':s': state },
        })
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
      throw err;
    }
    if (analysis)
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `SESSION#${id}`, sk: 'ANALYSIS', analysis },
        })
      );
  }

  async listSessionsOn(day: string) {
    const refs = await this.query(`DAY#${day}`, 'SESSION#');
    const records = await Promise.all(refs.map((r) => this.getSession(r.id as string)));
    return records
      .filter((r): r is SessionRecord => r !== null)
      .sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt));
  }

  async listPending(): Promise<string[]> {
    // Small table: a scan of META items in a non-analyzed state is cheap at this size.
    const out = await this.doc.send(
      new ScanCommand({
        TableName: this.table,
        FilterExpression: 'sk = :m AND #s <> :a AND #s <> :r',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':m': 'META', ':a': 'analyzed', ':r': 'pending_review' },
      })
    );
    return (out.Items ?? []).map((i) => i.id as string);
  }

  async putDay(log: DayLog) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `DAY#${log.date}`, sk: 'LOG', log },
      })
    );
  }

  async getDay(date: string) {
    return (await this.get<{ log: DayLog }>(`DAY#${date}`, 'LOG'))?.log ?? null;
  }

  async deleteDay(date: string) {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { pk: `DAY#${date}`, sk: 'LOG' },
      })
    );
  }

  async listDays() {
    return this.listLogs('DAY#');
  }

  // Published days are listed from one PUB#INDEX item, so the demo role never needs Scan
  // and its IAM policy can be limited to keys that start with PUB# (Task 13).
  async putPublished(day: PublishedDay) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `PUB#${day.date}`, sk: 'LOG', day },
      })
    );
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: 'PUB#INDEX', sk: 'DATES' },
        UpdateExpression: 'ADD dates :d',
        ExpressionAttributeValues: { ':d': new Set([day.date]) },
      })
    );
  }

  async getPublished(date: string) {
    return (await this.get<{ day: PublishedDay }>(`PUB#${date}`, 'LOG'))?.day ?? null;
  }

  async listPublished() {
    const it = await this.get<{ dates?: Set<string> }>('PUB#INDEX', 'DATES');
    return [...(it?.dates ?? [])].sort().reverse();
  }

  async deletePublished(date: string) {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { pk: `PUB#${date}`, sk: 'LOG' },
      })
    );
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: 'PUB#INDEX', sk: 'DATES' },
        UpdateExpression: 'DELETE dates :d',
        ExpressionAttributeValues: { ':d': new Set([date]) },
      })
    );
  }

  private async listLogs(prefix: string): Promise<string[]> {
    const out = await this.doc.send(
      new ScanCommand({
        TableName: this.table,
        FilterExpression: 'begins_with(pk, :p) AND sk = :l',
        ExpressionAttributeValues: { ':p': prefix, ':l': 'LOG' },
        ProjectionExpression: 'pk',
      })
    );
    return (out.Items ?? []).map((i) => (i.pk as string).slice(prefix.length)).sort().reverse();
  }

  // Decision records live under their day (pk DEC#<day>) so a window of days is a few Query calls, never a Scan.
  async putDecisionRecord(record: DecisionRecord) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `DEC#${record.day}`, sk: `D#${record.id}`, record },
      })
    );
  }

  async listDecisionRecords(day: string) {
    return (await this.query(`DEC#${day}`, 'D#')).map((i) => i.record as DecisionRecord);
  }

  async forgetSession(id: string) {
    const meta = await this.get<{ day: string }>(`SESSION#${id}`, 'META');
    if (!meta) return null;
    for (const sk of ['META', 'RAW', 'ANALYSIS']) {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk: `SESSION#${id}`, sk },
        })
      );
    }
    await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { pk: `DAY#${meta.day}`, sk: `SESSION#${id}` },
      })
    );
    for (const r of await this.listDecisionRecords(meta.day)) {
      if (r.sessionId !== id) continue;
      await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk: `DEC#${meta.day}`, sk: `D#${r.id}` } }));
    }
    return meta.day;
  }
}
