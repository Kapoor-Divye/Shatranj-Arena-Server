import { webcrypto } from 'node:crypto';

export function getSecureRandomInt(min, max) {
  const range = max - min;
  if (range <= 0) return min;

  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % range);

  const buffer = new Uint32Array(1);
  do {
    webcrypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return min + (buffer[0] % range);
}

export function csprngShuffle(array) {
  const cloned = [...array];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(0, i + 1);
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}