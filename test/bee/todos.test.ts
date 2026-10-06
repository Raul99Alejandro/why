import { describe, expect, it } from 'vitest';
import { CliBeeTodos, errorInfo, parseTodoId, shellSafe } from '../../src/bee/todos.js';

describe('Bee todos CLI', () => {
  it('creates with --text, --alarm-at and --json, and reads the id', async () => {
    const calls: string[][] = [];
    const todos = new CliBeeTodos(async args => { calls.push(args); return JSON.stringify({ todo: { id: 4242 } }); });
    expect(await todos.create('Record the demo', '2026-10-06T18:10:00.000Z')).toBe('4242');
    expect(calls[0]).toEqual(['todos', 'create', '--text', shellSafe('Record the demo'), '--alarm-at', '2026-10-06T18:10:00.000Z', '--json']);
  });
  it('completes by id with --json', async () => {
    const calls: string[][] = [];
    await new CliBeeTodos(async args => { calls.push(args); return '{}'; }).complete('4242');
    expect(calls[0]).toEqual(['todos', 'complete', '4242', '--json']);
  });
  it('refuses unsafe ids, empty or long text, and replies without an id', async () => {
    const todos = new CliBeeTodos(async () => '{}');
    await expect(todos.complete('1; calc')).rejects.toThrow();
    await expect(todos.create('')).rejects.toThrow();
    await expect(todos.create('x'.repeat(121))).rejects.toThrow();
    await expect(todos.create('ok')).rejects.toThrow('without an id');
    expect(parseTodoId({ id: 'abc-1' })).toBe('abc-1');
    expect(parseTodoId(7)).toBe('7');
  });
  it('strips shell metacharacters from the text', () => {
    const inner = shellSafe('a & b | c > d "e" %PATH% `x` $(y)').replace(/^"|"$/g, '');
    expect(inner).not.toMatch(/[&|><"%`$]/);
    expect(shellSafe('Old → new')).toContain('->');
  });
  it('treats only Bee own not-found answers as not found', () => {
    expect(errorInfo({ stderr: 'Error: todo not found' }).notFound).toBe(true);
    expect(errorInfo({ stderr: 'request failed: HTTP 404' }).notFound).toBe(true);
    expect(errorInfo({ stderr: 'bee: command not found' }).notFound).toBe(false);
    expect(errorInfo({ stderr: "'bee' is not recognized as an internal or external command" }).notFound).toBe(false);
    expect(errorInfo({ code: 'ENOENT' }).notFound).toBe(false);
    expect(errorInfo({ stderr: 'todo service unavailable' }).notFound).toBe(false);
  });
});
