import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { BeeTodos } from '../../src/bee/todos.js';
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
  calls = 0;
  async create(text: string, alarmAt?: string) {
    this.calls++;
    if (this.offline) throw new Error('bee offline');
    const id = `t${this.created.length + 1}`;
    this.created.push({ id, text, ...(alarmAt ? { alarmAt } : {}) });
    return id;
  }
  async complete(id: string) {
    this.calls++;
    if (this.offline) throw new Error('bee offline');
    this.completed.push(id);
  }
}
