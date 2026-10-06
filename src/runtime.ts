import { analyzePending } from './analyze.js';
import type { BeeSource } from './bee/source.js';
import { collect } from './collect.js';
import { compileDay } from './compile.js';
import type { DayLog } from './domain/types.js';
import { log } from './log.js';
import type { ConverseFn } from './nova.js';
import type { Store } from './store/store.js';
import { classifySegment, readWorkHours, type WorkHours } from './workfilter.js';

export type Env = { TABLE: string; REGION: string; MODEL_ID: string; TIME_ZONE: string; REPOS: string; BEE_MODE: 'http' | 'cli'; BEE_BASE_URL?: string; BEE_SECRET_ARN?: string; USER_POOL_ID?: string; CLIENT_ID?: string };

export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
  return {
    TABLE: need('TABLE'), REGION: env.AWS_REGION ?? 'us-east-1', MODEL_ID: env.MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0',
    TIME_ZONE: env.TIME_ZONE ?? 'America/Mexico_City', REPOS: env.REPOS ?? '', BEE_MODE: env.BEE_MODE === 'cli' ? 'cli' : 'http',
    BEE_BASE_URL: env.BEE_BASE_URL, BEE_SECRET_ARN: env.BEE_SECRET_ARN, USER_POOL_ID: env.USER_POOL_ID, CLIENT_ID: env.CLIENT_ID
  };
}

export function recompiler(deps: { store: Store; converse: ConverseFn; repos: string[]; timeZone: string }) {
  return async (day: string): Promise<DayLog | null> => {
    const result = await compileDay({ day, ...deps, now: new Date() });
    if (!result) await deps.store.deleteDay(day);
    return result;
  };
}

/** The day log is rebuilt at most this often when nothing new arrived (commits can land any time; the sync runs every 5 minutes). */
export const TODAY_REFRESH_MS = 30 * 60_000;

export async function runSync(deps: { source: BeeSource; store: Store; converse: ConverseFn; repos: string[]; timeZone: string; now: Date; fetchFn?: typeof fetch; workHours?: WorkHours }) {
  const workHours = deps.workHours ?? readWorkHours({ ...process.env, TIME_ZONE: deps.timeZone });
  const collected = await collect({
    source: deps.source, store: deps.store, timeZone: deps.timeZone, now: deps.now, workHours,
    classify: s => classifySegment(s, deps.converse)
  });
  const { analyzed, failed } = await analyzePending(deps.store, deps.converse);
  const days = new Set<string>();
  for (const id of [...collected.saved, ...analyzed]) {
    const r = await deps.store.getSession(id);
    if (r) days.add(r.day);
  }
  for (const d of collected.ignoredDays) days.add(d);
  // Today is recompiled when it has sessions and its log is missing or stale, so fresh commits show up.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: deps.timeZone }).format(deps.now);
  if ((await deps.store.listSessionsOn(today)).length > 0) {
    const current = await deps.store.getDay(today);
    if (!current || deps.now.getTime() - Date.parse(current.updatedAt) >= TODAY_REFRESH_MS) days.add(today);
  }
  for (const day of days) await compileDay({ day, store: deps.store, converse: deps.converse, repos: deps.repos, timeZone: deps.timeZone, now: deps.now, fetchFn: deps.fetchFn });
  const out = {
    saved: collected.saved.length, analyzed: analyzed.length, failed: failed.length,
    ignoredPersonal: collected.ignoredPersonal, ignoredOffHours: collected.ignoredOffHours, classifyFailed: collected.classifyFailed.length, classifyGaveUp: collected.classifyGaveUp.length,
    days: [...days].sort()
  };
  log({ level: 'info', msg: 'sync', ...out, waiting: collected.skippedCapturing.length });
  return out;
}
