import { describe, expect, it } from 'vitest';
import { hideNames, redact } from '../src/redact.js';
import type { ConverseFn } from '../src/nova.js';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

describe('redact', () => {
  it.each([
    ['write to ana.ruiz@example.com today', 'write to [redacted] today'],
    ['call me at +52 81 1234 5678', 'call me at [redacted]'],
    ['card 4111 1111 1111 1111 ok', 'card [redacted] ok'],
    ['see https://x.io/a?token=abc123', 'see [redacted]'],
    ['https://user:pass@host.com/x', '[redacted]']
  ])('hides %s', (input, expected) => { expect(redact(input)).toBe(expected); });
  it('leaves normal text and order numbers alone', () => {
    expect(redact('Ship order 47 on Friday for $110.00')).toBe('Ship order 47 on Friday for $110.00');
  });
  it.each([
    'Decided on 2026-10-03',
    'Meet at 19:30',
    'Upgrade to v1.2.3 soon',
    'Runs on Node 24.19',
    'Total $110.00',
    'order 47',
    'Deadline 2026-10-23T18:00:00.000Z'
  ])('keeps ordinary content: %s', input => { expect(redact(input)).toBe(input); });
});

describe('hideNames', () => {
  const reply = (texts: unknown): ConverseFn => async () => ({ role: 'assistant', content: [{ toolUse: { toolUseId: 't', name: 'save_texts', input: { texts } as never } }] }) as Message;
  it('returns the model texts', async () => {
    expect(await hideNames(['Ana called'], reply(['a colleague called']))).toEqual(['a colleague called']);
  });
  it('still redacts what the model returns', async () => {
    expect(await hideNames(['Ana called'], reply(['a colleague (ana@example.com) called']))).toEqual(['a colleague ([redacted]) called']);
  });
  it('fails closed when the reply has the wrong length or the call fails twice', async () => {
    await expect(hideNames(['a', 'b'], reply(['x', 'y', 'z']))).rejects.toThrow('name review failed');
    await expect(hideNames(['a'], async () => { throw new Error('boom'); })).rejects.toThrow('name review failed');
  });
  it('reviews a failed batch one text at a time', async () => {
    let calls = 0;
    const merged: ConverseFn = async i => (++calls === 1 ? reply(['Ana and Luis, merged']) : reply([`role ${calls}`]))(i);
    expect(await hideNames(['Ana', 'Luis'], merged)).toEqual(['role 2', 'role 3']);
  });
  it('retries a single text once', async () => {
    let calls = 0;
    const flaky: ConverseFn = async i => (++calls <= 2 ? reply(['x', 'y']) : reply(['a colleague']))(i);
    expect(await hideNames(['Ana'], flaky)).toEqual(['a colleague']);
  });
  it('reviews long days in small batches, in order', async () => {
    const sizes: number[] = [];
    const echo: ConverseFn = async i => { const t = (JSON.parse((i.messages[0]!.content![0] as { text: string }).text) as { texts: string[] }).texts; sizes.push(t.length); return reply(t.map(x => x.toUpperCase()))(i); };
    const texts = Array.from({ length: 20 }, (_, n) => `t${n}`);
    expect(await hideNames(texts, echo)).toEqual(texts.map(t => t.toUpperCase()));
    expect(sizes).toEqual([8, 8, 4]);
  });
  it('skips the model for an empty list', async () => {
    expect(await hideNames([], async () => { throw new Error('no'); })).toEqual([]);
  });
});
