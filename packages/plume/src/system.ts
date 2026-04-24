import * as THREE from "three";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";
import type { WebGPURenderer } from "three/webgpu";
import { Emitter, type EmitterDef } from "./emitter.js";
import type { RenderContext } from "./modules/module.js";

export interface SystemDef {
  name?: string;
  emitters: EmitterDef[];
  /** Seconds of playback after which all emitters stop spawning. Undefined = indefinite. */
  duration?: number;
  loop?: boolean;
}

/** A composite VFX system — one or more Emitters bound to a common transform. */
export class System {
  readonly name?: string;
  readonly emitters: Emitter[];
  readonly object3D: THREE.Group;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly scale = new THREE.Vector3(1, 1, 1);
  intensity = 1.0;
  duration?: number;
  loop: boolean;

  private _systemTime = 0;
  private _playing = true;
  private _worldMatrix = new THREE.Matrix4();

  constructor(def: SystemDef) {
    this.name = def.name;
    this.duration = def.duration;
    this.loop = def.loop ?? false;
    this.emitters = def.emitters.map((e) => new Emitter(e));
    this.object3D = new THREE.Group();
    this.object3D.name = def.name ?? "PlumeSystem";
    this.object3D.matrixAutoUpdate = false;
    for (const em of this.emitters) this.object3D.add(em.render.object3D);
  }

  play(): void {
    this._systemTime = 0;
    this._playing = true;
    for (const em of this.emitters) em.play();
  }

  /** Pre-compile all compute kernels for every emitter. See `Emitter.warmup`. */
  async warmup(renderer: WebGPURenderer): Promise<void> {
    await Promise.all(this.emitters.map((em) => em.warmup(renderer)));
  }

  stopSpawning(): void {
    for (const em of this.emitters) em.stopSpawning();
  }

  hardStop(): void {
    this._playing = false;
    for (const em of this.emitters) em.hardStop();
  }

  /** Emitter lifecycle: true while any emitter has live particles or is still spawning. */
  isAlive(): boolean {
    if (!this._playing) return false;
    for (const em of this.emitters) if (em.isAlive()) return true;
    return false;
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, value);
  }

  /**
   * Update all emitters. Renderer is passed through for GPU compute dispatch.
   *
   * If `batch` is provided, emitter frame kernels are collected into it instead of being
   * dispatched inline — the Manager uses this to coalesce every active system's kernels
   * into a single `renderer.computeAsync([...])` call per tick, cutting per-frame command-
   * buffer submits from O(systems) down to O(1).
   */
  tick(
    renderer: WebGPURenderer,
    deltaTime: number,
    parentIntensity: number,
    camera?: THREE.Camera,
    batch?: ComputeNode[],
  ): void {
    if (!this._playing) return;
    this._systemTime += deltaTime;

    if (this.duration !== undefined && this._systemTime > this.duration) {
      if (this.loop) {
        this._systemTime = this._systemTime % this.duration;
        for (const em of this.emitters) em.play();
      } else {
        this.stopSpawning();
      }
    }

    this._worldMatrix.compose(this.position, this.quaternion, this.scale);
    const effectiveIntensity = parentIntensity * this.intensity;

    for (const em of this.emitters)
      em.tick(renderer, deltaTime, this._worldMatrix, effectiveIntensity, camera, batch);

    if (!this.isAlive()) this._playing = false;
  }

  syncRender(camera: THREE.Camera, parentIntensity: number): void {
    const ctx: RenderContext = {
      camera,
      worldMatrix: this._worldMatrix,
      intensity: parentIntensity * this.intensity,
    };
    for (const em of this.emitters) em.syncRender(ctx);
  }

  dispose(): void {
    for (const em of this.emitters) em.dispose();
    if (this.object3D.parent) this.object3D.parent.remove(this.object3D);
  }
}
