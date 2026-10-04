import type { DayLog, PublishedDay } from '../src/domain/types.js';
export const demoMode = () => new URLSearchParams(location.search).has('demo') || location.pathname.startsWith('/demo');
let idToken: string | null = null;
export const setToken = (t: string | null) => { idToken = t; };
const base = () => (demoMode() ? '/api/demo' : '/api');

/** Lowercase hex SHA-256 of a string (CloudFront OAC requires it for Lambda URL POST bodies). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  // CloudFront OAC overwrites Authorization, so the token travels in x-why-token.
  if (!demoMode() && idToken) headers.set('x-why-token', `Bearer ${idToken}`);
  if (typeof init.body === 'string') {
    headers.set('content-type', 'application/json');
    headers.set('x-amz-content-sha256', await sha256Hex(init.body));
  }
  return fetch(`${base()}${path}`, { ...init, headers });
}
const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) });

export async function status(): Promise<{ syncedAt: string | null }> {
  const r = await call('/status'); if (!r.ok) throw new Error(`status ${r.status}`); return r.json();
}
export async function listDays(): Promise<string[]> { const r = await call('/days'); if (r.status === 401) throw new Error('unauthorized'); if (!r.ok) throw new Error(`days ${r.status}`); return r.json(); }
export async function getDay(date: string): Promise<DayLog | PublishedDay | null> { const r = await call(`/days/${date}`); return r.ok ? r.json() : null; }
export async function askQuestion(question: string): Promise<{ answer: string; citations: { date: string; decision: string }[] }> {
  const r = await post('/ask', { question }); if (!r.ok) throw new Error(`ask ${r.status}`); return r.json();
}
export async function speak(text: string): Promise<Blob | null> { const r = await post('/speech', { text }); return r.ok ? r.blob() : null; }
export async function publish(date: string): Promise<boolean> { return (await post('/publish', { date, excludeSessions: [] })).ok; }
export async function previewPublish(date: string): Promise<PublishedDay | null> {
  const r = await post('/publish', { date, excludeSessions: [], preview: true }); return r.ok ? r.json() : null;
}
export async function forget(sessionId: string): Promise<boolean> { return (await post('/forget', { sessionId })).ok; }
