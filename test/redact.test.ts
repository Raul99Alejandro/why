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
  it('returns the input when the reply has the wrong length or the call fails', async () => {
    expect(await hideNames(['a', 'b'], reply(['x']))).toEqual(['a', 'b']);
    expect(await hideNames(['a'], async () => { throw new Error('boom'); })).toEqual(['a']);
  });
  it('skips the model for an empty list', async () => {
    expect(await hideNames([], async () => { throw new Error('no'); })).toEqual([]);
  });
});
