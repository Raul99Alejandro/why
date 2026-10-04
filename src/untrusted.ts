/**
 * Prompt-injection hardening for text we put inside a tagged data block (<transcript>, <question>).
 * Any opening or closing wrapper tag in the untrusted text, in any case or spacing, is turned into a
 * harmless look-alike, so the text cannot close the block early and pose as instructions.
 */
export function neutralizeTags(text: string): string {
  return text.replace(/<(\/?\s*)(transcript|question)/gi, '‹$1$2');
}
