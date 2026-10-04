import { parseChanged, parseConversation, type BeeSource } from './source.js';

// Paths from docs/bee-api.md. The Bearer scheme is unverified and the API uses a private CA
// (see the doc); the CLI source is the supported path.
export class HttpBeeSource implements BeeSource {
  constructor(private baseUrl: string, private token: () => Promise<string>, private fetchFn: typeof fetch = fetch) {}
  private async get(path: string): Promise<unknown> {
    const res = await this.fetchFn(new URL(path, this.baseUrl), { headers: { authorization: `Bearer ${await this.token()}`, accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Bee token rejected: log in again and update the why/bee-token secret');
    if (!res.ok) throw new Error(`Bee API ${res.status} on ${path.split('?')[0]}`);
    return res.json();
  }
  async changedSince(cursor: string | null) {
    return parseChanged(await this.get(cursor ? `/v1/changes?cursor=${encodeURIComponent(cursor)}` : '/v1/changes'));
  }
  async conversation(id: string) {
    return parseConversation(await this.get(`/v1/conversations/${encodeURIComponent(id)}`));
  }
}
