import { askQuestion, demoMode, forget, getDay, listDays, previewPublish, publish, setToken, speak, status } from './api.js';
import { signIn, type Config } from './auth.js';
import { dayHtml, emptyDayHtml, escapeHtml, stripHtml, weekHtml } from './render.js';
import type { DayLog, PublishedDay } from '../src/domain/types.js';
import './styles.css';

const $ = (id: string) => document.getElementById(id)!;
const cache = new Map<string, DayLog | PublishedDay | null>();
let selected = '';
let dayList: string[] | null = null;

const notice = (msg: string) => { $('notice').textContent = msg; $('notice').classList.toggle('on', msg !== ''); };
const days = async () => (dayList ??= await listDays());
async function load(date: string) {
  if (!cache.has(date)) {
    try { cache.set(date, await getDay(date)); } catch { notice(`Could not load ${date}. Reload to retry.`); return null; }
  }
  return cache.get(date) ?? null;
}

async function show(date: string) {
  selected = date;
  const day = await load(date);
  $('day').innerHTML = day ? dayHtml(day, { private: !demoMode() }) : emptyDayHtml(date);
  $('strip').innerHTML = stripHtml(await Promise.all((await days()).slice(0, 21).map(async d => ({ date: d, decisions: (await load(d))?.decisions.length ?? 0 }))), selected);
}

async function boot() {
  document.body.classList.toggle('demo', demoMode());
  if (!demoMode()) {
    let cfg: Config;
    try {
      const res = await fetch('/config.json');
      if (!res.ok) throw new Error(String(res.status));
      cfg = await res.json() as Config;
    } catch { notice('Could not load the site configuration (/config.json). Try again in a moment.'); return; }
    let token: string | null;
    try { token = await signIn(cfg); } catch { notice('Sign-in failed — reload to try again.'); return; }
    if (!token) { notice('Signing in…'); return; }
    setToken(token);
    try {
      const s = await status();
      $('sync').textContent = s.syncedAt ? `Last sync ${new Date(s.syncedAt).toLocaleString()}` : 'Not synced yet';
    } catch { notice('Signed in, but the server did not answer. Reload to retry.'); return; }
  }
  const list = await days();
  if (list.length === 0) { $('day').innerHTML = emptyDayHtml(new Date().toISOString().slice(0, 10)); return; }
  await show(list[0]!);
  const week = (await Promise.all(list.slice(0, 7).map(load))).filter((d): d is DayLog | PublishedDay => d !== null);
  $('week').innerHTML = weekHtml(week);
}

document.addEventListener('click', async e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-date],[data-action]');
  if (!el) return;
  if (el.dataset.action === 'publish') {
    // Preview first: the owner sees exactly what the judges will see, already filtered, then approves.
    const preview = await previewPublish(el.dataset.date!);
    if (!preview) { notice('Could not build the preview.'); return; }
    $('day').innerHTML = `<p class="banner">Preview of what the judges will see</p>${dayHtml(preview, { private: false })}`;
    const ok = confirm("Publish this preview to the judges' demo?") ? await publish(el.dataset.date!) : true;
    await show(selected);
    if (!ok) notice('Publishing failed. Try again.');
    return;
  }
  if (el.dataset.action === 'forget') {
    if (confirm('Forget this session and everything derived from it?')) { await forget(el.dataset.session!); cache.clear(); dayList = null; await show(selected); }
    return;
  }
  if (el.dataset.date) await show(el.dataset.date);
});

const hit = (date: string, text: string) => `<button data-date="${escapeHtml(date)}">${escapeHtml(date)} · ${escapeHtml(text)}</button>`;

$('search').addEventListener('input', () => {
  const q = ($('search') as HTMLInputElement).value.toLowerCase();
  const hits = [...cache.values()].filter((d): d is DayLog | PublishedDay => !!d).flatMap(d => d.decisions.filter(x => `${x.what} ${x.why} ${x.quote}`.toLowerCase().includes(q)).map(x => ({ date: d.date, what: x.what })));
  $('results').innerHTML = q ? (hits.map(h => hit(h.date, h.what)).join('') || '<p class="empty">No matches.</p>') : '';
});

async function answer(question: string) {
  $('answer').textContent = 'Thinking…';
  $('citations').innerHTML = '';
  let out: Awaited<ReturnType<typeof askQuestion>>;
  try { out = await askQuestion(question); } catch { $('answer').textContent = 'Sorry, I could not answer that right now.'; return; }
  $('answer').textContent = out.answer;
  $('citations').innerHTML = out.citations.map(c => hit(c.date, c.decision)).join('');
  const audio = await speak(out.answer).catch(() => null);
  if (audio) {
    const url = URL.createObjectURL(audio); const a = new Audio(url);
    const done = () => URL.revokeObjectURL(url);
    a.addEventListener('ended', done); a.addEventListener('error', done);
    void a.play().catch(done);
  }
}

$('ask-form').addEventListener('submit', e => { e.preventDefault(); const q = ($('question') as HTMLInputElement).value.trim(); if (q) void answer(q); });

type Rec = { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; start(): void };
const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
$('mic').addEventListener('click', () => {
  if (!Recognition) { ($('question') as HTMLInputElement).focus(); return; }
  const r = new Recognition();
  r.lang = 'en-US';
  r.onresult = e => { const q = e.results[0]![0].transcript; ($('question') as HTMLInputElement).value = q; void answer(q); };
  r.start();
});

void boot().catch(() => notice('Something went wrong loading the log. Reload to retry.'));
