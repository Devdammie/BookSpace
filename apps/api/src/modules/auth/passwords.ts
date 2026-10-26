import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

export function hashPassword(password: string) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, passwordHash: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function temporaryPassword() {
  return `Tmp-${randomBytes(9).toString('base64url')}`;
}

export function newCsrfToken() {
  return randomBytes(32).toString('hex');
}

export function tokensMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
