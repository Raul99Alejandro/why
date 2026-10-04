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
    const calls: { url: string; }[] = [];
    const fetchFn = (async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify(api), { status: 200 });
    }) as typeof fetch;

    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutLines.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const out = await commitsOn('2026-10-03', ['o/r', 'bad repo', '../x'], 'America/Mexico_City', fetchFn);

      // Only valid repo should be fetched
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toContain('/repos/o/r/');
      expect(out).toEqual([{ repo: 'o/r', sha: 'aaa1111', message: 'feat: Polly voice', url: 'https://github.com/o/r/commit/aaa1111', at: '2026-10-04T01:00:00.000Z' }]);

      // Verify warnings for invalid repos
      const logOutput = stdoutLines.join('');
      expect(logOutput).toContain('bad repo');
      expect(logOutput).toContain('../x');
      expect(logOutput).toContain('github_repo_invalid');
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
