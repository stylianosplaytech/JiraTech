import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Encrypts stored credentials (e.g. mailbox passwords) with AES-256-GCM. The key comes from MAIL_SECRET,
 * or JWT_SECRET when that isn't set: changing it means re-entering the passwords.
 */
function key() {
  const secret = process.env.MAIL_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Set MAIL_SECRET or JWT_SECRET to store mailbox passwords');
  return createHash('sha256').update(secret).digest();
}

/** "v1:iv:tag:ciphertext", base64 parts. */
export function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
}

/** Null when it can't be decrypted (e.g. the secret changed). */
export function open(sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
