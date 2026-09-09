import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Compare decoded bytes using fixed-size SHA-256 digests, even for unequal lengths. */
export function safeEqual(a: string, b: string, encoding: BufferEncoding = 'utf8'): boolean {
  const hashedA = createHash('sha256').update(Buffer.from(a, encoding)).digest();
  const hashedB = createHash('sha256').update(Buffer.from(b, encoding)).digest();
  return timingSafeEqual(hashedA, hashedB);
}
