import * as THREE from "three";
import type { ColorRGBATuple } from "../types.js";

export interface GradientStop {
  t: number; // 0..1
  color: ColorRGBATuple; // rgba, linear 0..1
}

/**
 * RGBA color gradient, sampled by time in [0, 1]. Premultiplied-free linear interpolation.
 * Will bake to a 1D RGBA texture for GPU.
 */
export class Gradient {
  readonly stops: GradientStop[];

  constructor(stops: GradientStop[]) {
    if (stops.length === 0) throw new Error("Gradient requires at least one stop");
    this.stops = [...stops].sort((a, b) => a.t - b.t);
  }

  static constant(rgba: ColorRGBATuple): Gradient {
    return new Gradient([{ t: 0, color: rgba }]);
  }

  static linear(from: ColorRGBATuple, to: ColorRGBATuple): Gradient {
    return new Gradient([
      { t: 0, color: from },
      { t: 1, color: to },
    ]);
  }

  sample(t: number, out: ColorRGBATuple): ColorRGBATuple {
    const stops = this.stops;
    if (t <= stops[0]!.t) {
      const c = stops[0]!.color;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = c[3];
      return out;
    }
    const last = stops[stops.length - 1]!;
    if (t >= last.t) {
      out[0] = last.color[0];
      out[1] = last.color[1];
      out[2] = last.color[2];
      out[3] = last.color[3];
      return out;
    }
    for (let i = 1; i < stops.length; i++) {
      const b = stops[i]!;
      if (t <= b.t) {
        const a = stops[i - 1]!;
        const span = b.t - a.t;
        const f = span <= 0 ? 0 : (t - a.t) / span;
        out[0] = a.color[0] + (b.color[0] - a.color[0]) * f;
        out[1] = a.color[1] + (b.color[1] - a.color[1]) * f;
        out[2] = a.color[2] + (b.color[2] - a.color[2]) * f;
        out[3] = a.color[3] + (b.color[3] - a.color[3]) * f;
        return out;
      }
    }
    out[0] = last.color[0];
    out[1] = last.color[1];
    out[2] = last.color[2];
    out[3] = last.color[3];
    return out;
  }

  /** Bake to a Float32Array RGBA buffer (length = samples * 4). */
  bake(samples = 256): Float32Array {
    const out = new Float32Array(samples * 4);
    const tmp: ColorRGBATuple = [0, 0, 0, 0];
    const denom = samples - 1;
    for (let i = 0; i < samples; i++) {
      this.sample(i / denom, tmp);
      out[i * 4] = tmp[0];
      out[i * 4 + 1] = tmp[1];
      out[i * 4 + 2] = tmp[2];
      out[i * 4 + 3] = tmp[3];
    }
    return out;
  }

  toJSON(): { stops: GradientStop[] } {
    return { stops: this.stops };
  }

  static fromJSON(data: { stops: GradientStop[] }): Gradient {
    return new Gradient(data.stops);
  }

  /** Lazily bake to a 1×N RGBA32F DataTexture for GPU sampling. */
  private _texture?: THREE.DataTexture;
  getTexture(samples = 256): THREE.DataTexture {
    if (this._texture) return this._texture;
    const data = this.bake(samples);
    const tex = new THREE.DataTexture(data, samples, 1, THREE.RGBAFormat, THREE.FloatType);
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
