import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const files = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('security guarantees', () => {
  it('never logs conversation text: log() calls pass ids, counts and timings only', () => {
    let found = 0;
    for (const f of files('src').filter(f => f.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8');
      for (const call of src.match(/log\(\{[^}]*\}\)/g) ?? []) {
        found++;
        expect(call, f).not.toMatch(/\b(text|utterances|quote|transcript|summary|answer)\b/);
      }
    }
    expect(found).toBeGreaterThan(0); // the scan must actually see the existing calls
  });
  it('keeps real data out of the repository', () => {
    const ignore = readFileSync('.gitignore', 'utf8');
    for (const p of ['data/', '*.local.json', '.env']) expect(ignore).toContain(p);
  });
  it('documents every threat with its control and test', () => {
    const doc = readFileSync('docs/security.md', 'utf8');
    for (const heading of ['Threat model', 'Access', 'Secrets', 'Encryption', 'Least privilege', 'Data minimization', 'Personal data', 'Prompt injection', 'Logging', 'Demo isolation']) expect(doc).toContain(heading);
  });
});
