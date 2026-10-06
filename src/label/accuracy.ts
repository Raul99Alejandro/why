import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { similarity, SAME_STEP } from '../relate.js';

/**
 * The owner's judgement of one recorded day. Local only: the file lives under data/ (git-ignored) and holds decision wording.
 * - confirmed: Why's decisions the owner says are real (stored with Why's own wording)
 * - rejected: Why's decisions that are not real decisions
 * - added: real decisions Why missed (the owner's wording)
 */
export type Labels = { day: string; confirmed: string[]; rejected: string[]; added: string[] };

export type Accuracy = { day: string; why: number; truth: number; truePositives: number; falsePositives: number; falseNegatives: number; precision: number; recall: number; f1: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown): s is string => typeof s === 'string' && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const labelsPath = (dir: string, day: string): string => path.join(dir, `labels-${day}.json`);

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= 500 && v.every(x => typeof x === 'string' && x.trim() !== '' && x.length <= 600) ? (v as string[]).map(x => x.trim()) : null);

/** Validates untrusted JSON (a request body or a file) into Labels, or null. */
export function parseLabels(json: unknown): Labels | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  const confirmed = strings(o.confirmed), rejected = strings(o.rejected), added = strings(o.added);
  if (!isDay(o.day) || !confirmed || !rejected || !added) return null;
  return { day: o.day, confirmed, rejected, added };
}

export function saveLabels(dir: string, labels: Labels): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(labelsPath(dir, labels.day), JSON.stringify(labels, null, 2));
}
export function loadLabels(dir: string, day: string): Labels | null {
  try { return parseLabels(JSON.parse(readFileSync(labelsPath(dir, day), 'utf8'))); } catch { return null; }
}

const matches = (a: string, b: string): boolean => similarity(a, b) >= SAME_STEP;

/** Why's decisions the owner has not judged yet (no confirmed or rejected wording matches them). */
export const unreviewed = (why: string[], labels: Labels): string[] => why.filter(w => ![...labels.confirmed, ...labels.rejected].some(l => matches(w, l)));

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);

/**
 * Precision, recall and F1 of Why's decisions against the owner's labels. Matching is one to one, with the same token-overlap
 * helper and threshold (0.8) the rest of Why uses. Truth = confirmed + added. Added wording is the owner's own, so a decision Why
 * found but phrased differently counts as missed: the measure is conservative.
 */
export function computeAccuracy(why: string[], labels: Labels): Accuracy {
  const truth = [...labels.confirmed, ...labels.added];
  const used = new Set<number>();
  let tp = 0;
  for (const w of why) {
    const i = truth.findIndex((t, k) => !used.has(k) && matches(w, t));
    if (i >= 0) { used.add(i); tp++; }
  }
  const fp = why.length - tp, fn = truth.length - tp;
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { day: labels.day, why: why.length, truth: truth.length, truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

/** Numbers only, one per line. */
export const formatAccuracy = (a: Accuracy): string => [
  `day ${a.day}`, `why decisions ${a.why}`, `real decisions ${a.truth}`,
  `true positives ${a.truePositives}`, `false positives ${a.falsePositives}`, `false negatives ${a.falseNegatives}`,
  `precision ${a.precision.toFixed(2)}`, `recall ${a.recall.toFixed(2)}`, `f1 ${a.f1.toFixed(2)}`
].join('\n');
