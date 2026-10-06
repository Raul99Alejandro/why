import { createVerify, X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';

/** Fetches the PEM chain behind SignatureCertChainUrl. Behind an interface so tests never touch the network. */
export type FetchChain = (url: string, signal?: AbortSignal) => Promise<string>;
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
  // Every certificate above the leaf signs others, so it must be a CA.
  for (const c of certs.slice(1)) if (!c.ca) return null;
  for (const c of certs) if (now < new Date(c.validFrom) || now > new Date(c.validTo)) return null;
  if (!leaf.subjectAltName?.split(/,\s*/).includes(`DNS:${SAN_NAME}`)) return null;
  for (let i = 0; i < certs.length - 1; i++) if (!certs[i]!.checkIssued(certs[i + 1]!) || !certs[i]!.verify(certs[i + 1]!.publicKey)) return null;
  const top = certs.at(-1)!;
  const trusted = roots.some(r => { const root = new X509Certificate(r); return top.checkIssued(root) && top.verify(root.publicKey); });
  return trusted ? leaf : null;
}

const NEGATIVE_MS = 60_000;

/** Full Alexa request check: certificate URL, chain, signature over the raw body bytes, and a fresh timestamp. Never throws. */
export function createRequestVerifier(deps: VerifyDeps) {
  const cache = new Map<string, { leaf: X509Certificate; until: number }>();
  const failed = new Map<string, number>();
  return async (headers: Record<string, string | undefined>, rawBody: Buffer, signal?: AbortSignal): Promise<boolean> => {
    try {
      const url = headers.signaturecertchainurl;
      const sha256 = headers['signature-256'];
      const signature = sha256 ?? headers.signature;
      if (!url || !signature || !validChainUrl(url)) return false;
      const now = deps.now();
      const t = now.getTime();
      if ((failed.get(url) ?? 0) > t) return false;
      let entry = cache.get(url);
      if (!entry || t > entry.until) {
        try {
          const pem = await deps.fetchChain(url, signal);
          const certs = splitPem(pem).map(p => new X509Certificate(p));
          const leaf = validChain(pem, now, deps.roots);
          if (!leaf) { failed.set(url, t + NEGATIVE_MS); return false; }
          // The cached chain is good only until the first certificate in it expires.
          entry = { leaf, until: Math.min(...certs.map(c => Date.parse(c.validTo))) };
          cache.set(url, entry);
        } catch (err) {
          if (!signal?.aborted) failed.set(url, t + NEGATIVE_MS); // a deadline is not the certificate's fault
          throw err;
        }
      }
      if (!createVerify(sha256 ? 'RSA-SHA256' : 'RSA-SHA1').update(rawBody).verify(entry.leaf.publicKey, signature, 'base64')) return false;
      const ts = Date.parse((JSON.parse(rawBody.toString('utf8')) as { request?: { timestamp?: string } }).request?.timestamp ?? '');
      return Number.isFinite(ts) && Math.abs(t - ts) <= TOLERANCE_MS;
    } catch { return false; }
  };
}

export const fetchChainOverHttps: FetchChain = async (url, signal) => {
  const res = await fetch(url, { redirect: 'error', signal });
  if (!res.ok) throw new Error('chain fetch failed');
  return res.text();
};
