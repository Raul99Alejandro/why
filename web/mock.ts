// Invented data for local design review only (`npm run web:dev`, then open /?mock or /?mock&demo).
// Nothing here comes from a real recording: "Trailhead" is a made-up hiking-route app.
// main.ts loads this file through a dynamic import guarded by import.meta.env.DEV, so production builds never include it.
import type { CommitRef, DayLog, PublishedDay } from '../src/domain/types.js';

const REPO = 'example/trailhead';
const c = (sha: string, message: string, at: string): CommitRef => ({ repo: REPO, sha, message, url: `https://github.com/${REPO}/commit/${sha}`, at });
const at = (date: string, hhmm: string) => `${date}T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`; // Mexico City is UTC-6

const D1 = '2026-10-03', D2 = '2026-10-02', D3 = '2026-10-01', D4 = '2026-09-30';

const days: Record<string, DayLog> = {
  [D1]: {
    date: D1, summary: 'Moved offline maps to vector tiles and settled how route sharing works before the beta.',
    sessions: [
      { id: 'm-s1', startedAt: at(D1, '09:10'), endedAt: at(D1, '10:05'), topic: 'Offline maps' },
      { id: 'm-s2', startedAt: at(D1, '12:30'), endedAt: at(D1, '13:15'), topic: 'Route sharing' },
      { id: 'm-s3', startedAt: at(D1, '17:00'), endedAt: at(D1, '17:25'), topic: 'Beta checklist' }
    ],
    decisions: [
      { what: 'Ship offline maps as vector tiles instead of raster images', why: 'A whole national park fits in 40 MB instead of 600 MB, so people can actually download it on mobile data.',
        quote: "Raster is never going to fit on a phone, let's go vector.", quoteOriginal: 'El raster nunca va a caber en un teléfono, vámonos a vector.', at: at(D1, '09:32'), sessionId: 'm-s1', commits: ['a1c9e02', 'b7f3d11', 'c02aa9f', 'd55e810'] },
      { what: 'Keep downloaded regions for 30 days, then ask before deleting', why: 'Silent cleanup lost a tester their map halfway up a trail; asking costs one notification.',
        quote: 'Never delete a map without asking, people are on a mountain.', quoteOriginal: 'Nunca borres un mapa sin preguntar, la gente está en una montaña.', at: at(D1, '09:51'), sessionId: 'm-s1', commits: ['e9012bc'] },
      { what: 'Share routes as links that open read-only', why: 'Editing shared routes needs accounts and conflict handling, which would push the beta past the deadline.',
        quote: 'Read-only links for now, editing can wait for version two.', quoteOriginal: 'Por ahora ligas de solo lectura, editar puede esperar a la versión dos.', at: at(D1, '12:48'), sessionId: 'm-s2', commits: ['f4410aa', '0b3c7d2'] },
      { what: 'Cut the elevation chart from the beta', why: 'It is the slowest screen on older phones and nobody in the test group opened it more than once.',
        quote: 'Nobody uses the elevation chart, cut it for the beta.', quoteOriginal: 'Nadie usa la gráfica de elevación, quítala para la beta.', at: at(D1, '17:12'), sessionId: 'm-s3', commits: [] }
    ],
    todos: [
      { text: 'Measure tile download time on a 3G profile', sessionId: 'm-s1' },
      { text: 'Write the 30-day expiry notification copy', sessionId: 'm-s1' },
      { text: 'Add a "copy link" button to the route screen', sessionId: 'm-s2' }
    ],
    openQuestions: [
      { text: 'Do shared links need an expiry date?', sessionId: 'm-s2' },
      { text: 'Should the beta include the dark map style?', sessionId: 'm-s3' }
    ],
    commits: [
      c('a1c9e02', 'feat(maps): vector tile renderer behind a flag', at(D1, '10:40')),
      c('b7f3d11', 'feat(maps): download regions as vector packs', at(D1, '11:05')),
      c('c02aa9f', 'perf(maps): cache decoded tiles per zoom level', at(D1, '11:20')),
      c('d55e810', 'chore(maps): remove raster tile pipeline', at(D1, '11:58')),
      c('e9012bc', 'feat(storage): ask before deleting expired regions', at(D1, '14:02')),
      c('f4410aa', 'feat(share): read-only route links', at(D1, '14:30')),
      c('0b3c7d2', 'test(share): link opens without an account', at(D1, '14:44')),
      c('1d2e3f4', 'fix(ui): route list jumps when a row expands', at(D1, '15:10')),
      c('2a3b4c5', 'docs: beta release notes draft', at(D1, '15:35')),
      c('3c4d5e6', 'chore(deps): bump map style package', at(D1, '16:02')),
      c('4e5f6a7', 'refactor(api): split route serializer', at(D1, '16:20')),
      c('5f6a7b8', 'chore(beta): hide elevation chart', at(D1, '17:40'))
    ],
    updatedAt: at(D1, '18:00')
  },
  [D3]: {
    date: D3, summary: 'Chose the beta audience and agreed on how crash reports leave the phone.',
    sessions: [
      { id: 'm-s4', startedAt: at(D3, '10:00'), endedAt: at(D3, '10:40'), topic: 'Beta audience' },
      { id: 'm-s5', startedAt: at(D3, '15:20'), endedAt: at(D3, '15:50'), topic: 'Crash reports' }
    ],
    decisions: [
      { what: 'Start the beta with two local hiking clubs', why: 'They hike every weekend and will report problems from real trails, not from a desk.',
        quote: 'Clubs first, they are out every Saturday.', quoteOriginal: 'Primero los clubes, salen cada sábado.', at: at(D3, '10:18'), sessionId: 'm-s4', commits: [] },
      { what: 'Send crash reports only on Wi-Fi', why: 'Testers on limited plans complained about background data; a few hours of delay does not matter for a beta.',
        quote: 'Wait for Wi-Fi, nobody wants us eating their data.', quoteOriginal: 'Espera al Wi-Fi, nadie quiere que nos comamos sus datos.', at: at(D3, '15:31'), sessionId: 'm-s5', commits: ['6a7b8c9'] },
      { what: 'Strip GPS traces from crash reports', why: 'A crash report does not need where someone was, and keeping it would mean a privacy review.',
        quote: 'No locations in crash reports, ever.', quoteOriginal: 'Nada de ubicaciones en los reportes, nunca.', at: at(D3, '15:44'), sessionId: 'm-s5', commits: ['7b8c9d0'] }
    ],
    todos: [{ text: 'Email both club organizers with the invite link', sessionId: 'm-s4' }],
    openQuestions: [],
    commits: [
      c('6a7b8c9', 'feat(crash): queue reports until Wi-Fi', at(D3, '16:30')),
      c('7b8c9d0', 'fix(crash): drop location fields before upload', at(D3, '17:05'))
    ],
    updatedAt: at(D3, '18:00')
  },
  [D4]: {
    date: D4, summary: 'Picked the map provider and a naming rule for saved routes.',
    sessions: [{ id: 'm-s6', startedAt: at(D4, '11:00'), endedAt: at(D4, '11:45'), topic: 'Map provider' }],
    decisions: [
      { what: 'Use an open map data provider for the beta', why: 'The commercial plan charges per tile and the bill would grow with every downloaded park.',
        quote: 'Open data, we cannot pay per tile.', quoteOriginal: 'Datos abiertos, no podemos pagar por mosaico.', at: at(D4, '11:20'), sessionId: 'm-s6', commits: ['8c9d0e1'] },
      { what: 'Name saved routes after their start and end points', why: '"Route 14" meant nothing to testers; place names are what they search for.',
        quote: 'Call them by where they start and end.', quoteOriginal: 'Llámalas por donde empiezan y terminan.', at: at(D4, '11:38'), sessionId: 'm-s6', commits: [] }
    ],
    todos: [],
    openQuestions: [{ text: 'What attribution text does the map license require?', sessionId: 'm-s6' }],
    commits: [c('8c9d0e1', 'feat(maps): switch tile source to open data', at(D4, '13:10'))],
    updatedAt: at(D4, '18:00')
  }
};

const toPublic = (d: DayLog): PublishedDay => ({ ...d, decisions: d.decisions.map(({ quoteOriginal: _x, ...x }) => x), publishedAt: d.updatedAt });
const wait = <T>(v: T, ms = 120) => new Promise<T>(r => setTimeout(() => r(v), ms));

/** A few seconds of silence as a WAV, so the "speaking" state can be reviewed without a speech service. */
function silence(seconds = 3): Blob {
  const rate = 8000, n = rate * seconds, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: 'audio/wav' });
}

export function mockBackend(demo: boolean) {
  return {
    status: () => wait({ syncedAt: new Date(Date.now() - 42 * 60_000).toISOString() }),
    listDays: () => wait([D1, D2, D3, D4]),
    getDay: (date: string) => wait<DayLog | PublishedDay | null>(days[date] ? (demo ? toPublic(days[date]) : days[date]) : null),
    askQuestion: (question: string) => wait({
      answer: /share|link/i.test(question)
        ? 'Shared routes open as read-only links. Editing would need accounts and conflict handling, which would have pushed the beta past its deadline.'
        : 'You moved offline maps to vector tiles because a whole park fits in about 40 MB instead of 600 MB, small enough to download on mobile data.',
      citations: [{ date: D1, decision: 'Ship offline maps as vector tiles instead of raster images' }, { date: D1, decision: 'Share routes as links that open read-only' }]
    }, 700),
    speak: (_text: string) => wait<Blob | null>(silence()),
    previewPublish: (date: string) => wait<PublishedDay | null>(days[date] ? toPublic(days[date]) : null),
    publish: (_date: string) => wait(true),
    forget: (_sessionId: string) => wait(true)
  };
}
