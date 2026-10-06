import type { CommitRef, DayLog, PublishedDay } from '../src/domain/types.js';

// Pure HTML builders: every piece of dynamic text goes through escapeHtml, so the page can assign the result to innerHTML.
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ENT[c]!);
const e = escapeHtml;

type Day = DayLog | PublishedDay;
const ZONE = 'America/Mexico_City';
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ZONE });
// A YYYY-MM-DD date is a calendar day, not an instant: read it at UTC noon so no time zone shifts it.
const cal = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
const longDate = (date: string) => cal(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (date: string) => cal(date, { month: 'short', day: 'numeric' });
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const isGitHub = (url: string) => /^https:\/\/github\.com\//i.test(url);
const MAX_COMMITS_PER_DECISION = 3;

const ICON = {
  more: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  commit: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 12h6.5M15.5 12H22" stroke="currentColor" stroke-width="2"/></svg>'
};

function commitTag(c: CommitRef): string {
  const inner = `${ICON.commit}<code>${e(c.sha.slice(0, 7))}</code><span class="commit-msg">${e(c.message)}</span>`;
  return isGitHub(c.url)
    ? `<a class="commit" href="${e(c.url)}" target="_blank" rel="noopener noreferrer" title="${e(`${c.repo}: ${c.message}`)}">${inner}</a>`
    : `<span class="commit" title="${e(`${c.repo}: ${c.message}`)}">${inner}</span>`;
}

function heroCounters(day: Day): string {
  const items: [string, number, string, string?][] = [
    ['decisions', day.decisions.length, 'decision'],
    ['pending', day.todos.length, 'pending', 'pending'],
    ['questions', day.openQuestions.length, 'open question'],
    ['sessions', day.sessions.length, 'session'],
    ['commits', day.commits.length, 'commit']
  ];
  return `<ul class="counters">${items.map(([key, n, word, many]) => {
    const label = plural(n, word, many).replace(/^\d+ /, '');
    return `<li data-count="${key}"${n === 0 ? ' class="zero"' : ''}><b>${n}</b> ${e(label)}</li>`;
  }).join('')}</ul>`;
}

function ignoredNote(day: Day): string {
  const n = day.ignoredPersonal ?? 0;
  return n > 0 ? `<p class="ignored">${n} personal ${n === 1 ? 'conversation' : 'conversations'} ignored</p>` : '';
}

function ownerMenu(day: Day): string {
  const forgets = day.sessions.map(s =>
    `<button type="button" class="menu-item danger" data-action="forget" data-session="${e(s.id)}">Forget “${e(s.topic)}” <span>${e(time(s.startedAt))}</span></button>`).join('');
  return `<details class="owner-menu"><summary aria-label="Owner actions" title="Owner actions">${ICON.more}</summary>`
    + `<div class="menu-pop"><button type="button" class="menu-item" data-action="publish" data-date="${e(day.date)}">Publish to demo…<span>Preview first, then confirm</span></button>`
    + (forgets ? `<p class="menu-label">Forget a session</p>${forgets}` : '') + `</div></details>`;
}

const dayLink = (date: string, label: string) => `<button type="button" class="link-day" data-date="${e(date)}">${e(label)}</button>`;

/** "Changed" badge on a reversal (both days linked, the old commits as work that may need undoing), small notes for the other links, and the follow-up state. */
function changeNotes(d: Day['decisions'][number]): string {
  const parts: string[] = [];
  if (d.change) {
    const steps = d.change.from.map(f => `<li>${dayLink(f.date, shortDate(f.date))} <span class="chg-what">${e(f.what)}</span></li>`).join('');
    const undo = d.change.commits.slice(0, MAX_COMMITS_PER_DECISION);
    parts.push(`<div class="changed"><p class="changed-head"><span class="badge badge-changed">Changed</span> You changed your mind. Earlier you decided:</p><ol class="chg-steps">${steps}</ol>`
      + (undo.length ? `<p class="chg-undo">Work that may need undoing</p><div class="d-commits">${undo.map(commitTag).join('')}</div>` : '') + `</div>`);
  }
  if (d.changedLater) parts.push(`<p class="d-note"><span class="badge badge-changed">Changed later</span> ${dayLink(d.changedLater.date, shortDate(d.changedLater.date))}</p>`);
  if (d.refines) parts.push(`<p class="d-note"><span class="badge badge-refines">Refines</span> an earlier decision from ${dayLink(d.refines.date, shortDate(d.refines.date))}</p>`);
  if (d.followUp) {
    const closed = d.followUp.status === 'closed';
    parts.push(`<p class="d-note follow-up ${closed ? 'closed' : 'open'}"><span class="badge ${closed ? 'badge-closed' : 'badge-open'}">${closed ? 'Follow-up closed' : 'Follow-up open'}</span> ${e(d.followUp.text)}</p>`
      + (closed && d.followUp.closedBy ? `<div class="d-commits">${commitTag(d.followUp.closedBy)}</div>` : ''));
  }
  return parts.join('');
}

function decisionItem(d: Day['decisions'][number], bySha: Map<string, CommitRef>, topics: Map<string, string>, priv: boolean): string {
  const original = priv && 'quoteOriginal' in d && typeof d.quoteOriginal === 'string' && d.quoteOriginal.trim() && d.quoteOriginal !== d.quote
    ? `<details class="original"><summary>Show original</summary><p>${e(d.quoteOriginal)}</p></details>` : '';
  const commits = d.commits.map(s => bySha.get(s)).filter((c): c is CommitRef => !!c).slice(0, MAX_COMMITS_PER_DECISION);
  const topic = topics.get(d.sessionId);
  return `<li class="decision"><div class="d-rail"><time datetime="${e(d.at)}">${e(time(d.at))}</time>${topic ? `<span class="d-session">${e(topic)}</span>` : ''}</div>`
    + `<div class="d-body"><h3 class="d-what">${e(d.what)}</h3>`
    + changeNotes(d)
    + `<p class="d-why"><span class="why-mark">Why</span><span class="why-text">${e(d.why)}</span></p>`
    + `<p class="d-quote">“${e(d.quote)}” <span class="d-at">heard at ${e(time(d.at))}</span></p>${original}`
    + (commits.length ? `<div class="d-commits">${commits.map(commitTag).join('')}</div>` : '') + `</div></li>`;
}

function allCommits(day: Day): string {
  if (!day.commits.length) return '';
  const rows = [...day.commits].sort((a, b) => a.at.localeCompare(b.at)).map(c => {
    const sha = `<code>${e(c.sha.slice(0, 7))}</code>`;
    const head = isGitHub(c.url) ? `<a href="${e(c.url)}" target="_blank" rel="noopener noreferrer">${sha}</a>` : sha;
    return `<li>${head}<span class="cl-msg">${e(c.message)}</span><span class="cl-meta">${e(c.repo)}, ${e(time(c.at))}</span></li>`;
  }).join('');
  return `<details class="all-commits"><summary>All commits today <span class="count">${day.commits.length}</span></summary><ul class="commit-list">${rows}</ul></details>`;
}

export function dayHtml(day: Day, opts: { private: boolean }): string {
  const bySha = new Map(day.commits.map(c => [c.sha, c]));
  const topics = new Map(day.sessions.map(s => [s.id, s.topic]));
  const ordered = [...day.decisions].sort((a, b) => a.at.localeCompare(b.at));
  const timeline = ordered.length
    ? `<ol class="timeline">${ordered.map(d => decisionItem(d, bySha, topics, opts.private)).join('')}</ol>`
    : `<p class="timeline-empty">Bee recorded ${plural(day.sessions.length, 'session')} this day, but no decisions came out of ${day.sessions.length === 1 ? 'it' : 'them'}.</p>`;
  return `<section class="hero" aria-labelledby="day-title"><div class="hero-top"><h1 id="day-title" class="hero-date"><time datetime="${e(day.date)}">${e(longDate(day.date))}</time></h1>`
    + `${opts.private ? ownerMenu(day) : ''}</div><p class="summary">${e(day.summary)}</p>${heroCounters(day)}${ignoredNote(day)}</section>`
    + `<section class="decisions" aria-label="Decisions"><h2 class="section-title">Decisions</h2>${timeline}</section>${allCommits(day)}`;
}

export const emptyDayHtml = (date: string) =>
  `<section class="hero hero-empty" aria-labelledby="day-title"><div class="hero-top"><h1 id="day-title" class="hero-date"><time datetime="${e(date)}">${e(longDate(date))}</time></h1></div>`
  + `<p class="summary">No sessions recorded this day</p><p class="hint">Wear Bee while you work and sync afterwards: the decisions you talk through show up here, with why you made them.</p></section>`;

export function dayChipsHtml(days: { date: string; decisions: number }[], selected: string): string {
  const i = days.findIndex(d => d.date === selected);
  const older = i >= 0 ? days[i + 1] : undefined;
  const newer = i > 0 ? days[i - 1] : undefined;
  const arrow = (label: string, d: { date: string } | undefined, icon: string) =>
    `<button type="button" class="nav-arrow" aria-label="${label}"${d ? ` data-date="${e(d.date)}"` : ' disabled'}>${icon}</button>`;
  const chips = [...days].reverse().map(d =>
    `<li><button type="button" class="chip${d.decisions === 0 ? ' chip-zero' : ''}" data-date="${e(d.date)}"${d.date === selected ? ' aria-current="date"' : ''} aria-label="${e(`${longDate(d.date)}: ${plural(d.decisions, 'decision')}`)}">`
    + `<span class="chip-wd">${e(cal(d.date, { weekday: 'short' }))}</span><span class="chip-d">${e(shortDate(d.date))}</span><span class="chip-n" aria-hidden="true">${d.decisions}</span></button></li>`).join('');
  return `<nav class="days" aria-label="Days">${arrow('Older day', older, ICON.left)}<ol class="chips">${chips}</ol>${arrow('Newer day', newer, ICON.right)}</nav>`;
}

const section = (cls: string, title: string, body: string) => `<section class="side-card ${cls}"><h2>${title}</h2>${body}</section>`;

/** `skip` holds item texts already listed for the selected day, so "Still open" only adds the rest of the week. */
export function weekHtml(days: Day[], skip: ReadonlySet<string> = new Set()): string {
  if (!days.length) return '';
  const n = days.reduce((s, d) => s + d.decisions.length, 0);
  const freq = new Map<string, number>();
  for (const s of days.flatMap(d => d.sessions)) freq.set(s.topic, (freq.get(s.topic) ?? 0) + 1);
  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  const open = [...new Set(days.flatMap(d => [...d.todos, ...d.openQuestions].map(t => t.text)))].filter(t => !skip.has(t));
  const shown = open.slice(0, 5);
  return section('week', 'This week',
    `<p class="week-n"><b>${n}</b> ${n === 1 ? 'decision' : 'decisions'} across ${plural(days.length, 'day')}</p>`
    + (topics.length ? `<h3>Top topics</h3><ul class="topics">${topics.map(t => `<li>${e(t)}</li>`).join('')}</ul>` : '')
    + (shown.length ? `<h3>${skip.size ? 'Also open this week' : 'Still open'}</h3><ul class="still-open">${shown.map(t => `<li>${e(t)}</li>`).join('')}</ul>`
      + (open.length > shown.length ? `<p class="more">and ${open.length - shown.length} more</p>` : '') : ''));
}

export function sideHtml(day: Day | null, week: Day[]): string {
  const parts: string[] = [];
  if (day?.todos.length) parts.push(section('pending', 'Pending', `<ul class="checklist">${day.todos.map(t => `<li><span class="box" aria-hidden="true"></span>${e(t.text)}</li>`).join('')}</ul>`));
  if (day?.openQuestions.length) parts.push(section('questions', 'Open questions', `<ul class="qlist">${day.openQuestions.map(q => `<li>${e(q.text)}</li>`).join('')}</ul>`));
  if (day && !day.todos.length && !day.openQuestions.length) parts.push('<p class="side-empty">Nothing left open from this day.</p>');
  if (day?.sessions.length) parts.push(section('sessions', 'Sessions', `<ul class="slist">${day.sessions.map(s =>
    `<li><span class="s-time">${e(time(s.startedAt))}–${e(time(s.endedAt))}</span><span class="s-topic">${e(s.topic)}</span></li>`).join('')}</ul>`));
  const w = weekHtml(week, new Set(day ? [...day.todos, ...day.openQuestions].map(t => t.text) : []));
  if (w) parts.push(w);
  return parts.join('') || '<p class="side-empty">Nothing to show yet. Sync a day recorded with Bee and it fills in here.</p>';
}

export function answerHtml(out: { answer: string; citations: { date: string; decision: string }[] }): string {
  const cites = out.citations.map(c => `<button type="button" class="cite" data-date="${e(c.date)}"><span class="cite-d">${e(shortDate(c.date))}</span>${e(c.decision)}</button>`).join('');
  return `<p class="answer-text">${e(out.answer)}</p>${cites ? `<div class="cites">${cites}</div>` : ''}`;
}

export const previewBarHtml = (date: string) =>
  `<div class="preview-bar" role="region" aria-label="Publish preview"><p><strong>Preview of what the judges will see.</strong> Original-language quotes and owner controls are removed.</p>`
  + `<div class="preview-actions"><button type="button" class="btn ghost" data-action="cancel-preview">Cancel</button><button type="button" class="btn primary" data-action="confirm-publish" data-date="${e(date)}">Publish to demo</button></div></div>`;

/** "Synced 42 min ago" style label for the header pill. */
export function syncLabel(syncedAt: string | null, now = Date.now()): string {
  if (!syncedAt) return 'Not synced yet';
  const mins = Math.max(0, Math.round((now - new Date(syncedAt).getTime()) / 60_000));
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${plural(hours, 'hour')} ago`;
  return `Synced ${new Date(syncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ZONE })}`;
}
