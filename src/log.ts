/** One JSON line per event. Never pass conversation text here: ids, counts and timings only. WHY_LOG_STDERR=1 (set by the MCP CLI) moves it to stderr. */
export function log(entry: Record<string, unknown>): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  (process.env.WHY_LOG_STDERR === '1' ? process.stderr : process.stdout).write(line);
}
