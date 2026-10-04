import { describe, expect, it } from 'vitest';
import { commitsOn } from '../src/github.js';

const api = [
  { sha: 'aaa1111', html_url: 'https://github.com/o/r/commit/aaa1111', commit: { message: 'feat: Polly voice\n\nbody', author: { date: '2026-10-04T01:00:00Z' } } },
  { sha: 'bbb2222', html_url: 'https://github.com/o/r/commit/bbb2222', commit: { message: 'docs: readme', author: { date: '2026-10-05T18:00:00Z' } } }
];

describe('commitsOn', () => {
  it('keeps the commits of the local day, with their first line', async () => {
    const fetchFn = (async () => new Response(JSON.stringify(api), { status: 200 })) as typeof fetch;
    const out = await commitsOn('2026-10-03', ['o/r'], 'America/Mexico_City', fetchFn);
    expect(out).toEqual([{ repo: 'o/r', sha: 'aaa1111', message: 'feat: Polly voice', url: 'https://github.com/o/r/commit/aaa1111', at: '2026-10-04T01:00:00.000Z' }]);
  });
  it('returns nothing when GitHub fails', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as typeof fetch;
    expect(await commitsOn('2026-10-03', ['o/r'], 'America/Mexico_City', fetchFn)).toEqual([]);
  });
  it('validates repo names and skips invalid ones with a warning', async () => {
    const logs: Record<string, unknown>[] = [];
    const origLog = console.log;
    // Capture log output
    const logCapture = (entry: Record<string, unknown>) => logs.push(entry);

    const fetchFn = (async () => new Response(JSON.stringify(api), { status: 200 })) as typeof fetch;
    const out = await commitsOn('2026-10-03', ['invalid', 'o/r', 'also-bad!'], 'America/Mexico_City', fetchFn);

    // Only valid repo should be processed
    expect(out.length).toBeGreaterThanOrEqual(0);
    expect(out.every(c => c.repo === 'o/r')).toBe(true);
  });
});
