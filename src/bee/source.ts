import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Utterance } from '../domain/types.js';

export type BeeConversation = { id: string; startedAt: string; endedAt: string | null; capturing: boolean; utterances: Utterance[] };
export interface BeeSource {
  /** Ids of conversations changed since the cursor, and the next cursor. */
  changedSince(cursor: string | null): Promise<{ ids: string[]; nextCursor: string }>;
  conversation(id: string): Promise<BeeConversation>;
}

type Rec = Record<string, unknown>;

const iso = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : new Date(typeof v === 'number' ? v : String(v)).toISOString();

/** Utterances live under transcriptions[].utterances (docs/bee-api.md); a flat `utterances` array is accepted too. */
function collectUtterances(c: Rec): Rec[] {
  const nested = Array.isArray(c.transcriptions)
    ? (c.transcriptions as Rec[]).flatMap(t => (Array.isArray(t.utterances) ? (t.utterances as Rec[]) : []))
    : [];
  const flat = Array.isArray(c.utterances) ? (c.utterances as Rec[]) : [];
  return [...nested, ...flat];
}

export function parseConversation(json: unknown): BeeConversation {
  const c = ((json as { conversation?: unknown }).conversation ?? json) as Rec;
  const startedAt = iso(c.start_time);
  if (!startedAt) throw new Error('Bee conversation without start_time');
  return {
    id: String(c.id),
    startedAt,
    endedAt: iso(c.end_time),
    capturing: String(c.state ?? '').toUpperCase() === 'CAPTURING',
    utterances: collectUtterances(c)
      .map((u): Utterance => {
        const at = iso(u.spoken_at ?? u.start_time ?? u.at);
        const base = { speaker: String(u.speaker ?? 'Unknown'), text: String(u.text ?? '') };
        return at ? { ...base, at } : base;
      })
      .filter(u => u.text.trim().length > 0)
  };
}

export function parseChanged(json: unknown): { ids: string[]; nextCursor: string } {
  const d = json as { conversations?: Array<{ id: unknown }>; meta?: { next_cursor?: string | null }; next_cursor?: string | null };
  return {
    ids: (d.conversations ?? []).map(c => String(c.id)),
    nextCursor: d.meta?.next_cursor ?? d.next_cursor ?? ''
  };
}

const exec = promisify(execFile);
const SAFE_ID = /^[\w-]+$/;
const SAFE_CURSOR = /^[\w.:=+-]+$/;

export class CliBeeSource implements BeeSource {
  constructor(private run: (args: string[]) => Promise<string> =
    // bee is a .cmd shim on Windows, which needs a shell; every arg is validated below.
    async args => (await exec('bee', args, { maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' })).stdout) {}
  async changedSince(cursor: string | null) {
    if (cursor !== null && !SAFE_CURSOR.test(cursor)) throw new Error('Invalid Bee cursor');
    return parseChanged(JSON.parse(await this.run(cursor ? ['changed', '--cursor', cursor, '--json'] : ['changed', '--json'])));
  }
  async conversation(id: string) {
    if (!SAFE_ID.test(id)) throw new Error('Invalid Bee conversation id');
    return parseConversation(JSON.parse(await this.run(['conversations', 'get', id, '--json'])));
  }
}
