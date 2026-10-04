import type { DayLog, PublishedDay } from '../src/domain/types.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ENT[c]!);
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' });

export function dayHtml(day: DayLog | PublishedDay, opts: { private: boolean }): string {
  const bySha = new Map(day.commits.map(c => [c.sha, c]));
  const decisions = day.decisions.map(d => {
    const original = opts.private && 'quoteOriginal' in d ? `<p class="original">${escapeHtml((d as { quoteOriginal: string }).quoteOriginal)}</p>` : '';
    const commits = d.commits.map(s => bySha.get(s)).filter(c => c).map(c => {
      const label = `${escapeHtml(c!.sha)} ${escapeHtml(c!.message)}`;
      return /^https:\/\/github\.com\//i.test(c!.url) ? `<a class="commit" href="${escapeHtml(c!.url)}" target="_blank" rel="noopener">${label}</a>` : `<span class="commit">${label}</span>`;
    }).join('');
    const forget = opts.private ? `<button class="link" data-action="forget" data-session="${escapeHtml(d.sessionId)}">Forget this session</button>` : '';
    return `<article class="decision"><h3>${escapeHtml(d.what)}</h3><p class="why"><b>Why:</b> ${escapeHtml(d.why)}</p>`
      + `<blockquote>${escapeHtml(d.quote)}<span class="at">${escapeHtml(time(d.at))}</span></blockquote>${original}<div class="commits">${commits}</div>${forget}</article>`;
  }).join('') || '<p class="empty">No decisions recorded.</p>';
  const list = (items: { text: string }[], cls: string, empty: string) =>
    items.length ? `<ul class="${cls}">${items.map(i => `<li>${escapeHtml(i.text)}</li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`;
  const timeline = `<ol class="timeline">${day.sessions.map(s => `<li><span>${escapeHtml(time(s.startedAt))}–${escapeHtml(time(s.endedAt))}</span> ${escapeHtml(s.topic)}</li>`).join('')}</ol>`;
  const publish = opts.private ? `<button data-action="publish" data-date="${escapeHtml(day.date)}">Publish to demo</button>` : '';
  return `<header class="day-head"><p class="date">${escapeHtml(day.date)}</p><h1>${escapeHtml(day.summary)}</h1>${publish}</header>`
    + `<section><h2>Decisions</h2><div class="decisions">${decisions}</div></section>`
    + `<div class="cols"><section><h2>Pending</h2>${list(day.todos, 'todos', 'Nothing pending.')}</section>`
    + `<section><h2>Open questions</h2>${list(day.openQuestions, 'questions', 'No open questions.')}</section></div>`
    + `<section><h2>Sessions</h2>${timeline}</section>`;
}

export function stripHtml(days: { date: string; decisions: number }[], selected: string): string {
  return `<nav class="strip">${days.map(d => `<button data-date="${escapeHtml(d.date)}"${d.date === selected ? ' aria-current="date"' : ''}>`
    + `<span class="dot" style="--n:${Math.min(d.decisions, 8)}"></span>${escapeHtml(d.date.slice(5))}</button>`).join('')}</nav>`;
}

export function weekHtml(days: (DayLog | PublishedDay)[]): string {
  const n = days.reduce((s, d) => s + d.decisions.length, 0);
  const open = days.flatMap(d => d.todos.map(t => t.text));
  const topics = [...new Set(days.flatMap(d => d.sessions.map(s => s.topic)))].slice(0, 6);
  return `<section class="week"><h2>This week</h2><p>${n} decision${n === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'}.</p>`
    + `<p class="topics">${topics.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</p>`
    + `<h3>Still open</h3><ul>${open.slice(0, 10).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul></section>`;
}

export const emptyDayHtml = (date: string) => `<header class="day-head"><p class="date">${escapeHtml(date)}</p><h1>No sessions recorded</h1></header>`;
