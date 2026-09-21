import { createHash } from 'node:crypto';

/** Stable JSON bytes used by every persisted hash-bound package artifact. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

/** SHA-256 label used by persisted package artifacts and attestations. */
export function sha256Buffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(Reflect.get(value, key))]),
  );
}
