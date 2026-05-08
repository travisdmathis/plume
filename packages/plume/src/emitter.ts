import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";
import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import type { WebGPURenderer } from "three/webgpu";
import {
  If,
  Fn,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  float,
  hash,
  instancedArray,
  instanceIndex,
  uint,
  uniform,
  vec4,
} from "three/tsl";
import { BitonicSort } from "three/examples/jsm/gpgpu/BitonicSort.js";

import { ParticleBuffer, attr } from "./particle-buffer.js";
import { RNG } from "./math/rng.js";
import type { ScalarInput } from "./types.js";
import type {
  EmitterContext,
  EmitterSpawnModule,
  ParticleSpawnModule,
  ParticleUpdateModule,
  RenderContext,
  RenderModule,
  SpawnInitContext,
  UpdateContext,
} from "./modules/module.js";
import { SpawnFromEvents } from "./modules/spawn/spawn-from-events.js";

// `atomicLoad` / `atomicAdd` return `AtomicFunctionNode` (three's typing widens away the
// storage's element type). In practice the runtime result is whatever the storage holds;
// all our atomic buffers are `uint` so this narrowing is sound.
const asUint = (n: Node): Node<"uint"> => n as unknown as Node<"uint">;

// Depth-sort key layout: upper DEPTH_BITS = quantized inverted depth, lower SLOT_BITS = slot
// index. SLOT_BITS caps the maximum sortByDepth capacity; DEPTH_MAX_WORLD is the farthest
// world-space depth that can be distinguished. Both are conservative for typical VFX.
const SLOT_BITS = 10; // up to 1024 slots per emitter
const DEPTH_BITS = 22; // 4M quanta across [0, DEPTH_MAX_WORLD]
const DEPTH_MAX_WORLD = 1000; // world units — sorting precision degrades linearly past this

export interface EmitterEventConfig {
  /** Emit an event each time a particle dies (age reaches lifetime). */
  onDeath?: boolean;
  /** Max events per frame. Default 256. */
  capacity?: number;
}

export interface EmitterDef {
  name?: string;
  capacity: number;
  spawn: EmitterSpawnModule[];
  init: ParticleSpawnModule[];
  update: ParticleUpdateModule[];
  render: RenderModule;
  /** Optional event output configuration. Allocates an event buffer this emitter writes to. */
  events?: EmitterEventConfig;
  /**
   * If true, allocates sort-index storage and runs a bitonic GPU sort each frame, producing
   * back-to-front depth ordering for the renderer. Enable for alpha-blended emitters where
   * draw order matters. Adds ~log²(capacity)/2 compute dispatches per frame (~55 for N=1024).
   */
  sortByDepth?: boolean;
  seed?: number;
  duration?: number;
  loop?: boolean;
}

/**
 * A single particle-pipeline instance, backed entirely by GPU compute.
 *
 * When `events.onDeath` is set, the Emitter allocates an event buffer + atomic counter.
 * In the update kernel's kill branch, the dying particle's position is atomically appended.
 * Other emitters can consume these events via the `SpawnFromEvents` spawn module to trigger
 * chained effects (fireworks, explosions, debris, compound VFX).
 */
export class Emitter {
  readonly name?: string;
  readonly buffer: ParticleBuffer;
  readonly spawn: EmitterSpawnModule[];
  readonly init: ParticleSpawnModule[];
  readonly update: ParticleUpdateModule[];
  readonly render: RenderModule;
  readonly rng: RNG;
  readonly duration?: number;
  loop: boolean;

  // Per-tick uniforms
  readonly uDt: UniformNode<"float", number>;
  readonly uEmitterTime: UniformNode<"float", number>;
  readonly uIntensity: UniformNode<"float", number>;
  readonly uWorldMatrix: UniformNode<"mat4", THREE.Matrix4>;
  readonly uSpawnCount: UniformNode<"float", number>;
  readonly uSpawnBase: UniformNode<"float", number>;
  readonly uSeedBase: UniformNode<"float", number>;

  // Event output (optional — only when `events.onDeath` is true)
  readonly eventCapacity: number;
  readonly eventBuffer?: StorageBufferNode<"vec4">;
  readonly eventCounter?: StorageBufferNode<"uint">;
  private _writeDeathEvents: boolean;
  private _resetEventKernel?: ComputeNode;

  // Event input (optional — only when spawn modules include SpawnFromEvents)
  private _eventSource?: Emitter;
  private _eventPerTrigger = 1;

  // Depth sort (optional — only when `sortByDepth` is true).
  //
  // Uses three.js's ships-with-the-library `BitonicSort` (examples/jsm/gpgpu/BitonicSort.js).
  // That helper sorts a scalar storage buffer in place (ascending, via min/max per step).
  //
  // To sort slot indices by depth we pack each slot's `(invertedDepth, slotIndex)` into a
  // single uint32: the upper `DEPTH_BITS` bits hold inverted-quantized depth (so larger
  // world-depth → smaller uint → sorted-first = drawn-first = back-to-front), and the lower
  // `SLOT_BITS` bits hold the original slot index. Dead slots get key = 0xFFFFFFFF so they
  // sort to the end.
  //
  // Rendering reads `sortKeys[instanceIndex] & SLOT_MASK` to recover the particle's storage
  // slot for draw order `instanceIndex`.
  private _sortEnabled: boolean;
  private _sortIndices?: StorageBufferNode<"uint">; // ALIAS of `_sortKeys` — sprite-renderer uses this name
  private _sortKeys?: StorageBufferNode<"uint">;
  private _sortKeyKernel?: ComputeNode;
  private _sortEngine?: BitonicSort<"uint">;
  private _uCameraView?: UniformNode<"mat4", THREE.Matrix4>;

  private _emitterTime = 0;
  private _playing = true;
  private _spawning = true;
  private _ringHead = 0;
  private _aliveHighWater = 0;
  private _seeded = false;
  private readonly _initialSeed: number;
  private readonly _retireTailSeconds: number;
  private _spawnKernel: ComputeNode;
  private _updateKernel: ComputeNode;

  constructor(def: EmitterDef) {
    this.name = def.name;
    this.buffer = new ParticleBuffer(def.capacity);
    this.spawn = def.spawn;
    this.init = def.init;
    this.update = def.update;
    this.render = def.render;
    // If `def.seed` is provided, the Emitter is fully deterministic: the CPU-side RNG seeds
    // spawn-module decisions AND feeds the per-spawn GPU seed uniform below. If omitted, we
    // fall back to `Math.random()` for the seed so separate instances of the same prefab
    // don't correlate visually.
    this._initialSeed = def.seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.rng = new RNG(this._initialSeed);
    this._seeded = def.seed !== undefined;
    this.duration = def.duration;
    this.loop = def.loop ?? false;
    this._retireTailSeconds = estimateMaxLifetime(def.init);

    // Uniforms
    this.uDt = uniform(0) as UniformNode<"float", number>;
    this.uEmitterTime = uniform(0) as UniformNode<"float", number>;
    this.uIntensity = uniform(1) as UniformNode<"float", number>;
    this.uWorldMatrix = uniform(new THREE.Matrix4()) as UniformNode<"mat4", THREE.Matrix4>;
    this.uSpawnCount = uniform(0) as UniformNode<"float", number>;
    this.uSpawnBase = uniform(0) as UniformNode<"float", number>;
    this.uSeedBase = uniform(0) as UniformNode<"float", number>;

    // Event output setup
    this.eventCapacity = def.events?.capacity ?? 256;
    this._writeDeathEvents = def.events?.onDeath ?? false;
    if (this._writeDeathEvents) {
      this.eventBuffer = instancedArray(this.eventCapacity, "vec4");
      this.eventCounter = instancedArray(1, "uint").toAtomic();
      this._resetEventKernel = this._buildResetEventKernel();
    }

    // Detect event source from spawn modules. When `SpawnFromEvents` was constructed
    // with a string name (deferred cross-emitter reference), `sm.source` is undefined
    // here — it gets populated later by `System.resolveSource()`. In that case the
    // spawn kernel built below picks the non-event branch; `finalizeWiring()` rebuilds
    // it once the System resolves the name.
    for (const sm of this.spawn) {
      if (sm instanceof SpawnFromEvents && sm.source) {
        this._eventSource = sm.source;
        this._eventPerTrigger = sm.perEvent;
        break;
      }
    }

    // Depth-sort setup
    this._sortEnabled = def.sortByDepth ?? false;
    if (this._sortEnabled) {
      if ((def.capacity & (def.capacity - 1)) !== 0) {
        throw new Error(
          `plume: sortByDepth requires a power-of-two capacity (got ${def.capacity})`,
        );
      }
      if (def.capacity > 1 << SLOT_BITS) {
        throw new Error(
          `plume: sortByDepth supports capacity ≤ ${1 << SLOT_BITS} (got ${def.capacity})`,
        );
      }
      this._sortKeys = instancedArray(def.capacity, "uint");
      this._sortIndices = this._sortKeys; // renderer reads the same buffer; it masks lower bits
      this._uCameraView = uniform(new THREE.Matrix4()) as UniformNode<"mat4", THREE.Matrix4>;
      this._sortKeyKernel = this._buildSortKeyKernel();
      // BitonicSort is lazy-constructed on first tick because its constructor needs a live
      // renderer; storing one early would couple Emitter construction to rendering context.
    }

    this._spawnKernel = this._buildSpawnKernel();
    this._updateKernel = this._buildUpdateKernel();

    this.render.init?.(this.buffer.storage, this.buffer.capacity, {
      sortIndices: this._sortIndices,
    });
  }

  /**
   * Re-resolves cross-emitter event-source references and rebuilds the spawn kernel
   * if any deferred name (string source for `SpawnFromEvents`) was resolved after
   * construction. Called by `System` once every emitter has been built and
   * `resolveSource()` has run on each spawn module. No-op when sources were already
   * supplied as direct `Emitter` instances.
   */
  finalizeWiring(): void {
    for (const sm of this.spawn) {
      if (sm instanceof SpawnFromEvents && sm.source && this._eventSource !== sm.source) {
        this._eventSource = sm.source;
        this._eventPerTrigger = sm.perEvent;
        this._spawnKernel = this._buildSpawnKernel();
        return;
      }
    }
  }

  setFollowPosition(position: THREE.Vector3, hasFollow: boolean): void {
    for (const m of this.update) {
      const follower = m as unknown as {
        setFollowPosition?: (position: THREE.Vector3, hasFollow: boolean) => void;
      };
      follower.setFollowPosition?.(position, hasFollow);
    }
    this.render.setFollowPosition?.(position, hasFollow);
  }

  play(): void {
    this._emitterTime = 0;
    this._playing = true;
    this._spawning = true;
    this._ringHead = 0;
    this._aliveHighWater = 0;
    this.render.reset?.();
    // For seeded emitters, reset the RNG to its initial seed so every play() produces the
    // same particle stream given the same tick cadence. For non-seeded emitters, leave the
    // RNG state as-is so pooled instances don't repeat across respawns.
    if (this._seeded) this.rng.reseed(this._initialSeed);
    for (const s of this.spawn) s.reset?.();
  }

  stopSpawning(): void {
    this._spawning = false;
  }

  hardStop(): void {
    this._spawning = false;
    this._playing = false;
    this._aliveHighWater = 0;
    this.render.reset?.();
  }

  isAlive(): boolean {
    return this._playing;
  }

  /**
   * Pre-compile all compute kernels for this emitter. Dispatches each kernel once against
   * the (currently all-dead) particle storage — the work is harmless but forces the WebGPU
   * backend to translate WGSL → MSL/HLSL and build pipelines.
   *
   * Call once per prefab via `Manager.preload()` (or ambiently on first use). Without this,
   * the first real use of an Emitter pays the full shader-compilation cost up front —
   * typically frames-to-seconds depending on kernel complexity (bitonic sort especially).
   */
  warmup(renderer: WebGPURenderer): Promise<void> {
    const kernels: ComputeNode[] = [];
    this._updateKernel.count = 1;
    kernels.push(this._updateKernel);
    // Spawn kernel needs the uniform count ≥ 1 to not short-circuit; set it so the kernel
    // runs through its full body.
    this.uSpawnCount.value = 1;
    this.uSpawnBase.value = 0;
    this.uSeedBase.value = 0;
    this._spawnKernel.count = 1;
    kernels.push(this._spawnKernel);
    if (this._sortKeyKernel) {
      this._sortKeyKernel.count = this.buffer.capacity;
      kernels.push(this._sortKeyKernel);
    }
    if (this._resetEventKernel) kernels.push(this._resetEventKernel);
    // Fire all kernels as one batch; resolve when the GPU finishes. The work is discarded —
    // we hardStop() and zero out state afterward so no live particles leak from warmup.
    const promise = renderer.computeAsync(kernels);
    this._aliveHighWater = 0;
    this._ringHead = 0;
    this._playing = false;
    this._spawning = false;
    return Promise.resolve(promise);
  }

  tick(
    renderer: WebGPURenderer,
    deltaTime: number,
    worldMatrix: THREE.Matrix4,
    intensity: number,
    camera?: THREE.Camera,
    /**
     * Optional shared compute batch. When provided, this emitter's frame kernels (reset/update
     * /spawn) are pushed into it instead of dispatched immediately — the caller (Manager) is
     * responsible for `renderer.computeAsync(batch)` at the end of the tick. This cuts per-frame
     * command-buffer submits from O(emitters) down to 1 when ticking many systems.
     *
     * postUpdate (ribbon/light-emission) and sort dispatches stay out-of-batch because they
     * depend on conditional internal state the outer caller can't observe.
     */
    batch?: ComputeNode[],
  ): void {
    if (!this._playing) return;

    const prevTime = this._emitterTime;
    this._emitterTime += deltaTime;

    if (this.duration !== undefined && prevTime >= this.duration) {
      if (this.loop) {
        this._emitterTime = this._emitterTime % this.duration;
        for (const s of this.spawn) s.reset?.();
      } else {
        this._spawning = false;
      }
    }

    this.uDt.value = deltaTime;
    this.uEmitterTime.value = this._emitterTime;
    this.uIntensity.value = intensity;
    this.uWorldMatrix.value.copy(worldMatrix);

    // Fire per-module beforeUpdate hooks so modules that need per-frame uniform sync
    // (e.g. camera matrices for depth-buffer collision) can refresh before the kernel runs.
    for (const m of this.update) m.beforeUpdate?.(deltaTime, camera);

    // Collect reset/update/spawn kernels into the caller's batch if one was passed, or a
    // local batch otherwise. Order within the batch matters: reset → update → spawn.
    const ownsBatch = batch === undefined;
    const dispatch = ownsBatch ? ([] as ComputeNode[]) : batch!;

    // Reset event counter BEFORE update so new events are counted from zero this frame.
    if (this._resetEventKernel) dispatch.push(this._resetEventKernel);

    // Update pass
    if (this._aliveHighWater > 0) {
      this._updateKernel.count = this._aliveHighWater;
      dispatch.push(this._updateKernel);
    }

    // Spawn pass
    if (this._spawning) {
      const ctx: EmitterContext = {
        rng: this.rng,
        deltaTime,
        emitterTime: this._emitterTime,
        intensity,
      };
      let requested = 0;
      for (const s of this.spawn) requested += s.requestSpawn(ctx);
      const spawnCount = Math.min(requested, this.buffer.capacity);

      if (spawnCount > 0) {
        this.uSpawnCount.value = spawnCount;
        this.uSpawnBase.value = this._ringHead;
        this.uSeedBase.value = this.rng.u32();
        this._ringHead = (this._ringHead + spawnCount) % this.buffer.capacity;
        if (this._aliveHighWater < this.buffer.capacity) {
          this._aliveHighWater = Math.min(this._aliveHighWater + spawnCount, this.buffer.capacity);
        }

        this._spawnKernel.count = spawnCount;
        dispatch.push(this._spawnKernel);
      }
    }

    // If we own the batch (no caller-provided one), fire it now. When a render module has
    // post-update work (ribbon history, light readback), flush the shared batch before that
    // hook too so it observes the just-updated particle state instead of the previous frame.
    if (this.render.postUpdate && this._aliveHighWater > 0 && !ownsBatch && dispatch.length > 0) {
      const prePostUpdate = dispatch.slice();
      dispatch.length = 0;
      void renderer.computeAsync(prePostUpdate);
    } else if (ownsBatch && dispatch.length > 0) {
      void renderer.computeAsync(dispatch);
    }

    // Post-update hook for render modules that need per-frame compute work (e.g., ribbons).
    // These own their own `computeAsync` call because they dispatch conditionally on internal
    // state (history head, readback readiness) that the emitter can't observe.
    if (this.render.postUpdate && this._aliveHighWater > 0) {
      this.render.postUpdate(renderer, this._aliveHighWater, deltaTime, this._emitterTime);
    }

    // Depth-sort pass — runs after all state updates, before render draws this frame.
    // BitonicSort.compute() internally chains its own kernels so it stays standalone.
    if (this._sortEnabled && this._aliveHighWater > 0 && camera && this._uCameraView) {
      camera.updateMatrixWorld();
      this._uCameraView.value.copy(camera.matrixWorldInverse);
      this._dispatchSort(renderer);
    }

    if (!this._spawning && this.duration !== undefined && !this.loop) {
      if (this._emitterTime > this.duration + this._retireTailSeconds) {
        this._playing = false;
      }
    }
  }

  syncRender(ctx: RenderContext): void {
    this.render.updateRender(this._aliveHighWater, ctx);
  }

  dispose(): void {
    this.render.dispose();
  }

  // ─ Kernel builders ──────────────────────────────────────────────────────

  private _dispatchSort(renderer: WebGPURenderer): void {
    if (!this._sortKeyKernel || !this._sortKeys) return;
    // Lazy-init the sort engine on first call — we need a live renderer.
    if (!this._sortEngine) {
      this._sortEngine = new BitonicSort<"uint">(renderer, this._sortKeys);
    }
    this._sortKeyKernel.count = this.buffer.capacity;
    void renderer.computeAsync(this._sortKeyKernel);
    void this._sortEngine.compute(renderer);
  }

  /**
   * Build the compute kernel that packs per-slot depth + slot-index into a single uint32
   * and writes it into `_sortKeys`. After this kernel runs, `BitonicSort.compute()` sorts
   * the buffer ascending — the lower `SLOT_BITS` bits of each sorted element then name the
   * particle slot that should draw at that position.
   */
  private _buildSortKeyKernel(): ComputeNode {
    const storage = this.buffer.storage;
    const sortKeys = this._sortKeys!;
    const uCamView = this._uCameraView!;

    const SLOT_MASK = (1 << SLOT_BITS) - 1;
    const DEPTH_MAX_Q = (1 << DEPTH_BITS) - 1;
    const depthScale = DEPTH_MAX_Q / DEPTH_MAX_WORLD;

    return Fn(() => {
      const i = instanceIndex.toInt();
      const pos = attr.position.read(storage, i);
      const alive = attr.alive.read(storage, i);
      const viewPos = uCamView.mul(vec4(pos, 1.0));
      const depth = viewPos.z.negate(); // +Z forward in view space → depth positive in front
      const depthQ = clamp(depth.mul(depthScale), float(0), float(DEPTH_MAX_Q)).toUint();
      const depthInv = uint(DEPTH_MAX_Q).sub(depthQ); // invert: larger world depth → smaller key → drawn first
      const slot = instanceIndex.bitAnd(uint(SLOT_MASK));
      const liveKey = depthInv.shiftLeft(uint(SLOT_BITS)).bitOr(slot);
      const deadKey = uint(0xffffffff);
      const key = alive.greaterThanEqual(0.5).select(liveKey, deadKey);
      sortKeys.element(i).assign(key);
    })().compute(this.buffer.capacity);
  }

  private _buildResetEventKernel(): ComputeNode {
    const counter = this.eventCounter!;
    return Fn(() => {
      atomicStore(counter.element(0), 0);
    })().compute(1);
  }

  private _buildSpawnKernel(): ComputeNode {
    const storage = this.buffer.storage;
    const uSpawnCount = this.uSpawnCount;
    const uSpawnBase = this.uSpawnBase;
    const uSeedBase = this.uSeedBase;
    const eventSource = this._eventSource;
    const perTrigger = this._eventPerTrigger;
    const initModules = this.init;
    const uniforms = {
      worldMatrix: this.uWorldMatrix,
      emitterTime: this.uEmitterTime,
      intensity: this.uIntensity,
    };

    return Fn(() => {
      const t = instanceIndex;
      const tFloat = float(t);
      If(tFloat.lessThan(uSpawnCount), () => {
        const slotF = uSpawnBase.add(tFloat).mod(float(this.buffer.capacity));
        const slotI = slotF.toInt().toVar();

        const rawMix = uSeedBase.add(tFloat.mul(7919.17));
        const seed = hash(rawMix).mul(1_000_000).toVar();

        const ctx: SpawnInitContext = {
          storage,
          slot: slotI,
          seed,
          worldMatrix: uniforms.worldMatrix,
          emitterTime: uniforms.emitterTime,
          intensity: uniforms.intensity,
        };

        const initSlot = (eventPos: Node<"vec3"> | null): void => {
          attr.alive.write(storage, slotI, float(1));
          attr.age.write(storage, slotI, float(0));
          if (eventPos) attr.position.write(storage, slotI, eventPos);
          for (const m of initModules) m.contributeSpawnTSL(ctx);
          attr.initialColor.write(storage, slotI, attr.color.read(storage, slotI));
          attr.initialVelocity.write(storage, slotI, attr.velocity.read(storage, slotI));
          attr.initialSize.write(storage, slotI, attr.size.read(storage, slotI));
        };

        if (eventSource?.eventBuffer && eventSource.eventCounter) {
          // Event-driven spawn: each thread maps to event index `floor(threadIdx / perTrigger)`.
          // Threads whose event index >= the source's event count do NOTHING — leave the slot
          // untouched so still-alive particles at these ring-buffer indices aren't clobbered.
          const eventIdx = tFloat.div(float(perTrigger)).floor();
          const eventCountF = float(asUint(atomicLoad(eventSource.eventCounter.element(0))));
          const eventValidF = eventIdx.lessThan(eventCountF);
          const eventRecord = eventSource.eventBuffer.element(eventIdx.toInt()).xyz;

          If(eventValidF, () => {
            initSlot(eventRecord);
          });
        } else {
          // Non-event spawn (SpawnRate / SpawnBurst): every thread in range initializes.
          initSlot(null);
        }
      });
    })().compute(this.buffer.capacity);
  }

  private _buildUpdateKernel(): ComputeNode {
    const storage = this.buffer.storage;
    const uDt = this.uDt;
    const updateModules = this.update;
    const uniforms = {
      dt: this.uDt,
      emitterTime: this.uEmitterTime,
      intensity: this.uIntensity,
      worldMatrix: this.uWorldMatrix,
    };
    const writeDeathEvents = this._writeDeathEvents;
    const eventBuffer = this.eventBuffer;
    const eventCounter = this.eventCounter;
    const eventCapacity = this.eventCapacity;

    return Fn(() => {
      const i = instanceIndex.toInt();
      const aliveFlag = attr.alive.read(storage, i).toVar();

      If(aliveFlag.greaterThanEqual(0.5), () => {
        const curAge = attr.age.read(storage, i);
        const newAge = curAge.add(uDt).toVar();
        const life = attr.lifetime.read(storage, i);
        If(newAge.greaterThanEqual(life), () => {
          // Death event output: append this particle's position to the event buffer
          // atomically. Out-of-capacity events are dropped (counter advances but no write).
          if (writeDeathEvents && eventBuffer && eventCounter) {
            const pos = attr.position.read(storage, i);
            const prevCountU = asUint(atomicAdd(eventCounter.element(0), 1));
            const prevCountI = prevCountU.toInt();
            const prevCountF = float(prevCountU);
            If(prevCountF.lessThan(float(eventCapacity)), () => {
              eventBuffer.element(prevCountI).assign(vec4(pos, 1));
            });
          }
          attr.alive.write(storage, i, float(0));
        }).Else(() => {
          attr.age.write(storage, i, newAge);

          const ctx: UpdateContext = {
            storage,
            i,
            dt: uniforms.dt,
            emitterTime: uniforms.emitterTime,
            intensity: uniforms.intensity,
            worldMatrix: this.uWorldMatrix,
          };
          for (const m of updateModules) m.contributeUpdateTSL(ctx);

          // Post-module death-event check: modules (e.g. DepthCollision in "kill" mode)
          // can zero `alive` to retire a particle mid-update. Emit a death event for those
          // too so downstream `SpawnFromEvents` listeners fire on any cause of death, not
          // just age-based expiration.
          if (writeDeathEvents && eventBuffer && eventCounter) {
            const postAlive = attr.alive.read(storage, i);
            If(postAlive.lessThan(0.5), () => {
              const pos = attr.position.read(storage, i);
              const prevCountU = asUint(atomicAdd(eventCounter.element(0), 1));
              const prevCountI = prevCountU.toInt();
              const prevCountF = float(prevCountU);
              If(prevCountF.lessThan(float(eventCapacity)), () => {
                eventBuffer.element(prevCountI).assign(vec4(pos, 1));
              });
            });
          }
        });
      });
    })().compute(this.buffer.capacity);
  }
}

function estimateMaxLifetime(initModules: ParticleSpawnModule[]): number {
  for (const mod of initModules) {
    if (mod.type !== "init.lifetime") continue;
    const lifetime = (mod as unknown as { lifetime?: ScalarInput }).lifetime;
    if (!lifetime) continue;
    return Math.max(0.05, maxScalarInput(lifetime) + 0.1);
  }
  return 5;
}

function maxScalarInput(input: ScalarInput): number {
  switch (input.kind) {
    case "constant":
      return input.value;
    case "range":
      return input.max;
    case "list":
      return input.values.length > 0 ? Math.max(...input.values) : 0;
  }
}
