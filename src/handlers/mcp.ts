import { timingSafeEqual } from 'node:crypto';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createWhyServer } from '../agent/server.js';
import { publishedSource, type DaySource } from '../agent/source.js';
import { Limits } from '../api/limits.js';
import { bedrockConverse, type ConverseFn } from '../nova.js';
import { readEnv } from '../runtime.js';
import { DynamoStore } from '../store/dynamo.js';
import type { UrlEvent } from './event.js';

export type McpResult = { statusCode: number; headers: Record<string, string>; body: string };

const MAX_BODY = 16_384;
const JSON_TYPE = { 'content-type': 'application/json' };
const rpcError = (statusCode: number, code: number, message: string, headers: Record<string, string> = {}): McpResult =>
  ({ statusCode, headers: { ...JSON_TYPE, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }) });

const FORBIDDEN: McpResult = { statusCode: 403, headers: JSON_TYPE, body: '{"error":"forbidden"}' };

/** True when the header carries the origin secret; compared in constant time. An empty secret matches nothing. */
export function originOk(expected: string, got: string | undefined): boolean {
  if (!expected || got === undefined) return false;
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(got, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

/** Internal failures reach the client as a fixed sentence; the details go to the logs only. */
const guard = <A extends unknown[], R>(what: string, f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
  try { return await f(...a); } catch (e) {
    console.error(JSON.stringify({ at: 'mcp', what, error: e instanceof Error ? e.message : String(e) }));
    throw new Error(`The ${what} is unavailable right now.`);
  }
};

/**
 * Stateless Streamable HTTP MCP endpoint over the published (demo) copy: a fresh server and transport
 * per request, JSON responses only (no SSE), so it fits a buffered Lambda Function URL.
 */
export function createMcpHandler(deps: { src: DaySource; converse: ConverseFn; limits: Limits; now: () => Date; originSecret: string }) {
  const src: DaySource = { listDays: guard('decision log', () => deps.src.listDays()), getDay: guard('decision log', (d: string) => deps.src.getDay(d)) };
  const converse: ConverseFn = guard('model', input => deps.converse(input));

  return async (event: UrlEvent): Promise<McpResult> => {
    // The Function URL is public; only CloudFront adds this header (it overrides any viewer value), so
    // a direct call is refused before it can spend the rate limit or pick its own x-forwarded-for.
    if (!originOk(deps.originSecret, event.headers?.['x-why-origin'])) return FORBIDDEN;
    const method = event.requestContext.http.method.toUpperCase();
    if (method !== 'POST') return rpcError(405, -32000, 'Method not allowed: this endpoint is stateless, POST JSON-RPC only.', { allow: 'POST' });
    // CloudFront appends the viewer address as the last x-forwarded-for entry (as in toApiRequest).
    const ip = event.headers?.['x-forwarded-for']?.split(',').at(-1)?.trim() || event.requestContext.http.sourceIp;
    if (!deps.limits.take(ip, deps.now().getTime())) return rpcError(429, -32000, 'Too many requests: try again later.');
    const raw = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0);
    if (raw.byteLength > MAX_BODY) return rpcError(413, -32000, `Request body too large (max ${MAX_BODY} bytes).`);

    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers.set(k, v);
      if (!headers.has('accept')) headers.set('accept', 'application/json, text/event-stream');
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      const request = new Request('https://why.local/mcp', { method: 'POST', headers, body: raw });
      const server = createWhyServer({ src, converse, label: 'demo' });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
      try {
        await server.connect(transport);
        const res = await transport.handleRequest(request);
        const out: Record<string, string> = {};
        res.headers.forEach((v, k) => { out[k] = v; });
        return { statusCode: res.status, headers: out, body: await res.text() };
      } finally {
        await server.close().catch(() => undefined);
      }
    } catch (e) {
      console.error(JSON.stringify({ at: 'mcp', what: 'request', error: e instanceof Error ? e.message : String(e) }));
      return rpcError(500, -32603, 'Internal error.');
    }
  };
}

let live: ((event: UrlEvent) => Promise<McpResult>) | undefined;

/** Lambda entry: built on first call so importing the module (tests, bundling) needs no environment. */
export const handler = async (event: UrlEvent): Promise<McpResult> => {
  if (!live) {
    const env = readEnv();
    live = createMcpHandler({
      src: publishedSource(new DynamoStore(env.TABLE, { region: env.REGION })),
      converse: bedrockConverse(new BedrockRuntimeClient({ region: env.REGION }), env.MODEL_ID, 800),
      limits: new Limits(30, 1000), now: () => new Date(), originSecret: process.env.ORIGIN_SECRET ?? ''
    });
  }
  return live(event);
};
