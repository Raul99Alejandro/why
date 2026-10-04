import { localDay } from './domain/dates.js';
import type { CommitRef } from './domain/types.js';
import { log } from './log.js';

/** Validates repo name format: owner/name where neither segment is only dots. */
const repoRegex = /^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/;

/** Public commits of the given repos on a local day (GitHub API without a token: 60 requests an hour is plenty). */
export async function commitsOn(day: string, repos: string[], timeZone: string, fetchFn: typeof fetch = fetch): Promise<CommitRef[]> {
  const since = new Date(`${day}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 1);
  const until = new Date(`${day}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 2);
  const out: CommitRef[] = [];
  for (const repo of repos) {
    if (!repoRegex.test(repo)) {
      log({ level: 'warn', msg: 'github_repo_invalid', repo });
      continue;
    }
    try {
      const res = await fetchFn(`https://api.github.com/repos/${repo}/commits?since=${since.toISOString()}&until=${until.toISOString()}&per_page=100`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'why-app' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      for (const c of await res.json() as Array<{ sha: string; html_url: string; commit: { message: string; author: { date: string } } }>) {
        const at = new Date(c.commit.author.date).toISOString();
        if (localDay(at, timeZone) !== day) continue;
        out.push({ repo, sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0]!, url: c.html_url, at });
      }
    } catch (err) {
      log({ level: 'warn', msg: 'github_unavailable', repo, error: (err as Error).message });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
