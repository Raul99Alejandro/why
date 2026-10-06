import { w01 } from './w01.js';
export type Adapter = (given: any, when: any) => unknown;
/** Deterministic rules. Judged rules (kind: judged) are model decisions: their examples are checked for shape here and run against the real judge in the prompt battery. */
export const adapters: Record<string, Adapter> = { 'W-01': w01 };
