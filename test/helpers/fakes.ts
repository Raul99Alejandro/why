import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { BeeCliError, plainText, type BeeTodos } from '../../src/bee/todos.js';
import type { ConverseFn } from '../../src/nova.js';

export const toolReply = (name: string, input: unknown): Message => ({ role: 'assistant', content: [{ toolUse: { toolUseId: 't', name, input: input as never } }] });

/** A fake model: the handler sees which tool was forced plus the system and user text, and returns the tool input (or throws). */
export const fakeModel = (handler: (tool: string, system: string, user: string) => unknown): ConverseFn => async input => {
  const tool = input.toolConfig.tools![0]!.toolSpec!.name!;
  return toolReply(tool, handler(tool, input.system.map(s => s.text ?? '').join(' '), input.messages.map(m => m.content?.map(c => c.text ?? '').join(' ')).join('\n')));
};

/** In-memory Bee todo list; `offline` makes every call fail like a signed-out CLI. */
export class FakeTodos implements BeeTodos {
  created: { id: string; text: string; alarmAt?: string }[] = [];
  completed: string[] = [];
  offline = false;
  listFails = false;
  /** Texts whose creation always fails (a poison pill), and ids Bee reports as missing. */
  failTexts = new Set<string>();
  missing = new Set<string>();
  beforeCreate?: () => Promise<void>;
  calls = 0;
  async create(text: string, alarmAt?: string) {
    this.calls++;
    if (this.offline || this.failTexts.has(text)) throw new BeeCliError(false, '1');
    await this.beforeCreate?.();
    const id = `t${this.created.length + 1}`;
    this.created.push({ id, text, ...(alarmAt ? { alarmAt } : {}) });
    return id;
  }
  async complete(id: string) {
    this.calls++;
    if (this.offline) throw new BeeCliError(false, '1');
    if (this.missing.has(id)) throw new BeeCliError(true, '1');
    this.completed.push(id);
  }
  async list() {
    if (this.offline || this.listFails) throw new BeeCliError(false, '1');
    return this.created.map(t => ({ id: t.id, text: plainText(t.text) }));
  }
}
