import * as z from 'zod/v4';

const text = z.string().trim().min(1);

export const decisionSchema = z.object({
  what: text.describe('The decision, in English, as one short sentence.'),
  why: text.describe('Why it was decided, in English. Use the reason given in the conversation; never invent one.'),
  quote: text.describe('The sentence from the conversation that shows the decision, translated to English.'),
  quoteOriginal: text.describe('The same sentence in the original language, exactly as transcribed.'),
  at: z.string().describe('ISO time of that sentence, or of the session start if unknown.')
});

export const analysisSchema = z.object({
  topic: text.describe('What the session was about, in at most six English words.'),
  summary: text.describe('One or two English sentences.'),
  decisions: z.array(decisionSchema).max(12),
  todos: z.array(text).max(20).describe('Things someone committed to do, in English.'),
  openQuestions: z.array(text).max(10).describe('Questions raised and not resolved, in English.')
});

export const ANALYSIS_TOOL_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(analysisSchema, { io: 'input' }) as Record<string, unknown>;
  return schema;
})();
