// ---------------------------------------------------------------------------
// hashNoise.ts — Deterministic noise & seeded PRNG
// Matches the patterns identified in the tree.icqr.com audit:
//   Ee(text): hash = imul(31, hash) + charCode | 0 → seed = abs(hash) % 0x18697 + 1
//   le(i,j,k): fract(43758.5 * sin(dot(...))) style hash-noise
// ---------------------------------------------------------------------------

/** Seed from URL text — matches Ee(text) in the bundle */
export function hash31(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 0x18697) + 1;
}

/** GPU-style hash noise: fract(43758.5453 * sin(dot(v, primes))) */
export function hashNoise3(i: number, j: number, k: number, seed: number): number {
  const dot = i * 127.1 + j * 311.7 + k * 74.7 + seed * 13.13;
  return fract(43758.5453 * Math.sin(dot));
}

/** 2D variant */
export function hashNoise2(i: number, j: number, seed: number): number {
  const dot = i * 127.1 + j * 311.7 + seed * 13.13;
  return fract(43758.5453 * Math.sin(dot));
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Mulberry32 PRNG — deterministic sequence from a 32-bit seed */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
