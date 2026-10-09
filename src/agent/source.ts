import type { DayLog, PublishedDay } from '../domain/types.js';
import type { Store } from '../store/store.js';

/** Where agent tools read decisions from: the owner's private logs or the published copy. */
export type DaySource = { listDays(): Promise<string[]>; getDay(date: string): Promise<DayLog | PublishedDay | null> };
export const privateSource = (store: Store): DaySource => ({ listDays: () => store.listDays(), getDay: d => store.getDay(d) });
export const publishedSource = (store: Store): DaySource => ({ listDays: () => store.listPublished(), getDay: d => store.getPublished(d) });
