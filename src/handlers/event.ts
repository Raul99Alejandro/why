import type { ApiRequest } from '../api/router.js';

export type UrlEvent = {
  requestContext: { http: { method: string; sourceIp: string } };
  rawPath: string;
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

/** Maps a Lambda Function URL event to a router request. null means "404 before routing". */
export function toApiRequest(event: UrlEvent, opts: { demo: boolean }): ApiRequest | null {
  const path = event.rawPath.replace(/^\/api/, '');
  if (path.startsWith('/demo/') !== opts.demo) return null;
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : null;
  // CloudFront appends the viewer address as the last x-forwarded-for entry.
  const ip = event.headers?.['x-forwarded-for']?.split(',').at(-1)?.trim() || event.requestContext.http.sourceIp;
  // CloudFront OAC overwrites Authorization, so the web sends the JWT in x-why-token.
  const headers = opts.demo ? {} : { authorization: event.headers?.['x-why-token'] };
  return { method: event.requestContext.http.method, path, query: event.queryStringParameters ?? {}, headers, body, ip };
}

export const NOT_FOUND = { statusCode: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"not found"}' };
