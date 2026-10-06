import { describe, expect, it } from 'vitest';
import { answerHtml, dayChipsHtml, dayHtml, emptyDayHtml, escapeHtml, previewBarHtml, sideHtml, syncLabel, weekHtml } from '../../web/render.js';
import { sha256Hex } from '../../web/api.js';
import type { CommitRef, DayLog, PublishedDay } from '../../src/domain/types.js';

const commit = (sha: string, message = `feat: change ${sha}`): CommitRef =>
  ({ repo: 'o/r', sha, message, url: `https://github.com/o/r/commit/${sha}`, at: '2026-10-03T19:00:00.000Z' });

const day: DayLog = {
  date: '2026-10-03', summary: 'Switched voices to <Polly>',
  sessions: [{ id: 's1', startedAt: '2026-10-03T18:00:00.000Z', endedAt: '2026-10-03T18:20:00.000Z', topic: 'Voices' }],
  decisions: [{ what: 'Use Polly', why: 'No credits', quote: 'We use Polly.', quoteOriginal: 'Usamos Polly.', at: '2026-10-03T18:05:00.000Z', sessionId: 's1', commits: ['aaa1111'] }],
  todos: [{ text: 'Delete old video', sessionId: 's1' }], openQuestions: [{ text: 'Retake florist?', sessionId: 's1' }],
  commits: [{ ...commit('aaa1111', 'feat: Polly') }],
  updatedAt: 'u'
};
const published = (d: DayLog): PublishedDay => ({ ...d, decisions: d.decisions.map(({ quoteOriginal: _x, ...x }) => x), publishedAt: 'p' });

describe('page rendering', () => {
  it('escapes text from the log', () => {
    const evil = { ...day, decisions: [{ ...day.decisions[0]!, what: '<img src=x>', why: '"><script>', quote: "'q'" }] };
    const html = dayHtml(evil, { private: true });
    expect(html).toContain('&lt;Polly&gt;'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script');
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
  });

  it('shows a day hero with a readable summary and counters', () => {
    const html = dayHtml(day, { private: true });
    expect(html).toMatch(/class="hero"/); expect(html).toMatch(/<p class="summary">Switched voices/);
    expect(html).not.toContain('<h1>Switched');
    expect(html).toMatch(/data-count="decisions"[^>]*>\s*<b>1<\/b>/);
    expect(html).toMatch(/data-count="commits"[^>]*>\s*<b>1<\/b>/);
  });

  it('lays decisions on a timeline with the why highlighted, a muted quote and commit links', () => {
    const html = dayHtml(day, { private: true });
    expect(html).toMatch(/<ol class="timeline">/); expect(html).toMatch(/class="decision"/);
    expect(html).toMatch(/class="d-what">Use Polly/);
    expect(html).toMatch(/class="d-why">.*No credits/);
    expect(html).toMatch(/class="d-quote">.*We use Polly\./);
    expect(html).toContain('href="https://github.com/o/r/commit/aaa1111"');
  });

  it('links at most three commits per decision', () => {
    const shas = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const many = { ...day, commits: shas.map(s => commit(s)), decisions: [{ ...day.decisions[0]!, commits: shas }] };
    const timeline = dayHtml(many, { private: true }).split('class="all-commits"')[0]!;
    expect(timeline.match(/class="commit"/g)).toHaveLength(3);
  });

  it('offers the original quote behind a toggle only in private mode', () => {
    const priv = dayHtml(day, { private: true });
    expect(priv).toMatch(/<details class="original"><summary>Show original<\/summary>/); expect(priv).toContain('Usamos Polly.');
    expect(priv).toContain('data-action="forget"'); expect(priv).toContain('data-action="publish"');
    // Even if a day still carries quoteOriginal, public mode never renders it.
    const pub = dayHtml(day, { private: false });
    expect(pub).not.toContain('Usamos Polly.'); expect(pub).not.toContain('Show original'); expect(pub).not.toContain('data-action');
    expect(dayHtml(published(day), { private: false })).not.toContain('class="original"');
  });

  it('keeps every commit of the day in a closed collapsible section', () => {
    const html = dayHtml({ ...day, commits: ['a1', 'b2', 'c3'].map(s => commit(s)) }, { private: false });
    expect(html).toMatch(/<details class="all-commits"><summary>All commits today/);
    expect(html).not.toMatch(/<details class="all-commits" open/);
    expect(html.split('class="all-commits"')[1]!.match(/<li/g)).toHaveLength(3);
    expect(dayHtml({ ...day, commits: [] }, { private: false })).not.toContain('all-commits');
  });

  it('never links non-GitHub commit urls', () => {
    const bad = { ...day, commits: day.commits.map(c => ({ ...c, url: 'javascript:alert(1)' })) };
    const html = dayHtml(bad, { private: true });
    expect(html).not.toContain('javascript:'); expect(html).toContain('aaa1111'); expect(html).toContain('feat: Polly');
  });

  it('shows pending items, open questions and sessions in the side column, hiding empty sections', () => {
    const html = sideHtml(day, []);
    expect(html).toContain('Delete old video'); expect(html).toContain('Retake florist?'); expect(html).toContain('Voices');
    const bare = sideHtml({ ...day, todos: [], openQuestions: [] }, []);
    expect(bare).not.toContain('Pending'); expect(bare).not.toContain('Open questions');
    const nothing = sideHtml(null, []);
    expect(nothing).not.toMatch(/<h2>[^<]*<\/h2>\s*(<\/section>|$)/); expect(nothing).toContain('class="side-empty"');
  });

  it('summarizes a week with counts, top topics and still-open items, and hides empty parts', () => {
    const html = weekHtml([day]);
    expect(html).toMatch(/<b>1<\/b> decision across 1 day/); expect(html).toContain('Voices'); expect(html).toContain('Delete old video');
    expect(weekHtml([{ ...day, todos: [], openQuestions: [] }])).not.toContain('Still open');
    expect(weekHtml([])).toBe('');
    const other = { ...day, date: '2026-10-02', todos: [{ text: 'Older item', sessionId: 's1' }], openQuestions: [] };
    const side = sideHtml(day, [day, other]);
    expect(side.match(/Delete old video/g)).toHaveLength(1); expect(side).toContain('Older item');
  });

  it('draws day chips with weekday, date, count and the current marker, plus prev/next', () => {
    const html = dayChipsHtml([{ date: '2026-10-03', decisions: 3 }, { date: '2026-10-02', decisions: 0 }], '2026-10-03');
    expect(html).toMatch(/data-date="2026-10-03"[^>]*aria-current="date"/);
    expect(html).toContain('Fri'); expect(html).toContain('Oct 3'); expect(html).toMatch(/class="chip-n"[^>]*>3</);
    expect(html).toMatch(/aria-label="Older day" data-date="2026-10-02"/);
    expect(html).toMatch(/aria-label="Newer day" disabled/);
  });

  it('shows a friendly empty day', () => {
    const html = emptyDayHtml('2026-10-04');
    expect(html).toContain('No sessions recorded this day'); expect(html).toContain('Bee');
  });

  it('renders an answer with citation chips that open the day', () => {
    const html = answerHtml({ answer: 'Because <cost>', citations: [{ date: '2026-10-03', decision: 'Use Polly' }] });
    expect(html).toContain('Because &lt;cost&gt;'); expect(html).toMatch(/class="cite" data-date="2026-10-03"/);
  });

  it('builds the publish preview bar and a relative sync label', () => {
    expect(previewBarHtml('2026-10-03')).toMatch(/data-action="confirm-publish" data-date="2026-10-03"/);
    const now = Date.parse('2026-10-03T20:00:00.000Z');
    expect(syncLabel(null, now)).toBe('Not synced yet');
    expect(syncLabel('2026-10-03T19:18:00.000Z', now)).toBe('Synced 42 min ago');
    expect(syncLabel('2026-10-03T17:00:00.000Z', now)).toBe('Synced 3 hours ago');
  });
});

describe('request signing helper', () => {
  it('hashes text as lowercase hex SHA-256', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('work filter counter', () => {
  it('shows how many personal conversations were ignored, only when there are some', () => {
    expect(dayHtml({ ...day, ignoredPersonal: 3 }, { private: true })).toContain('3 personal conversations ignored');
    expect(dayHtml({ ...day, ignoredPersonal: 1 }, { private: false })).toContain('1 personal conversation ignored');
    expect(dayHtml(day, { private: true })).not.toContain('ignored');
  });

  it('shows a changed badge linking both days with the old commits, and the follow-up state', () => {
    const d = { ...day.decisions[0]!, id: 's1#0',
      change: { from: [{ id: 'x#0', date: '2026-10-01', what: 'Use <b>Nova</b>', sessionId: 'x' }, { id: 'y#0', date: '2026-09-28', what: 'Use Titan', sessionId: 'y' }], commits: [commit('old1111', 'feat: Nova voice')] },
      changedLater: { id: 'z#0', date: '2026-10-05' }, refines: { id: 'w#0', date: '2026-10-02' },
      followUp: { text: 'Record the demo', status: 'closed' as const, closedBy: commit('fix2222', 'feat: demo') } };
    const html = dayHtml({ ...day, decisions: [d] }, { private: true });
    expect(html).toContain('badge-changed">Changed<');
    expect(html).toMatch(/data-date="2026-10-01"[^>]*>Oct 1</); expect(html).toMatch(/data-date="2026-09-28"/);
    expect(html).toContain('aria-label="Open Oct 1"');
    expect(html).toContain('Use &lt;b&gt;Nova&lt;/b&gt;'); expect(html).not.toContain('<b>Nova');
    expect(html).toContain('Work that may need undoing'); expect(html).toContain('old1111');
    expect(html).toMatch(/Changed later<\/span> <button[^>]*data-date="2026-10-05"/);
    expect(html).toMatch(/Refines<\/span>/);
    expect(html).toContain('Follow-up closed'); expect(html).toContain('fix2222');
    const open = dayHtml({ ...day, decisions: [{ ...day.decisions[0]!, followUp: { text: 'Record the demo', status: 'open' } }] }, { private: false });
    expect(open).toContain('Follow-up open'); expect(open).not.toContain('Work that may need undoing');
    expect(dayHtml(day, { private: true })).not.toContain('badge');
  });
});
