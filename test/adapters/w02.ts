import { judgeDecision, raisesAlert } from '../../src/relate.js';
import { fakeModel } from '../helpers/fakes.js';
import type { Adapter } from './index.js';

const RELATIONS = ['reversal', 'refinement', 'restatement', 'unrelated'];

/**
 * Runs the real judge pipeline (prompt, schema validation, label check, alert rule) with a fake model that answers only from
 * the examples embedded in the prompt: a wrong or missing example in the prompt makes the approved example fail.
 */
const model = fakeModel((_tool, system, user) => {
  const current = /<current>(.*?) \(reason:/s.exec(user)![1]!;
  const prior = />([^<]*)<\/prior>/.exec(user)?.[1];
  const relation = prior ? RELATIONS.find(r => system.includes(`"${prior}" -> "${current}" = ${r}`)) : undefined;
  return { relation: relation ?? 'unrelated', priorId: relation ? 'P1' : '', nextStep: '' };
});

export const w02: Adapter = async (given) => {
  const j = await judgeDecision({ what: given.new, why: 'No reason given', candidates: [{ id: 'old', date: '2026-10-01', what: given.old }], converse: model });
  return { relation: j?.relation, alert: j ? raisesAlert(j.relation) : null, linked: j?.priorId ?? null };
};
