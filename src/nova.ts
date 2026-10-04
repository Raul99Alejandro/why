import { ConverseCommand, type BedrockRuntimeClient, type Message, type SystemContentBlock, type ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';

export type ConverseFn = (input: { system: SystemContentBlock[]; messages: Message[]; toolConfig: ToolConfiguration }) => Promise<Message>;

export function bedrockConverse(client: BedrockRuntimeClient, modelId: string, maxTokens = 3000): ConverseFn {
  return async input => {
    const out = await client.send(new ConverseCommand({ modelId, ...input, inferenceConfig: { maxTokens, temperature: 0 } }));
    if (!out.output?.message) throw new Error('empty reply from the model');
    return out.output.message;
  };
}

/** One model call that must answer through the named tool. Returns the tool input, or null if it did not. */
export async function forcedTool(converse: ConverseFn, opts: { system: string; user: string; name: string; description: string; schema: Record<string, unknown> }): Promise<unknown> {
  const reply = await converse({
    system: [{ text: opts.system }],
    messages: [{ role: 'user', content: [{ text: opts.user }] }],
    toolConfig: { tools: [{ toolSpec: { name: opts.name, description: opts.description, inputSchema: { json: opts.schema as never } } }], toolChoice: { tool: { name: opts.name } } }
  });
  return reply.content?.find(b => b.toolUse?.name === opts.name)?.toolUse?.input ?? null;
}
