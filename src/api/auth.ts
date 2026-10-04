import { CognitoJwtVerifier } from 'aws-jwt-verify';
export type Verifier = (authorization: string | undefined) => Promise<boolean>;
export function cognitoVerifier(userPoolId: string, clientId: string): Verifier {
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
  return async header => {
    const token = /^Bearer (.+)$/.exec(header ?? '')?.[1];
    if (!token) return false;
    try { await verifier.verify(token); return true; } catch { return false; }
  };
}
