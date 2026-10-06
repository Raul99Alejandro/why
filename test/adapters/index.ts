import { w01 } from './w01.js';
import { w02 } from './w02.js';
import { w03 } from './w03.js';
export type Adapter = (given: any, when: any) => unknown | Promise<unknown>;
/** Every rule runs through an adapter. Judged rules (W-02, W-03) run the real prompt and validation code against a fake model that answers from the examples in the prompt. */
export const adapters: Record<string, Adapter> = { 'W-01': w01, 'W-02': w02, 'W-03': w03 };
