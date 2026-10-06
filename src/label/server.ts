import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Store } from '../store/store.js';
import { isDay, loadLabels, parseLabels, saveLabels } from './accuracy.js';
import { LABEL_PAGE } from './page.js';

const MAX_BODY = 200_000;

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise(resolve => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * Local labeling server. Callers must only ever listen on 127.0.0.1. Requests whose Host is not a local name are refused
 * (DNS rebinding), and saving needs a custom header that a foreign web page cannot send without a CORS preflight we never answer.
 */
export function createLabelServer(opts: { store: Store; dataDir: string }): Server {
  const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  return createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'forbidden' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
        return void res.end(LABEL_PAGE);
      }
      if (req.method === 'GET' && url.pathname === '/api/day') {
        const day = url.searchParams.get('day');
        if (!isDay(day)) return json(res, 400, { error: 'bad day' });
        const records = await opts.store.listSessionsOn(day);
        const log = await opts.store.getDay(day);
        const sessions = records.map(r => r.session).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        return json(res, 200, { sessions, why: (log?.decisions ?? []).map(d => d.what), labels: loadLabels(opts.dataDir, day) });
      }
      if (req.method === 'POST' && url.pathname === '/api/labels') {
        if (req.headers['x-why-label'] !== '1') return json(res, 403, { error: 'forbidden' });
        const raw = await readBody(req);
        let labels = null;
        try { labels = raw === null ? null : parseLabels(JSON.parse(raw)); } catch { /* invalid JSON */ }
        if (!labels) return json(res, 400, { error: 'bad labels' });
        saveLabels(opts.dataDir, labels);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    } catch {
      return json(res, 500, { error: 'failed' });
    }
  });
}
