import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Writes to the owner's Bee todo list. Both calls throw when Bee cannot be reached; callers retry on the next run. */
export interface BeeTodos {
  /** Creates a todo and returns its Bee id. */
  create(text: string, alarmAt?: string): Promise<string>;
  complete(id: string): Promise<void>;
  /** The newest todos (id and text), to find one whose creation may have succeeded before a crash. */
  list(): Promise<{ id: string; text: string }[]>;
}

/** A Bee CLI failure reduced to what is safe to log: never the command line (it holds todo text) or the CLI's output. */
export class BeeCliError extends Error {
  constructor(readonly notFound: boolean, readonly code: string) { super(`bee cli failed (${notFound ? 'not found' : code})`); this.name = 'BeeCliError'; }
}
const describe = (err: unknown): BeeCliError => {
  if (err instanceof BeeCliError) return err;
  const e = err as { code?: unknown; stderr?: unknown; name?: string };
  const out = `${typeof e.stderr === 'string' ? e.stderr : ''}`;
  // Only Bee's own answer about the todo counts; a missing or broken binary ("command not found") is an ordinary failure.
  const shell = /command not found|is not recognized|ENOENT|cannot find/i.test(out);
  const beeSaysMissing = /\b404\b|\btodo\b[^\n]*\bnot found\b|\bnot found\b[^\n]*\btodo\b|\btodo\b[^\n]*\bdoes not exist\b/i.test(out);
  return new BeeCliError(!shell && beeSaysMissing, String(e.code ?? e.name ?? 'error'));
};
/** Error class and exit code only. */
export const errorInfo = (err: unknown): { error: string; code: string; notFound: boolean } => {
  const d = describe(err);
  return { error: d.name, code: d.code, notFound: d.notFound };
};

const exec = promisify(execFile);
const SAFE_ID = /^\w[\w-]*$/;
const MAX_TODO_CHARS = 120;

/** The id in the reply of `bee todos create --json` ({ todo: { id } }, { id } or a bare number/string). */
export function parseTodoId(json: unknown): string {
  const j = json as { todo?: { id?: unknown }; id?: unknown } | string | number | null;
  const raw = j !== null && typeof j === 'object' ? (j.todo?.id ?? j.id) : j;
  const id = raw === undefined || raw === null ? '' : String(raw);
  if (!SAFE_ID.test(id)) throw new Error('Bee todo reply without an id');
  return id;
}

export class CliBeeTodos implements BeeTodos {
  constructor(private run: (args: string[]) => Promise<string> =
    // bee is a .cmd shim on Windows, which needs a shell there. Arguments reach cmd.exe, so the todo text is
    // validated and quoted in `shellSafe`; ids are validated against SAFE_ID.
    async args => (await exec('bee', args, { maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true })).stdout) {}

  async create(text: string, alarmAt?: string) {
    if (text.length === 0 || text.length > MAX_TODO_CHARS) throw new Error('Invalid Bee todo text');
    const args = ['todos', 'create', '--text', shellSafe(text)];
    if (alarmAt) {
      if (Number.isNaN(Date.parse(alarmAt))) throw new Error('Invalid alarm time');
      args.push('--alarm-at', new Date(alarmAt).toISOString());
    }
    args.push('--json');
    return parseTodoId(JSON.parse(await this.call(args)));
  }

  async list() {
    const j = JSON.parse(await this.call(['todos', 'list', '--limit', '100', '--json'])) as { todos?: unknown[] } | unknown[];
    const items = (Array.isArray(j) ? j : (j.todos ?? [])) as { id?: unknown; text?: unknown }[];
    return items.filter(t => t.id !== undefined && typeof t.text === 'string').map(t => ({ id: String(t.id), text: t.text as string }));
  }

  private async call(args: string[]): Promise<string> {
    try { return await this.run(args); } catch (err) { throw describe(err); }
  }

  async complete(id: string) {
    if (!SAFE_ID.test(id)) throw new Error('Invalid Bee todo id');
    await this.call(['todos', 'complete', id, '--json']);
  }
}

/** The text as Bee will store it: only letters, digits and plain punctuation, arrows as "->". Used to recognise a todo created before a crash. */
export function plainText(text: string): string {
  return text.replace(/[^\p{L}\p{N} .,:;!?()'_\-/+=→]/gu, ' ').replace(/→/g, '->').replace(/\s+/g, ' ').trim();
}

/** Text that is safe as one argument both with and without a shell: wrapped in double quotes on Windows. */
export function shellSafe(text: string): string {
  const plain = plainText(text);
  return process.platform === 'win32' ? `"${plain}"` : plain;
}
