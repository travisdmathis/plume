import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";

import type { ParticleStorage } from "../../particle-buffer.js";
import type { ModuleJSON, RenderContext, RenderModule } from "../module.js";
import { registerModule } from "../registry.js";

export interface LightEmissionParams {
  /** How many PointLights to maintain for this emitter. Keep small — lights are expensive. Default 4. */
  lightCount?: number;
  /** Color applied to each light. */
  color?: THREE.ColorRepresentation;
  /** Light intensity multiplier. */
  intensity?: number;
  /** Light range (in world units). */
  distance?: number;
  /** Quadratic attenuation. Default 2 (physical). */
  decay?: number;
  id?: string;
}

/**
 * Renders *with* an emitter as a set of CPU-side `THREE.PointLight`s that track the first N
 * live particles. Driving lights from a GPU storage buffer requires a round-trip:
 *
 *  1. Each frame `updateRender` submits a staging buffer readback for `posAlive` of the first
 *     `lightCount` slots.
 *  2. When the async readback resolves (1–2 frames of latency), the lights' positions are
 *     updated. Until then they hold the prior values — visually unnoticeable.
 *
 * Lights are added as children of `this.object3D`, so they're inserted into the scene when
 * the System is spawned and removed when it retires. Dead particles ⇒ zero-intensity lights.
 *
 * This module is deliberately simple — no per-light color variation, no flicker driven by
 * particle age. Extend later once the base pipeline proves out.
 */
export class LightEmission implements RenderModule {
  static readonly type = "render.light_emission";
  readonly kind = "render" as const;
  readonly type = LightEmission.type;
  readonly id?: string;

  readonly object3D: THREE.Group;
  lightCount: number;
  intensity: number;

  private _storage?: ParticleStorage;
  private _lights: THREE.PointLight[] = [];
  private _readback?: Float32Array;
  private _readbackPending = false;
  private _intensityBase: number;

  constructor(params: LightEmissionParams = {}) {
    this.lightCount = Math.max(1, params.lightCount ?? 4);
    this._intensityBase = params.intensity ?? 2;
    this.intensity = this._intensityBase;
    this.id = params.id;

    this.object3D = new THREE.Group();
    this.object3D.matrixAutoUpdate = false;

    for (let i = 0; i < this.lightCount; i++) {
      const light = new THREE.PointLight(
        params.color ?? 0xffffff,
        0, // start dark — positions/intensities updated on first readback
        params.distance ?? 5,
        params.decay ?? 2,
      );
      light.castShadow = false;
      this._lights.push(light);
      this.object3D.add(light);
    }
  }

  init(storage: ParticleStorage): void {
    this._storage = storage;
    // Staging buffer holds `lightCount` vec4s (posAlive packed slots).
    this._readback = new Float32Array(this.lightCount * 4);
  }

  postUpdate(renderer: WebGPURenderer, liveCount: number): void {
    if (!this._storage || !this._readback || this._readbackPending) return;
    if (liveCount === 0) return;

    // Only read as much as we have live particles (but never more than our light count).
    const slots = Math.min(this.lightCount, liveCount);
    this._readbackPending = true;
    renderer
      .getArrayBufferAsync(this._storage.posAlive.value, null, 0, slots * 16)
      .then((buf) => {
        const src = new Float32Array(buf);
        this._readback!.set(src, 0);
        // Fill any trailing slots with "dead" markers so their lights fade out.
        for (let i = src.length; i < this._readback!.length; i++) this._readback![i] = 0;
      })
      .catch(() => {
        // Readback failures aren't fatal — just keep last-known positions.
      })
      .finally(() => {
        this._readbackPending = false;
      });
  }

  updateRender(liveCount: number, ctx: RenderContext): void {
    if (!this._readback) return;
    // Apply the most-recent readback to the CPU-side PointLights. This runs every frame
    // even when readback is mid-flight; we just re-apply the last-seen values.
    const intensity = this._intensityBase * ctx.intensity;
    for (let i = 0; i < this.lightCount; i++) {
      const light = this._lights[i]!;
      const alive = this._readback[i * 4 + 3];
      if (alive >= 0.5 && i < liveCount) {
        light.position.set(
          this._readback[i * 4 + 0]!,
          this._readback[i * 4 + 1]!,
          this._readback[i * 4 + 2]!,
        );
        light.intensity = intensity;
      } else {
        light.intensity = 0;
      }
    }
  }

  dispose(): void {
    for (const l of this._lights) l.dispose();
    this._lights.length = 0;
  }

  toJSON(): ModuleJSON {
    return {
      type: LightEmission.type,
      id: this.id,
      lightCount: this.lightCount,
      intensity: this._intensityBase,
    };
  }

  static fromJSON(data: ModuleJSON): LightEmission {
    return new LightEmission({
      lightCount: data["lightCount"] as number | undefined,
      intensity: data["intensity"] as number | undefined,
      id: data.id,
    });
  }
}

registerModule(LightEmission);
