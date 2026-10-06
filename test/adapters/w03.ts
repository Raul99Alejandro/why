import { closingCommit, judgeDecision } from '../../src/relate.js';
import { fakeModel } from '../helpers/fakes.js';
import type { Adapter } from './index.js';

/** Answers only from the examples embedded in the prompts (see w02.ts). */
const model = fakeModel((tool, system, user) => {
  if (tool === 'save_closing_commits') {
    const step = /<step>(.*?) \(from the decision:/s.exec(user)![1]!;
    const commits = [...user.matchAll(/<commit sha="([^"]+)">([^<]*)<\/commit>/g)];
    return { commits: commits.filter(([, , msg]) => system.includes(`step "${step}" with commit "${msg}" = closes it`)).map(c => c[1]) };
  }
  const current = /<current>(.*?) \(reason:/s.exec(user)![1]!;
  const wants = system.includes(`"${current}" -> a nextStep`);
  return { relation: 'unrelated', priorId: '', nextStep: wants ? 'Record the demo in the simulator tomorrow morning' : '' };
});

export const w03: Adapter = async (given, when) => {
  if (when.close) {
    const r = await closingCommit({ what: given.decision, step: given.decision, decisionAt: '2026-10-06T10:00:00.000Z',
      commits: [{ repo: 'o/r', sha: 'abc1234', message: given.commit, url: 'u', at: '2026-10-06T12:00:00.000Z' }], converse: model });
    return { closed: r?.commit != null };
  }
  const j = await judgeDecision({ what: given.decision, why: 'No reason given', candidates: [], converse: model });
  return { todo: !!j?.nextStep };
};
