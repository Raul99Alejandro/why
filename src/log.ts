/** One JSON line per event. Never pass conversation text here: ids, counts and timings only. */
export function log(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}
