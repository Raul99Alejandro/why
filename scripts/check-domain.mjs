// Fails if any domain file does not parse or misses required fields.
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';

const errors = [];
const g = parse(readFileSync('domain/glossary.yaml', 'utf8'));
if (!Array.isArray(g?.terms) || g.terms.length === 0) errors.push('glossary: no terms');
for (const f of readdirSync('domain/rules').filter(f => f.endsWith('.yaml'))) {
  const r = parse(readFileSync(`domain/rules/${f}`, 'utf8'));
  for (const k of ['id', 'rule', 'status', 'kind', 'source', 'examples']) if (r?.[k] == null) errors.push(`${f}: missing ${k}`);
  if (!['proposed', 'approved', 'rejected'].includes(r?.status)) errors.push(`${f}: bad status`);
  for (const ex of r?.examples ?? []) for (const k of ['id', 'status', 'given', 'when', 'then']) if (ex[k] == null) errors.push(`${f} ${ex.id ?? '?'}: missing ${k}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('domain ok');
