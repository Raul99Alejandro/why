import { createVerify, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';

/** Fetches the PEM chain behind SignatureCertChainUrl. Behind an interface so tests never touch the network. */
export type FetchChain = (url: string) => Promise<string>;
export type VerifyDeps = { fetchChain: FetchChain; now: () => Date; roots?: readonly string[] };

const TOLERANCE_MS = 150_000;
const SAN_NAME = 'echo-api.amazon.com';

/** Alexa's rules for the certificate URL: https, host s3.amazonaws.com, path /echo.api/, port 443. */
export function validChainUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === 's3.amazonaws.com' && u.pathname.startsWith('/echo.api/') && (u.port === '' || u.port === '443') && !u.username && !u.password;
  } catch { return false; }
}

const splitPem = (pem: string) => pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];

/** Leaf is valid now, names echo-api.amazon.com, and chains to a trusted root. */
export function validChain(pem: string, now: Date, roots: readonly string[] = rootCertificates): X509Certificate | null {
  const certs = splitPem(pem).map(p => new X509Certificate(p));
  const leaf = certs[0];
  if (!leaf) return null;
  for (const c of certs) if (now < new Date(c.validFrom) || now > new Date(c.validTo)) return null;
  if (!leaf.subjectAltName?.split(/,\s*/).includes(`DNS:${SAN_NAME}`)) return null;
  for (let i = 0; i < certs.length - 1; i++) if (!certs[i]!.checkIssued(certs[i + 1]!) || !certs[i]!.verify(certs[i + 1]!.publicKey)) return null;
  const top = certs.at(-1)!;
  const trusted = roots.some(r => { const root = new X509Certificate(r); return top.checkIssued(root) && top.verify(root.publicKey); });
  return trusted ? leaf : null;
}

/** Full Alexa request check: certificate URL, chain, signature over the raw body, and a fresh timestamp. Never throws. */
export function createRequestVerifier(deps: VerifyDeps) {
  const cache = new Map<string, X509Certificate>();
  return async (headers: Record<string, string | undefined>, rawBody: string): Promise<boolean> => {
    try {
      const url = headers.signaturecertchainurl;
      const sha256 = headers['signature-256'];
      const signature = sha256 ?? headers.signature;
      if (!url || !signature || !validChainUrl(url)) return false;
      const now = deps.now();
      let leaf = cache.get(url);
      if (!leaf || now > new Date(leaf.validTo)) {
        const pem = await deps.fetchChain(url);
        const checked = validChain(pem, now, deps.roots);
        if (!checked) return false;
        leaf = checked; cache.set(url, leaf);
      }
      if (!createVerify(sha256 ? 'RSA-SHA256' : 'RSA-SHA1').update(rawBody).verify(leaf.publicKey, signature, 'base64')) return false;
      const ts = Date.parse((JSON.parse(rawBody) as { request?: { timestamp?: string } }).request?.timestamp ?? '');
      return Number.isFinite(ts) && Math.abs(now.getTime() - ts) <= TOLERANCE_MS;
    } catch { return false; }
  };
}

export const fetchChainOverHttps: FetchChain = async url => {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error('chain fetch failed');
  return res.text();
};
