import * as realApi from './api.js';
import { demoMode, setToken } from './api.js';
import { signIn, type Config } from './auth.js';
import { answerHtml, dayChipsHtml, dayHtml, emptyDayHtml, escapeHtml, previewBarHtml, sideHtml, syncLabel } from './render.js';
import type { DayLog, PublishedDay } from '../src/domain/types.js';
import './styles.css';

type Backend = Pick<typeof realApi, 'status' | 'listDays' | 'getDay' | 'askQuestion' | 'speak' | 'publish' | 'previewPublish' | 'forget'>;
type Day = DayLog | PublishedDay;
let api: Backend = realApi;

const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const cache = new Map<string, Day | null>();
let selected = '';
let dayList: string[] | null = null;
const CHIP_DAYS = 14;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** Shows a message under the day chips; confirmations (`brief`) clear themselves after a few seconds. */
function notice(msg: string, brief = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = msg; $('notice').classList.toggle('on', msg !== '');
  if (brief) noticeTimer = setTimeout(() => notice(''), 4000);
}
const days = async () => (dayList ??= await api.listDays());
async function load(date: string) {
  if (!cache.has(date)) {
    try { cache.set(date, await api.getDay(date)); } catch { notice(`Could not load ${date}. Reload to retry.`); return null; }
  }
  return cache.get(date) ?? null;
}

/** Days within the 7 days ending on `date` that have a log. */
async function weekOf(date: string): Promise<Day[]> {
  const from = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const inWeek = (await days()).filter(d => d <= date && d >= from);
  return (await Promise.all(inWeek.map(load))).filter((d): d is Day => d !== null);
}

function setDay(html: string) {
  const el = $('day');
  el.innerHTML = html;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
}

async function show(date: string) {
  selected = date;
  const day = await load(date);
  setDay(day ? dayHtml(day, { private: !demoMode() }) : emptyDayHtml(date));
  const list = (await days()).slice(0, CHIP_DAYS);
  $('days').innerHTML = dayChipsHtml(await Promise.all(list.map(async d => ({ date: d, decisions: (await load(d))?.decisions.length ?? 0 }))), selected);
  $('days').querySelector('[aria-current="date"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('side').innerHTML = sideHtml(day, await weekOf(date));
}

async function boot() {
  const demo = demoMode();
  document.body.classList.toggle('demo', demo);
  const mock = import.meta.env.DEV && new URLSearchParams(location.search).has('mock');
  if (mock) {
    api = (await import('./mock.js')).mockBackend(demo);
  } else if (!demo) {
    let cfg: Config;
    try {
      const res = await fetch('/config.json');
      if (!res.ok) throw new Error(String(res.status));
      cfg = await res.json() as Config;
    } catch { notice('Could not load the site configuration (/config.json). Try again in a moment.'); return; }
    let token: string | null;
    try { token = await signIn(cfg); } catch { notice('Sign-in failed. Reload to try again.'); return; }
    if (!token) { notice('Signing in…'); return; }
    setToken(token);
  }
  if (!demo) {
    try {
      const s = await api.status();
      const pill = $('sync');
      pill.textContent = syncLabel(s.syncedAt);
      if (s.syncedAt) pill.title = `Last sync ${new Date(s.syncedAt).toLocaleString()}`;
      pill.hidden = false;
    } catch { notice('Signed in, but the server did not answer. Reload to retry.'); return; }
  }
  const list = await days();
  if (list.length === 0) { setDay(emptyDayHtml(new Date().toISOString().slice(0, 10))); $('side').innerHTML = sideHtml(null, []); return; }
  await show(list[0]!);
}

const closeMenus = () => document.querySelectorAll('details.owner-menu[open]').forEach(d => d.removeAttribute('open'));

document.addEventListener('click', async ev => {
  const target = ev.target as HTMLElement;
  if (!target.closest('details.owner-menu')) closeMenus();
  const el = target.closest<HTMLElement>('[data-date],[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const action = el.dataset.action;
  if (action === 'publish') {
    closeMenus();
    // Preview first: the owner sees exactly what the judges will see, already filtered, then approves.
    const preview = await api.previewPublish(el.dataset.date!);
    if (!preview) { notice('Could not build the preview.'); return; }
    setDay(previewBarHtml(el.dataset.date!) + dayHtml(preview, { private: false }));
    $('day').focus({ preventScroll: true });
    return;
  }
  if (action === 'confirm-publish') {
    const ok = await api.publish(el.dataset.date!);
    await show(selected);
    if (ok) notice("Published to the judges' demo.", true); else notice('Publishing failed. Try again.');
    return;
  }
  if (action === 'cancel-preview') { await show(selected); return; }
  if (action === 'forget') {
    closeMenus();
    if (confirm('Forget this session and everything derived from it? This cannot be undone.')) {
      const ok = await api.forget(el.dataset.session!);
      cache.clear(); dayList = null; await show(selected);
      if (ok) notice('Session forgotten.', true); else notice('Could not forget the session. Try again.');
    }
    return;
  }
  if (el.dataset.date) {
    await show(el.dataset.date);
    if (el.closest('#answer-card, #results')) $('day').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
});

document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (document.querySelector('details.owner-menu[open]')) { closeMenus(); return; }
  if (!$('answer-card').hidden) closeAnswer();
});

const hit = (date: string, text: string) => `<button type="button" class="hit" data-date="${escapeHtml(date)}"><span>${escapeHtml(date.slice(5))}</span>${escapeHtml(text)}</button>`;

input('search').addEventListener('input', () => {
  const q = input('search').value.trim().toLowerCase();
  const hits = [...cache.values()].filter((d): d is Day => !!d).flatMap(d => d.decisions.filter(x => `${x.what} ${x.why} ${x.quote}`.toLowerCase().includes(q)).map(x => ({ date: d.date, what: x.what })));
  $('results').innerHTML = q ? (hits.map(h => hit(h.date, h.what)).join('') || '<p class="side-empty">No decisions match that.</p>') : '';
});

let audio: HTMLAudioElement | null = null;
const speaking = (on: boolean) => { $('speaking').hidden = !on; $('ask-form').classList.toggle('is-speaking', on); };
function stopAudio() { audio?.pause(); audio = null; speaking(false); }
function closeAnswer() { stopAudio(); $('answer-card').hidden = true; $('answer').innerHTML = ''; }

async function answer(question: string) {
  stopAudio();
  const card = $('answer-card');
  card.hidden = false; card.classList.add('loading');
  $('answer').innerHTML = '<p class="answer-text thinking">Looking through your decisions…</p>';
  let out: Awaited<ReturnType<Backend['askQuestion']>>;
  try { out = await api.askQuestion(question); } catch { $('answer').innerHTML = '<p class="answer-text">Could not get an answer right now. Try asking again.</p>'; card.classList.remove('loading'); return; }
  card.classList.remove('loading');
  $('answer').innerHTML = answerHtml(out);
  const blob = await api.speak(out.answer).catch(() => null);
  if (!blob || $('answer-card').hidden) return;
  const url = URL.createObjectURL(blob); const a = new Audio(url); audio = a;
  const done = () => { URL.revokeObjectURL(url); if (audio === a) speaking(false); };
  a.addEventListener('playing', () => { if (audio === a) speaking(true); });
  a.addEventListener('ended', done); a.addEventListener('error', done); a.addEventListener('pause', done);
  void a.play().catch(done);
}

$('ask-form').addEventListener('submit', ev => { ev.preventDefault(); const q = input('question').value.trim(); if (q) void answer(q); });
$('stop').addEventListener('click', stopAudio);
$('close-answer').addEventListener('click', closeAnswer);

type Rec = { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: (() => void) | null; start(): void };
const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
$('mic').addEventListener('click', () => {
  if (!Recognition) { input('question').focus(); notice('Voice input is not available in this browser. Type your question instead.'); return; }
  const mic = $('mic');
  const r = new Recognition();
  r.lang = 'en-US';
  r.onresult = e => { const q = e.results[0]![0].transcript; input('question').value = q; void answer(q); };
  r.onend = () => { mic.classList.remove('listening'); mic.setAttribute('aria-pressed', 'false'); };
  mic.classList.add('listening'); mic.setAttribute('aria-pressed', 'true');
  r.start();
});

void boot().catch(() => notice('Something went wrong loading the log. Reload to retry.'));
