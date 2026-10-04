export type Config = { domain: string; clientId: string; redirect: string };
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const store = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } } };

export async function signIn(cfg: Config): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    const verifier = store.get('pkce');
    const state = store.get('oauth_state');
    const returned = params.get('state');
    history.replaceState(null, '', location.pathname);
    if (!verifier || !state || returned !== state) throw new Error('sign-in state mismatch');
    const res = await fetch(`https://${cfg.domain}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, code, redirect_uri: cfg.redirect, code_verifier: verifier }) });
    if (!res.ok) throw new Error(`token exchange ${res.status}`);
    const { id_token } = await res.json() as { id_token: string };
    store.set('id_token', id_token);
    return id_token;
  }
  const saved = store.get('id_token');
  try { if (saved && JSON.parse(atob(saved.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 > Date.now()) return saved; } catch { /* malformed token: sign in again */ }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  store.set('pkce', verifier);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  store.set('oauth_state', state);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  location.assign(`https://${cfg.domain}/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirect, scope: 'openid email', code_challenge_method: 'S256', code_challenge: challenge, state })}`);
  return null;
}
