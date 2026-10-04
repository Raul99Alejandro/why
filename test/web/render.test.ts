import { describe, expect, it } from 'vitest';
import { dayHtml, emptyDayHtml, escapeHtml, stripHtml, weekHtml } from '../../web/render.js';
import { sha256Hex } from '../../web/api.js';
import type { DayLog } from '../../src/domain/types.js';

const day: DayLog = {
  date: '2026-10-03', summary: 'Switched voices to <Polly>',
  sessions: [{ id: 's1', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:20:00.000Z', topic: 'Voices' }],
  decisions: [{ what: 'Use Polly', why: 'No credits', quote: 'We use Polly.', quoteOriginal: 'Usamos Polly.', at: '2026-10-03T18:05:00.000Z', sessionId: 's1', commits: ['aaa1111'] }],
  todos: [{ text: 'Delete old video', sessionId: 's1' }], openQuestions: [{ text: 'Retake florist?', sessionId: 's1' }],
  commits: [{ repo: 'o/r', sha: 'aaa1111', message: 'feat: Polly', url: 'https://github.com/o/r/commit/aaa1111', at: '2026-10-03T19:00:00.000Z' }],
  updatedAt: 'u'
};

describe('page rendering', () => {
  it('escapes text from the log', () => { expect(dayHtml(day, { private: true })).toContain('&lt;Polly&gt;'); expect(escapeHtml('<a>')).toBe('&lt;a&gt;'); });
  it('shows decisions with their reason, quote and commit links', () => {
    const html = dayHtml(day, { private: true });
    expect(html).toMatch(/class="decision"/); expect(html).toContain('No credits'); expect(html).toContain('We use Polly.');
    expect(html).toContain('href="https://github.com/o/r/commit/aaa1111"');
  });
  it('shows the original quote and private controls only in private mode', () => {
    expect(dayHtml(day, { private: true })).toContain('Usamos Polly.');
    expect(dayHtml(day, { private: true })).toContain('data-action="forget"');
    const pub = dayHtml({ ...day, decisions: day.decisions.map(({ quoteOriginal: _x, ...d }) => d), publishedAt: 'p' }, { private: false });
    expect(pub).not.toContain('Usamos Polly.'); expect(pub).not.toContain('data-action');
  });
  it('lists pending items, open questions and the timeline', () => {
    const html = dayHtml(day, { private: true });
    expect(html).toContain('Delete old video'); expect(html).toContain('Retake florist?'); expect(html).toMatch(/class="timeline"/);
  });
  it('draws a dot sized by decisions in the day strip, and an empty day', () => {
    expect(stripHtml([{ date: '2026-10-03', decisions: 3 }], '2026-10-03')).toMatch(/aria-current="date"/);
    expect(emptyDayHtml('2026-10-04')).toContain('No sessions recorded');
  });
  it('never links non-GitHub commit urls', () => {
    const bad = { ...day, commits: day.commits.map(c => ({ ...c, url: 'javascript:alert(1)' })) };
    const html = dayHtml(bad, { private: true });
    expect(html).not.toContain('javascript:'); expect(html).toContain('aaa1111 feat: Polly');
  });
  it('summarizes a week', () => { expect(weekHtml([day])).toContain('1 decision'); });
});

describe('request signing helper', () => {
  it('hashes text as lowercase hex SHA-256', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
