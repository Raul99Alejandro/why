/** Synthetic benchmark for checkChange: invented decisions and changes, no owner data. */
export type BenchCase = { decisions: { what: string; why: string }[]; change: string; expect: 'conflicts' | 'refines' | 'clear' };

const common = [
  { what: 'Write the backend in TypeScript on Node', why: 'one language for web and server' },
  { what: 'Release on Fridays only', why: 'the team reviews on Thursdays' }
];

export const BENCH_CASES: BenchCase[] = [
  // conflicts: the change makes the decision impossible to keep
  { decisions: [{ what: 'Store user sessions in DynamoDB', why: 'no servers to run' }, ...common],
    change: 'Move session storage from DynamoDB to a self-hosted PostgreSQL instance', expect: 'conflicts' },
  { decisions: [{ what: 'Use REST endpoints for the public API', why: 'clients already speak REST' }, ...common],
    change: 'Replace the public REST endpoints with a single GraphQL endpoint and remove the REST routes', expect: 'conflicts' },
  { decisions: [{ what: 'Never store raw audio recordings', why: 'privacy promise to users' }, ...common],
    change: 'Save the raw audio of each recording to S3 so we can replay it later', expect: 'conflicts' },
  { decisions: [{ what: 'Use vitest for all tests', why: 'fast and native ESM' }, ...common],
    change: 'Migrate the test suite from vitest to Jest and delete the vitest config', expect: 'conflicts' },
  { decisions: [{ what: 'Keep the web app free of third-party analytics', why: 'no tracking of visitors' }, ...common],
    change: 'Add the Google Analytics script to every page of the web app', expect: 'conflicts' },
  // refines: same topic, changes details within the decision
  { decisions: [{ what: 'Store user sessions in DynamoDB', why: 'no servers to run' }, ...common],
    change: 'Add a TTL attribute to the DynamoDB sessions table so old sessions expire after 30 days', expect: 'refines' },
  { decisions: [{ what: 'Use vitest for all tests', why: 'fast and native ESM' }, ...common],
    change: 'Turn on vitest coverage reporting with a 70% threshold', expect: 'refines' },
  { decisions: [{ what: 'Sync data from the device every 15 minutes', why: 'fresh enough and cheap' }, ...common],
    change: 'Change the sync interval from 15 minutes to 5 minutes during work hours', expect: 'refines' },
  // clear: unrelated to every decision, or follows it
  { decisions: [{ what: 'Store user sessions in DynamoDB', why: 'no servers to run' }, ...common],
    change: 'Fix the typo in the README installation section', expect: 'clear' },
  { decisions: [{ what: 'Use REST endpoints for the public API', why: 'clients already speak REST' }, ...common],
    change: 'Add a dark mode toggle to the settings page', expect: 'clear' },
  { decisions: [{ what: 'Never store raw audio recordings', why: 'privacy promise to users' }, ...common],
    change: 'Delete the raw audio buffer from memory right after transcription finishes', expect: 'clear' },
  { decisions: [{ what: 'Use vitest for all tests', why: 'fast and native ESM' }, ...common],
    change: 'Add a vitest test for the date parser edge cases', expect: 'clear' }
];
