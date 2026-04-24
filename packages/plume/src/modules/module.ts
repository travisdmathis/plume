import type * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import type { ParticleStorage } from "../particle-buffer.js";
import type { RNG } from "../math/rng.js";

/** JSON form of a serialized module. Includes `type` for registry lookup. */
export interface ModuleJSON {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/** Per-tick context passed to CPU-side emitter-spawn modules (SpawnRate, SpawnBurst). */
export interface EmitterContext {
  rng: RNG;
  deltaTime: number;
  emitterTime: number;
  intensity: number;
}

/** TSL context for the spawn compute kernel — populated by the Emitter at kernel-build time. */
export interface SpawnInitContext {
  storage: ParticleStorage;
  /** Int node: the slot index being initialized (0..capacity-1). */
  slot: Node<"int">;
  /** Float node: per-slot deterministic seed for RNG sampling. */
  seed: Node<"float">;
  /** mat4 uniform: emitter world transform. */
  worldMatrix: UniformNode<"mat4", THREE.Matrix4>;
  emitterTime: UniformNode<"float", number>;
  intensity: UniformNode<"float", number>;
}

/** TSL context for the update compute kernel. */
export interface UpdateContext {
  storage: ParticleStorage;
  /** Int node: the instance being updated. */
  i: Node<"int">;
  dt: UniformNode<"float", number>;
  emitterTime: UniformNode<"float", number>;
  intensity: UniformNode<"float", number>;
  /** Emitter world transform — same uniform as the spawn kernel sees. */
  worldMatrix: UniformNode<"mat4", THREE.Matrix4>;
}

export interface RenderContext {
  camera: THREE.Camera;
  worldMatrix: THREE.Matrix4;
  intensity: number;
}

export type ModuleKind = "emitter_spawn" | "particle_spawn" | "particle_update" | "render";

interface ModuleBase {
  readonly kind: ModuleKind;
  readonly type: string;
  readonly id?: string;
  toJSON(): ModuleJSON;
}

/** CPU-side: decides how many particles to spawn this tick. */
export interface EmitterSpawnModule extends ModuleBase {
  readonly kind: "emitter_spawn";
  requestSpawn(ctx: EmitterContext): number;
  reset?(): void;
}

/** TSL-emitting: contributes code to the spawn compute kernel that initializes a new particle. */
export interface ParticleSpawnModule extends ModuleBase {
  readonly kind: "particle_spawn";
  contributeSpawnTSL(ctx: SpawnInitContext): void;
}

/** TSL-emitting: contributes code to the update compute kernel run per live particle each frame. */
export interface ParticleUpdateModule extends ModuleBase {
  readonly kind: "particle_update";
  contributeUpdateTSL(ctx: UpdateContext): void;
  /**
   * Optional per-frame hook fired by the Emitter before its update kernel dispatches.
   * Modules that need per-frame uniform updates (e.g. camera matrices for depth-buffer
   * collision) implement this to sync CPU state → GPU uniform. `camera` is the camera the
   * Manager is rendering with, or `undefined` if none was supplied to the tick.
   */
  beforeUpdate?(dt: number, camera?: THREE.Camera): void;
}

/**
 * Options passed to `RenderModule.init` by the Emitter. Lets the renderer opt into
 * Emitter-owned auxiliary buffers when they exist.
 */
export interface RenderInitOptions {
  /**
   * If the Emitter has `sortByDepth` enabled, this is a storage buffer of uint indices
   * [0, capacity) sorted back-to-front by view-space depth each frame. Sort-aware renderers
   * (SpriteRenderer) map `instanceIndex → sortIndices[instanceIndex]` to read particles in
   * depth-correct draw order.
   */
  sortIndices?: import("three/src/nodes/accessors/StorageBufferNode.js").default<"uint">;
}

/** Owns a Three.js Object3D that renders particles by reading the ParticleStorage. */
export interface RenderModule extends ModuleBase {
  readonly kind: "render";
  readonly object3D: THREE.Object3D;
  init?(storage: ParticleStorage, capacity: number, opts?: RenderInitOptions): void;
  updateRender(liveCount: number, ctx: RenderContext): void;
  /**
   * Optional compute dispatch called by the Emitter after its main update + spawn kernels.
   * Used by renderers that need per-frame compute work — e.g., `RibbonRenderer` captures each
   * alive particle's current position into a per-slot history buffer.
   */
  postUpdate?(renderer: import("three/webgpu").WebGPURenderer, liveCount: number): void;
  dispose(): void;
}

export type Module =
  | EmitterSpawnModule
  | ParticleSpawnModule
  | ParticleUpdateModule
  | RenderModule;

export interface ModuleFactory {
  readonly type: string;
  fromJSON(data: ModuleJSON): Module;
}
