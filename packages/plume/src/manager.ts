import * as THREE from "three";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";
import type { WebGPURenderer } from "three/webgpu";
import { System, type SystemDef } from "./system.js";

/**
 * Prefab input — either a plain `SystemDef` (simple case) or a factory function that returns
 * a fresh `SystemDef` per invocation. Prefer the factory form: it ensures each new pooled
 * System instance gets its own renderer + module instances instead of sharing state with
 * sibling Systems (which breaks multi-spawn because renderers are stateful).
 */
export type SystemDefInput = SystemDef | (() => SystemDef);

export interface ManagerOptions {
  /** WebGPURenderer — required for GPU compute dispatch. */
  renderer: WebGPURenderer;
  /** Scene (or any Object3D) to which active systems are added. */
  scene: THREE.Object3D;
  /** Default camera passed to renderers (can be overridden per-tick). */
  camera?: THREE.Camera;
  /** Maximum number of concurrent active systems. Excess spawns are rejected. */
  maxActive?: number;
  /** Maximum number of inactive systems retained per prefab id for reuse. */
  maxPoolPer?: number;
  /** Global intensity multiplier applied to every system (0..1). */
  globalIntensity?: number;
  /**
   * If set, `Manager.tick(dt)` discretizes into integer steps of exactly `fixedTimestep`
   * seconds, using an internal accumulator to catch up. Identical inputs ⇒ identical output
   * regardless of the real-time delta — required for replays, deterministic tests, and the
   * editor's live preview.
   *
   * Leave unset for variable-timestep operation (default; passes `deltaTime` straight through).
   */
  fixedTimestep?: number;
  /**
   * Upper bound on accumulator size (in seconds) when `fixedTimestep` is set. Prevents the
   * "spiral of death" if the tab backgrounds for a long time and resumes with a huge
   * deltaTime. Anything beyond this is discarded. Default 0.25s.
   */
  maxAccumulatedTime?: number;
}

/**
 * Level-of-detail config attached to an active system. The Manager computes distance from
 * the camera each tick and scales intensity / toggles visibility accordingly:
 *
 * - `bounds`: radius of the bounding sphere centered at the system's world position, used
 *   for frustum culling. If unset, frustum culling is skipped for this system.
 * - `farFadeStart` + `maxDistance`: linear intensity ramp from 1.0 at `farFadeStart` down
 *   to 0.0 at `maxDistance`. Past `maxDistance` intensity stays at 0, which stops new
 *   particles from spawning — the system drains naturally as existing particles expire.
 *
 * Leaving `lod` unset preserves today's always-full-intensity, always-visible behavior.
 */
export interface SystemCulling {
  /** Bounding-sphere radius at system origin for frustum culling. If unset, no frustum test. */
  bounds?: number;
  /** Distance at which the intensity fade begins. Default = `maxDistance` (no fade, hard cutoff). */
  farFadeStart?: number;
  /** Distance at/past which intensity reaches 0 and no new particles spawn. */
  maxDistance?: number;
}

export interface SpawnOptions {
  position?: THREE.Vector3Like;
  quaternion?: THREE.QuaternionLike;
  scale?: THREE.Vector3Like | number;
  intensity?: number;
  parent?: THREE.Object3D;
  /** Distance-based LOD + frustum culling config. See {@link SystemCulling}. */
  lod?: SystemCulling;
}

interface ActiveEntry {
  id: string;
  system: System;
  lod?: SystemCulling;
}

/**
 * Central VFX orchestrator. Holds prefab defs (registered by id), spawns pooled System instances
 * on demand, and drives them each tick. Mirrors chrome-runners' VFXManager shape for three.js.
 */
export class Manager {
  renderer: WebGPURenderer;
  scene: THREE.Object3D;
  camera?: THREE.Camera;
  maxActive: number;
  maxPoolPer: number;
  globalIntensity: number;
  fixedTimestep?: number;
  maxAccumulatedTime: number;

  private _prefabs = new Map<string, SystemDefInput>();
  private _pool = new Map<string, System[]>();
  private _active: ActiveEntry[] = [];
  private _accum = 0;

  // Reused per-tick scratch for LOD / culling. Kept as instance fields so we don't allocate
  // every frame; the Manager is single-threaded per JS runtime so no aliasing concern.
  private _frustum = new THREE.Frustum();
  private _frustumMatrix = new THREE.Matrix4();
  private _cullSphere = new THREE.Sphere();
  private _cameraWorldPos = new THREE.Vector3();
  private _systemWorldPos = new THREE.Vector3();
  // Shared compute batch; cleared + refilled each step, flushed as one `computeAsync`.
  private _batchBuffer: ComputeNode[] = [];

  constructor(options: ManagerOptions) {
    this.renderer = options.renderer;
    this.scene = options.scene;
    this.camera = options.camera;
    this.maxActive = options.maxActive ?? 128;
    this.maxPoolPer = options.maxPoolPer ?? 8;
    this.globalIntensity = options.globalIntensity ?? 1;
    this.fixedTimestep = options.fixedTimestep;
    this.maxAccumulatedTime = options.maxAccumulatedTime ?? 0.25;
  }

  /**
   * Register a prefab by id. Accepts either a plain `SystemDef` or a factory `() => SystemDef`.
   * Factories are called once per newly-created System instance, giving each pooled System
   * its own renderer/module instances (required for correct multi-spawn rendering).
   */
  register(id: string, def: SystemDefInput): void {
    this._prefabs.set(id, def);
  }

  /**
   * Preload pooled instances of a prefab for hot spawning — also warms their compute
   * pipelines so the first real spawn doesn't stall. Respects `maxPoolPer`; if `count` is
   * higher, the pool is capped and the rest are discarded. Call this for prefabs you plan
   * to spawn in bursts (e.g. a wave of explosions) so the user doesn't see a compile hitch.
   */
  async preload(id: string, count = 1): Promise<void> {
    const input = this._prefabs.get(id);
    if (!input) throw new Error(`plume: prefab "${id}" not registered`);
    const pool = this._getPool(id);
    const target = Math.min(count, this.maxPoolPer);
    const warmups: Promise<void>[] = [];
    while (pool.length < target) {
      const sys = this._createSystem(input);
      warmups.push(sys.warmup(this.renderer));
      sys.hardStop();
      pool.push(sys);
    }
    await Promise.all(warmups);
  }

  /**
   * Pre-compile every registered prefab's compute kernels AND render pipelines against the
   * renderer. Call once after registering prefabs (and ideally before first user interaction)
   * so that the first real spawn doesn't stall on WGSL → MSL/HLSL translation. Heavy emitters
   * (especially `sortByDepth: true`) can otherwise cost multiple seconds on first play.
   *
   * Two pipeline classes to warm:
   *  1. Compute kernels (spawn/update/sort) — dispatched via `Emitter.warmup`.
   *  2. Render materials (sprite/mesh/ribbon) — compiled via `renderer.compileAsync(scene)`.
   *     We attach each warmed System's object3D to the scene temporarily so its materials
   *     are walked and pre-compiled, then detach afterward.
   */
  async warmup(): Promise<void> {
    if (!this.camera) {
      throw new Error(
        "plume: Manager.warmup() requires a camera — set it in the constructor or assign manager.camera before calling.",
      );
    }
    const warmSystems: Array<{ id: string; sys: System }> = [];
    for (const [id, input] of this._prefabs) {
      const sys = this._createSystem(input);
      warmSystems.push({ id, sys });
      this.scene.add(sys.object3D);
    }
    try {
      // Compile compute pipelines first so the storage buffers they allocate are ready for
      // the render pipelines to reference.
      await Promise.all(warmSystems.map(({ sys }) => sys.warmup(this.renderer)));
      // Force render pipeline compilation by bumping mesh count + issuing a real render.
      // Pure compileAsync isn't enough because three.js lazily specializes the pipeline based
      // on actual draw state; an invisible count=0 mesh isn't enough to force that path.
      const restore: Array<() => void> = [];
      for (const { sys } of warmSystems) {
        for (const em of sys.emitters) {
          const obj = em.render.object3D;
          const prevVisible = obj.visible;
          obj.visible = true;
          restore.push(() => {
            obj.visible = prevVisible;
          });
          obj.traverse((child) => {
            const maybeInstanced = child as unknown as { isInstancedMesh?: boolean; count?: number };
            if (maybeInstanced.isInstancedMesh && typeof maybeInstanced.count === "number") {
              const prevCount = maybeInstanced.count;
              maybeInstanced.count = 1;
              restore.push(() => {
                maybeInstanced.count = prevCount;
              });
            }
          });
        }
      }
      await this.renderer.compileAsync(this.scene, this.camera);
      // Use sync `render()` — `renderAsync()` was deprecated in three 0.184+. The renderer
      // must already be initialized (the Manager is handed a live WebGPURenderer by the caller,
      // who is expected to have awaited `renderer.init()` as part of setup).
      this.renderer.render(this.scene, this.camera);
      for (const fn of restore) fn();
    } finally {
      for (const { id, sys } of warmSystems) {
        sys.object3D.parent?.remove(sys.object3D);
        const pool = this._getPool(id);
        if (pool.length < this.maxPoolPer) pool.push(sys);
        else sys.dispose();
      }
    }
  }

  private _createSystem(input: SystemDefInput): System {
    const def = typeof input === "function" ? input() : input;
    return new System(def);
  }

  has(id: string): boolean {
    return this._prefabs.has(id);
  }

  /** Spawn a registered prefab. Returns the System or null if at capacity / unknown id. */
  spawn(id: string, options: SpawnOptions = {}): System | null {
    const input = this._prefabs.get(id);
    if (!input) return null;
    if (this._active.length >= this.maxActive) return null;

    const pool = this._getPool(id);
    const system = pool.pop() ?? this._createSystem(input);

    if (options.position)
      system.position.set(options.position.x, options.position.y, options.position.z);
    else system.position.set(0, 0, 0);

    if (options.quaternion) {
      system.quaternion.set(
        options.quaternion.x,
        options.quaternion.y,
        options.quaternion.z,
        options.quaternion.w,
      );
    } else {
      system.quaternion.identity();
    }

    if (options.scale !== undefined) {
      if (typeof options.scale === "number")
        system.scale.set(options.scale, options.scale, options.scale);
      else system.scale.set(options.scale.x, options.scale.y, options.scale.z);
    } else {
      system.scale.set(1, 1, 1);
    }

    system.setIntensity(options.intensity ?? 1);

    const parent = options.parent ?? this.scene;
    parent.add(system.object3D);

    system.play();
    this._active.push({ id, system, lod: options.lod });
    return system;
  }

  /**
   * Advance all active systems. Call once per frame before renderer.render().
   *
   * If `fixedTimestep` is set on construction, this accumulates `deltaTime` and dispatches
   * as many whole fixed-length steps as the accumulator allows — guaranteeing deterministic
   * output across framerate variation. Any remainder stays in the accumulator for next call.
   * If `fixedTimestep` is unset, the call delegates to `_stepOnce(deltaTime, ...)` as-is.
   */
  tick(deltaTime: number, camera?: THREE.Camera): void {
    const cam = camera ?? this.camera;
    const intensity = this.globalIntensity;
    if (this.fixedTimestep === undefined || this.fixedTimestep <= 0) {
      this._stepOnce(deltaTime, intensity, cam);
      return;
    }
    // Fixed-timestep path. Clamp to `maxAccumulatedTime` to avoid runaway catchup after a
    // long pause (e.g., backgrounded tab). Then drain the accumulator in whole steps.
    this._accum = Math.min(this._accum + deltaTime, this.maxAccumulatedTime);
    const step = this.fixedTimestep;
    while (this._accum >= step) {
      this._stepOnce(step, intensity, cam);
      this._accum -= step;
    }
  }

  /** Reset the fixed-timestep accumulator. Call after seeking/scrubbing to avoid step backlog. */
  resetClock(): void {
    this._accum = 0;
  }

  private _stepOnce(deltaTime: number, intensity: number, cam: THREE.Camera | undefined): void {
    // Rebuild frustum once per step from the camera — every system's bounding sphere tests
    // against this single frustum. `Frustum.setFromProjectionMatrix` wants
    // viewProjection = projection * viewInverse.
    let frustumReady = false;
    if (cam) {
      cam.updateMatrixWorld();
      this._frustumMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._frustumMatrix);
      cam.getWorldPosition(this._cameraWorldPos);
      frustumReady = true;
    }

    // Shared compute batch: every active system's emitter frame kernels collect into this
    // single array so we can fire one `renderer.computeAsync([...])` at the end — reduces
    // per-frame command-buffer submits from O(systems) to 1. Empty at start, flushed below.
    const batch: ComputeNode[] = this._batchBuffer;
    batch.length = 0;

    // Iterate backwards so we can splice completed entries
    for (let i = this._active.length - 1; i >= 0; i--) {
      const entry = this._active[i]!;
      const sys = entry.system;

      // LOD: compute intensity scale + visibility from distance and frustum. Systems without
      // a `lod` config just get `intensity` straight through and stay visible.
      let lodScale = 1;
      let visible = true;
      if (entry.lod && frustumReady) {
        sys.object3D.getWorldPosition(this._systemWorldPos);
        const dist = this._cameraWorldPos.distanceTo(this._systemWorldPos);
        const maxDist = entry.lod.maxDistance;
        if (maxDist !== undefined) {
          const fadeStart = entry.lod.farFadeStart ?? maxDist;
          if (dist >= maxDist) {
            lodScale = 0;
          } else if (dist > fadeStart && maxDist > fadeStart) {
            lodScale = 1 - (dist - fadeStart) / (maxDist - fadeStart);
          }
        }
        if (entry.lod.bounds !== undefined) {
          this._cullSphere.set(this._systemWorldPos, entry.lod.bounds);
          visible = this._frustum.intersectsSphere(this._cullSphere);
        }
      }
      sys.object3D.visible = visible;

      // Pass the shared batch so the emitters push their reset/update/spawn kernels into
      // it instead of dispatching. We flush once after the loop.
      sys.tick(this.renderer, deltaTime, intensity * lodScale, cam, batch);
      if (cam) sys.syncRender(cam, intensity * lodScale);

      if (!sys.isAlive()) {
        // Retire to pool
        sys.object3D.parent?.remove(sys.object3D);
        const pool = this._getPool(entry.id);
        if (pool.length < this.maxPoolPer) {
          pool.push(sys);
        } else {
          sys.dispose();
        }
        this._active.splice(i, 1);
      }
    }

    // Single GPU submit for every active system's frame kernels.
    if (batch.length > 0) void this.renderer.computeAsync(batch);
  }

  /** Hard-stop every active system and return them to the pool. */
  clear(): void {
    while (this._active.length > 0) {
      const entry = this._active.pop()!;
      entry.system.hardStop();
      entry.system.object3D.parent?.remove(entry.system.object3D);
      const pool = this._getPool(entry.id);
      if (pool.length < this.maxPoolPer) pool.push(entry.system);
      else entry.system.dispose();
    }
  }

  /** Dispose every system (pool + active) and release GPU resources. */
  dispose(): void {
    for (const e of this._active) e.system.dispose();
    this._active.length = 0;
    for (const pool of this._pool.values()) for (const s of pool) s.dispose();
    this._pool.clear();
  }

  private _getPool(id: string): System[] {
    let pool = this._pool.get(id);
    if (!pool) {
      pool = [];
      this._pool.set(id, pool);
    }
    return pool;
  }
}
