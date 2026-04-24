/**
 * Mulberry32: small, fast, deterministic PRNG. Good enough for VFX.
 * Given the same seed, produces the same stream — required for reproducible effects.
 */
export class RNG {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0 || 1;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0 || 1;
  }

  /** Raw 32-bit unsigned integer from the stream. */
  u32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max). */
  rangeInt(min: number, max: number): number {
    return (min + Math.floor(this.next() * (max - min))) | 0;
  }

  /** Uniform unit vector on sphere. */
  unitSphere(out: [number, number, number]): [number, number, number] {
    const u = this.next() * 2 - 1;
    const theta = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    out[0] = r * Math.cos(theta);
    out[1] = u;
    out[2] = r * Math.sin(theta);
    return out;
  }
}

/** Process-global shared RNG. Modules can take an RNG instance to override. */
export const sharedRNG = new RNG(Date.now() & 0x7fffffff);
