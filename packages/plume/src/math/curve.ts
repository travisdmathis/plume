import * as THREE from "three";

/**
 * 1D scalar curve sampled by time in [0, 1].
 * Serialized as a sparse list of (time, value) keyframes; evaluated via linear interpolation.
 * Can be baked to a 1D DataTexture for GPU sampling in shaders (see `.getTexture()`).
 */
export interface CurveKeyframe {
  t: number; // 0..1
  v: number;
}

export class Curve1D {
  readonly keyframes: CurveKeyframe[];

  constructor(keyframes: CurveKeyframe[]) {
    if (keyframes.length === 0) throw new Error("Curve1D requires at least one keyframe");
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    this.keyframes = sorted;
  }

  static constant(value: number): Curve1D {
    return new Curve1D([{ t: 0, v: value }]);
  }

  static linear(from: number, to: number): Curve1D {
    return new Curve1D([
      { t: 0, v: from },
      { t: 1, v: to },
    ]);
  }

  sample(t: number): number {
    const keys = this.keyframes;
    if (t <= keys[0]!.t) return keys[0]!.v;
    const last = keys[keys.length - 1]!;
    if (t >= last.t) return last.v;
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i]!;
      if (t <= b.t) {
        const a = keys[i - 1]!;
        const span = b.t - a.t;
        if (span <= 0) return b.v;
        const f = (t - a.t) / span;
        return a.v + (b.v - a.v) * f;
      }
    }
    return last.v;
  }

  /** Bake to a Float32Array for GPU texture upload. */
  bake(samples = 256): Float32Array {
    const out = new Float32Array(samples);
    const denom = samples - 1;
    for (let i = 0; i < samples; i++) out[i] = this.sample(i / denom);
    return out;
  }

  toJSON(): { keyframes: CurveKeyframe[] } {
    return { keyframes: this.keyframes };
  }

  static fromJSON(data: { keyframes: CurveKeyframe[] }): Curve1D {
    return new Curve1D(data.keyframes);
  }

  /**
   * Lazily bake the curve to a 1×N R32F DataTexture for GPU sampling.
   * Cached per-instance; reused across kernel rebuilds.
   */
  private _texture?: THREE.DataTexture;
  getTexture(samples = 256): THREE.DataTexture {
    if (this._texture) return this._texture;
    const data = this.bake(samples);
    const tex = new THREE.DataTexture(data, samples, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this._texture = tex;
    return tex;
  }
}
