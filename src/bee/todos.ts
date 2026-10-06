import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Writes to the owner's Bee todo list. Both calls throw when Bee cannot be reached; callers retry on the next run. */
export interface BeeTodos {
  /** Creates a todo and returns its Bee id. */
  create(text: string, alarmAt?: string): Promise<string>;
  complete(id: string): Promise<void>;
}

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
    return parseTodoId(JSON.parse(await this.run(args)));
  }

  async complete(id: string) {
    if (!SAFE_ID.test(id)) throw new Error('Invalid Bee todo id');
    await this.run(['todos', 'complete', id, '--json']);
  }
}

/** Text that is safe as one argument both with and without a shell: only letters, digits and plain punctuation; wrapped in double quotes on Windows. */
export function shellSafe(text: string): string {
  const plain = text.replace(/[^\p{L}\p{N} .,:;!?()'_\-/+=→]/gu, ' ').replace(/→/g, '->').replace(/\s+/g, ' ').trim();
  return process.platform === 'win32' ? `"${plain}"` : plain;
}
