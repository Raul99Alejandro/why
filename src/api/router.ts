import * as z from 'zod/v4';
import { ask } from '../ask.js';
import type { DayLog } from '../domain/types.js';
import type { ConverseFn } from '../nova.js';
import { forgetSession, publishDay, unpublishDay } from '../publish.js';
import { log } from '../log.js';
import { hideNames } from '../redact.js';
import type { Speaker } from '../speech.js';
import type { Store } from '../store/store.js';
import type { Limits } from './limits.js';
import type { Verifier } from './auth.js';

export type ApiRequest = { method: string; path: string; query: Record<string, string>; headers: Record<string, string | undefined>; body: string | null; ip: string };
export type ApiResponse = { status: number; headers: Record<string, string>; body: string; isBase64Encoded?: boolean };

const json = (status: number, data: unknown): ApiResponse => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(data) });
const NOT_FOUND = json(404, { error: 'not found' });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const askBody = z.object({ question: z.string().trim().min(1).max(300) });
const speechBody = z.object({ text: z.string().trim().min(1).max(600) });
const publishBody = z.object({ date: z.string().regex(DATE), excludeSessions: z.array(z.string()).max(50).default([]), preview: z.boolean().default(false) });
const unpublishBody = z.object({ date: z.string().regex(DATE) });
const forgetBody = z.object({ sessionId: z.string().min(1).max(100) });

function parse<T>(schema: z.ZodType<T>, body: string | null): T | null {
  try { const r = schema.safeParse(JSON.parse(body ?? '')); return r.success ? r.data : null; } catch { return null; }
}

export function createRouter(deps: { store: Store; converse: ConverseFn; speak: Speaker; verify: Verifier; limits: Limits; recompile: (day: string) => Promise<DayLog | null>; now: () => Date }) {
  const search = (days: { date: string; decisions: { what: string; why: string; quote: string; sessionId: string }[] }[], q: string) => {
    const needle = q.toLowerCase();
    return days.flatMap(d => d.decisions.filter(x => `${x.what} ${x.why} ${x.quote}`.toLowerCase().includes(needle)).map(x => ({ date: d.date, ...x })));
  };
  const speech = async (body: string | null): Promise<ApiResponse> => {
    const b = parse(speechBody, body);
    if (!b) return json(400, { error: 'bad request' });
    try {
      return { status: 200, headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' }, body: Buffer.from(await deps.speak(b.text)).toString('base64'), isBase64Encoded: true };
    } catch { return json(502, { error: 'speech unavailable' }); }
  };

  const dispatch = async (req: ApiRequest): Promise<ApiResponse> => {
    const demo = req.path.startsWith('/demo/');
    const path = demo ? req.path.slice('/demo'.length) : req.path;
    if (demo) {
      if (!deps.limits.take(req.ip, deps.now().getTime())) return json(429, { error: 'limit' });
      if (req.method === 'GET' && path === '/days') return json(200, await deps.store.listPublished());
      const m = /^\/days\/(\d{4}-\d{2}-\d{2})$/.exec(path);
      if (req.method === 'GET' && m) { const d = await deps.store.getPublished(m[1]!); return d ? json(200, d) : NOT_FOUND; }
      if (req.method === 'GET' && path === '/search') {
        const days = (await Promise.all((await deps.store.listPublished()).map(d => deps.store.getPublished(d)))).filter(d => d !== null);
        return json(200, search(days, req.query.q ?? ''));
      }
      if (req.method === 'POST' && path === '/ask') {
        const b = parse(askBody, req.body); if (!b) return json(400, { error: 'bad request' });
        const days = (await Promise.all((await deps.store.listPublished()).slice(0, 30).map(d => deps.store.getPublished(d)))).filter(d => d !== null);
        return json(200, await ask({ question: b.question, days, converse: deps.converse }));
      }
      if (req.method === 'POST' && path === '/speech') return speech(req.body);
      return NOT_FOUND;
    }
    if (!(await deps.verify(req.headers.authorization))) return json(401, { error: 'unauthorized' });
    if (req.method === 'GET' && path === '/days') return json(200, await deps.store.listDays());
    // "Last sync" on the page (spec §6): tells the owner when Bee stopped answering.
    if (req.method === 'GET' && path === '/status') return json(200, { syncedAt: (await deps.store.getCursor())?.syncedAt ?? null });
    const m = /^\/days\/(\d{4}-\d{2}-\d{2})$/.exec(path);
    if (req.method === 'GET' && m) { const d = await deps.store.getDay(m[1]!); return d ? json(200, d) : NOT_FOUND; }
    if (req.method === 'GET' && path === '/search') {
      const days = (await Promise.all((await deps.store.listDays()).map(d => deps.store.getDay(d)))).filter(d => d !== null);
      return json(200, search(days, req.query.q ?? ''));
    }
    if (req.method === 'POST' && path === '/ask') {
      const b = parse(askBody, req.body); if (!b) return json(400, { error: 'bad request' });
      const days = (await Promise.all((await deps.store.listDays()).slice(0, 14).map(d => deps.store.getDay(d)))).filter(d => d !== null);
      return json(200, await ask({ question: b.question, days, converse: deps.converse }));
    }
    if (req.method === 'POST' && path === '/speech') return speech(req.body);
    if (req.method === 'POST' && path === '/publish') {
      const b = parse(publishBody, req.body); if (!b) return json(400, { error: 'bad request' });
      const pub = await publishDay({ store: deps.store, day: b.date, excludeSessions: b.excludeSessions, now: deps.now(), dryRun: b.preview, hide: texts => hideNames(texts, deps.converse) });
      return pub ? json(200, pub) : NOT_FOUND;
    }
    if (req.method === 'POST' && path === '/unpublish') {
      const b = parse(unpublishBody, req.body); if (!b) return json(400, { error: 'bad request' });
      await unpublishDay(deps.store, b.date); return json(200, { ok: true });
    }
    if (req.method === 'POST' && path === '/forget') {
      const b = parse(forgetBody, req.body); if (!b) return json(400, { error: 'bad request' });
      return json(200, await forgetSession({ store: deps.store, sessionId: b.sessionId, recompile: deps.recompile }));
    }
    return NOT_FOUND;
  };

  return async (req: ApiRequest): Promise<ApiResponse> => {
    try { return await dispatch(req); } catch (err) {
      log({ level: 'error', msg: 'api_error', route: req.path.split('?')[0], error: err instanceof Error ? err.name : 'unknown' });
      return json(500, { error: 'internal' });
    }
  };
}
