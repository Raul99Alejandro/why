import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { computeAccuracy, formatAccuracy, loadLabels, parseLabels, unreviewed, type Labels } from '../src/label/accuracy.js';
import { createLabelServer } from '../src/label/server.js';
import { MemoryStore } from '../src/store/memory.js';
import type { DayLog } from '../src/domain/types.js';

const labels = (o: Partial<Labels>): Labels => ({ day: '2026-10-05', confirmed: [], rejected: [], added: [], ...o });

describe('accuracy', () => {
  it('computes precision, recall and F1 with the 0.8 token-overlap match', () => {
    const why = ['Use Nova for the answers', 'Ship the video on Friday', 'Buy a standing desk'];
    const a = computeAccuracy(why, labels({ confirmed: ['Use Nova for the answers', 'Ship the video on Friday'], rejected: ['Buy a standing desk'], added: ['Move the demo to Monday'] }));
    expect(a).toMatchObject({ why: 3, truth: 3, truePositives: 2, falsePositives: 1, falseNegatives: 1 });
    expect(a.precision).toBeCloseTo(2 / 3);
    expect(a.recall).toBeCloseTo(2 / 3);
    expect(a.f1).toBeCloseTo(2 / 3);
  });
  it('matches regardless of case and word order, but not a loose paraphrase', () => {
    expect(computeAccuracy(['Nova for the answers use'], labels({ added: ['use nova for the answers'] })).truePositives).toBe(1);
    expect(computeAccuracy(['Use Nova'], labels({ added: ['Use Nova for the answers please'] })).truePositives).toBe(0);
  });
  it('matches one to one: two identical decisions need two real ones', () => {
    const a = computeAccuracy(['Use Nova today', 'Use Nova today'], labels({ confirmed: ['Use Nova today'] }));
    expect(a).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
  });
  it('handles empty days without dividing by zero', () => {
    const a = computeAccuracy([], labels({}));
    expect([a.precision, a.recall, a.f1]).toEqual([0, 0, 0]);
  });
  it('flags decisions the owner has not judged', () => {
    expect(unreviewed(['Use Nova', 'Ship Friday'], labels({ confirmed: ['Use Nova'] }))).toEqual(['Ship Friday']);
  });
  it('prints numbers only', () => {
    const out = formatAccuracy(computeAccuracy(['Secret plan about the acquisition'], labels({ confirmed: ['Secret plan about the acquisition'] })));
    expect(out).not.toMatch(/secret|acquisition/i);
    expect(out).toContain('precision 1.00');
  });
  it('rejects malformed labels', () => {
    expect(parseLabels({ day: 'tomorrow', confirmed: [], rejected: [], added: [] })).toBeNull();
    expect(parseLabels({ day: '2026-10-05', confirmed: [1], rejected: [], added: [] })).toBeNull();
    expect(parseLabels({ day: '2026-10-05', confirmed: [], rejected: [] })).toBeNull();
    expect(parseLabels(null)).toBeNull();
  });
});

describe('label server', () => {
  const servers: { close(): void }[] = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });

  async function start() {
    const store = new MemoryStore();
    await store.putSession({ id: 's1', startedAt: '2026-10-05T16:00:00.000Z', endedAt: '2026-10-05T16:10:00.000Z', utterances: [{ speaker: 'A', text: 'We use Nova for the answers', at: '2026-10-05T16:01:00.000Z' }] }, '2026-10-05', 9_999_999_999);
    const log: DayLog = { date: '2026-10-05', summary: '', sessions: [], decisions: [{ what: 'Use Nova for the answers', why: '', quote: '', quoteOriginal: '', at: '2026-10-05T16:01:00.000Z', sessionId: 's1', commits: [] }], todos: [], openQuestions: [], commits: [], updatedAt: '2026-10-05T17:00:00.000Z' };
    await store.putDay(log);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'why-label-'));
    const server = createLabelServer({ store, dataDir });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const { address, port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, address, dataDir };
  }

  it('binds to the loopback address and serves the page', async () => {
    const { base, address } = await start();
    expect(address).toBe('127.0.0.1');
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Local only');
  });
  it('returns the day utterances and Why decisions, then saves labels to the local file', async () => {
    const { base, dataDir } = await start();
    const day = await (await fetch(`${base}/api/day?day=2026-10-05`)).json() as { sessions: { utterances: unknown[] }[]; why: string[] };
    expect(day.sessions[0]!.utterances).toHaveLength(1);
    expect(day.why).toEqual(['Use Nova for the answers']);
    const body = { day: '2026-10-05', confirmed: ['Use Nova for the answers'], rejected: [], added: ['Ship on Friday'] };
    const save = await fetch(`${base}/api/labels`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-why-label': '1' }, body: JSON.stringify(body) });
    expect(save.status).toBe(200);
    expect(loadLabels(dataDir, '2026-10-05')).toEqual(body);
  });
  it('refuses a save without the custom header, bad labels, bad days and path escapes', async () => {
    const { base, dataDir } = await start();
    const post = (headers: Record<string, string>, body: unknown) => fetch(`${base}/api/labels`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const ok = { day: '2026-10-05', confirmed: [], rejected: [], added: [] };
    expect((await post({}, ok)).status).toBe(403);
    expect((await post({ 'x-why-label': '1' }, { ...ok, day: '../../x' })).status).toBe(400);
    expect((await post({ 'x-why-label': '1' }, { ...ok, added: 'x' })).status).toBe(400);
    expect((await fetch(`${base}/api/day?day=../secret`)).status).toBe(400);
    expect(existsSync(path.join(dataDir, 'labels-2026-10-05.json'))).toBe(false);
  });
  it('refuses a foreign Host header (DNS rebinding)', async () => {
    const { base } = await start();
    const res = await new Promise<number>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const r = request(`${base}/api/day?day=2026-10-05`, { headers: { host: 'evil.example' } }, m => resolve(m.statusCode ?? 0));
        r.on('error', reject); r.end();
      });
    });
    expect(res).toBe(403);
  });
});

describe('local labels stay local', () => {
  it('git-ignores the data folder, the only place labels are written', () => {
    expect(readFileSync('.gitignore', 'utf8')).toContain('data/');
  });
  it('the CLI entry points bind only to 127.0.0.1', () => {
    expect(readFileSync('src/cli/label.ts', 'utf8')).toContain("'127.0.0.1'");
  });
});
