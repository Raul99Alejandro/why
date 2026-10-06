// Runs every example in domain/rules/*.yaml. Deterministic rules go through their adapter:
// approved examples must hold; rejected ones must NOT hold; proposed ones are skipped.
// Judged rules (W-02, W-03) run the real prompt and validation code against a fake model that answers from the examples in the prompt.
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, it, expect } from 'vitest';
import { adapters } from './adapters/index.js';

const dir = new URL('../domain/rules/', import.meta.url);
const rules = readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => parse(readFileSync(new URL(f, dir), 'utf8')));

for (const rule of rules) {
  describe(`${rule.id}: ${rule.rule}`, () => {
    const adapter = adapters[rule.id];
    it('has an adapter', () => expect(adapter, `write test/adapters for ${rule.id}`).toBeTypeOf('function'));
    if (!adapter) return;
    for (const ex of rule.examples) {
      if (ex.status === 'proposed') { it.skip(`${ex.id} (proposed)`, () => {}); continue; }
      it(`${ex.id} (${ex.status})`, async () => {
        const actual = await adapter(ex.given, ex.when);
        if (ex.status === 'approved') expect(actual).toMatchObject(ex.then);
        else expect(() => expect(actual).toMatchObject(ex.then)).toThrow();
      });
    }
  });
}
