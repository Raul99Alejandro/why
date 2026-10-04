import { describe, expect, it } from 'vitest';
import { analysisSchema, ANALYSIS_TOOL_SCHEMA } from '../../src/domain/schemas.js';

const good = {
  topic: 'Demo video', summary: 'Re-recorded the shop take.',
  decisions: [{ what: 'Use Polly for the mechanic', why: 'ElevenLabs ran out of credits', quote: 'We use Polly now.', quoteOriginal: 'Ahora usamos Polly.', at: '2026-10-03T18:00:00.000Z' }],
  todos: ['Delete the old video'], openQuestions: []
};

describe('analysis schema', () => {
  it('accepts a complete analysis', () => { expect(analysisSchema.safeParse(good).success).toBe(true); });
  it('rejects a decision without a reason', () => {
    const bad = { ...good, decisions: [{ ...good.decisions[0], why: '' }] };
    expect(analysisSchema.safeParse(bad).success).toBe(false);
  });
  it('exposes a JSON schema for the tool without $schema', () => {
    expect(ANALYSIS_TOOL_SCHEMA.$schema).toBeUndefined();
    expect(ANALYSIS_TOOL_SCHEMA.type).toBe('object');
  });
});
