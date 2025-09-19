import crypto from 'node:crypto';
import { base64urlEncode, base64urlDecode } from './base64url.mjs';

const defaultHeader = { alg: 'HS256', typ: 'JWT' };

export function sign(payload, secret, { expiresInSec } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat };
  if (expiresInSec) claims.exp = iat + expiresInSec;
  const headerEnc = base64urlEncode(JSON.stringify(defaultHeader));
  const payloadEnc = base64urlEncode(JSON.stringify(claims));
  const data = `${headerEnc}.${payloadEnc}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  const sigEnc = base64urlEncode(sig);
  return `${data}.${sigEnc}`;
}

export function verify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerEnc, payloadEnc, sigEnc] = parts;
  const data = `${headerEnc}.${payloadEnc}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const provided = base64urlDecode(sigEnc);
  if (!crypto.timingSafeEqual(expected, provided)) throw new Error('Invalid signature');
  const claims = JSON.parse(base64urlDecode(payloadEnc).toString('utf8'));
  if (claims.exp && Math.floor(Date.now() / 1000) > claims.exp) throw new Error('Token expired');
  return claims;
}

