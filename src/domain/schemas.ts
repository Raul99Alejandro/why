import * as z from 'zod/v4';

const text = z.string().trim().min(1);

export const decisionSchema = z.object({
  what: text.describe('A real decision: a choice between options or a commitment to a course of action, as one short English sentence. Never a status update or finished work.'),
  why: text.describe('The reason actually given, in English. If none was said, exactly "No reason given". Never a generic label.'),
  quote: text.describe('The sentence from the conversation that shows the decision, translated to English.'),
  quoteOriginal: text.describe('The same sentence in the original language, exactly as transcribed.'),
  at: z.string().describe('ISO time of that sentence, or of the session start if unknown.')
});

export const analysisSchema = z.object({
  topic: text.describe('What the session was about, in at most six English words.'),
  summary: text.describe('One or two English sentences. Status updates and finished work go here, not in decisions.'),
  decisions: z.array(decisionSchema).max(12).describe('Only real decisions; empty array if there were none.'),
  todos: z.array(text).max(20).describe('Things someone committed to do, in English.'),
  openQuestions: z.array(text).max(10).describe('Questions raised and not resolved, in English.')
});

export const ANALYSIS_TOOL_SCHEMA: Record<string, unknown> = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(analysisSchema, { io: 'input' }) as Record<string, unknown>;
  return schema;
})();
