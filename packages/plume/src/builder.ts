/**
 * Fluent authoring API — sugar on top of `SystemDef` / `EmitterDef` and the module classes.
 *
 * Two entry points:
 *  - `system(name?)` → `SystemBuilder` for defining a full VFX system.
 *  - `emitter(name?)` → `EmitterBuilder` for defining one emitter in isolation.
 *
 * Both builders are chainable; call `.build()` to produce a plain `SystemDef` / `EmitterDef`.
 * Nothing is bundled — the builder just collects modules in call order and hands them off to
 * the same structures the class-based API uses. JSON serialization, the registry, everything
 * downstream still works unchanged.
 *
 * Example:
 * ```ts
 * const def = system("smoke")
 *   .duration(2)
 *   .emitter("puff", (e) =>
 *     e.capacity(128)
 *       .spawnRate(25)
 *       .lifetime({ min: 1.8, max: 2.8 })
 *       .position({ shape: { kind: "sphere", radius: 0.08 } })
 *       .velocity({ shape: { kind: "cone", angle: 0.18 * Math.PI }, speed: { min: 0.3, max: 1 } })
 *       .size({ min: 0.35, max: 0.7 })
 *       .color({ min: [0.65, 0.65, 0.68], max: [0.85, 0.85, 0.9] }, { alpha: 0.35 })
 *       .integrate()
 *       .drag(0.4)
 *       .gravity([0, 0.5, 0])
 *       .sizeOverLife([[0, 0.8], [0.5, 1.4], [1, 2.0]])
 *       .alphaOverLife([[0, 0], [0.2, 1], [1, 0]])
 *       .lifetimeTick()
 *       .renderSprite({ blending: "alpha", opacity: 0.9, depthWrite: false }),
 *   )
 *   .build();
 * ```
 */

import { Curve1D, type CurveKeyframe } from "./math/curve.js";
import { Gradient, type GradientStop } from "./math/gradient.js";
import type { EmissionShape } from "./math/shapes.js";
import type {
  ColorInput,
  ColorRGBATuple,
  ColorTuple,
  ScalarInput,
  Vec3Input,
  Vec3Tuple,
} from "./types.js";
import type { EmitterDef, EmitterEventConfig } from "./emitter.js";
import type { SystemDef } from "./system.js";
import type {
  EmitterSpawnModule,
  ParticleSpawnModule,
  ParticleUpdateModule,
  RenderModule,
} from "./modules/module.js";
import type { Emitter } from "./emitter.js";

// Spawn modules
import { SpawnRate } from "./modules/spawn/spawn-rate.js";
import { SpawnBurst, type SpawnBurstEntry } from "./modules/spawn/spawn-burst.js";
import { SpawnFromEvents } from "./modules/spawn/spawn-from-events.js";

// Init modules
import { InitColor } from "./modules/init/init-color.js";
import { InitFromMesh, type InitFromMeshParams } from "./modules/init/init-from-mesh.js";
import { InitLifetime } from "./modules/init/init-lifetime.js";
import { InitPosition } from "./modules/init/init-position.js";
import { InitRotation } from "./modules/init/init-rotation.js";
import { InitSize } from "./modules/init/init-size.js";
import { InitVelocity } from "./modules/init/init-velocity.js";

// Update modules
import { AlphaOverLife } from "./modules/update/alpha-over-life.js";
import { ColorOverLife } from "./modules/update/color-over-life.js";
import { CurlNoiseForce, type CurlNoiseForceParams } from "./modules/update/curl-noise-force.js";
import {
  DepthCollision,
  type DepthCollisionParams,
} from "./modules/update/depth-collision.js";
import { SdfCollision, type SdfCollisionParams } from "./modules/update/sdf-collision.js";
import { Drag } from "./modules/update/drag.js";
import { Gravity } from "./modules/update/gravity.js";
import { LifetimeTick } from "./modules/update/lifetime-tick.js";
import { LimitVelocity, type LimitVelocityParams } from "./modules/update/limit-velocity.js";
import { PlaneCollision, type PlaneCollisionParams } from "./modules/update/plane-collision.js";
import { PointAttractor, type PointAttractorParams } from "./modules/update/point-attractor.js";
import { ScaleBySpeed, type ScaleBySpeedParams } from "./modules/update/scale-by-speed.js";
import { SizeOverLife } from "./modules/update/size-over-life.js";
import { SphereCollision, type SphereCollisionParams } from "./modules/update/sphere-collision.js";
import { TurbulenceForce, type TurbulenceForceParams } from "./modules/update/turbulence-force.js";
import { VelocityIntegrator } from "./modules/update/velocity-integrator.js";
import { VelocityOverLife } from "./modules/update/velocity-over-life.js";
import { VortexForce, type VortexForceParams } from "./modules/update/vortex-force.js";

// Render modules
import { BeamRenderer, type BeamRendererParams } from "./modules/render/beam-renderer.js";
import { LightEmission, type LightEmissionParams } from "./modules/render/light-emission.js";
import { MeshRenderer, type MeshRendererParams } from "./modules/render/mesh-renderer.js";
import { RibbonRenderer, type RibbonRendererParams } from "./modules/render/ribbon-renderer.js";
import { SpriteRenderer, type SpriteRendererParams } from "./modules/render/sprite-renderer.js";

// ─ Input shorthand helpers ──────────────────────────────────────────────────

/** Accepts a plain number, a `{min, max}` range, or a full `ScalarInput`. */
export type ScalarLike = number | { min: number; max: number } | ScalarInput;
/** Accepts a tuple, a min/max range of tuples, or a full `Vec3Input`. */
export type Vec3Like = Vec3Tuple | { min: Vec3Tuple; max: Vec3Tuple } | Vec3Input;
/** Accepts a 3-tuple, a min/max range, or a full `ColorInput`. */
export type ColorLike = ColorTuple | { min: ColorTuple; max: ColorTuple } | ColorInput;
/**
 * Curve input. Accepts:
 *  - an existing `Curve1D`
 *  - a plain number (becomes a constant)
 *  - an array of `[t, v]` pairs (e.g. `[[0, 0.5], [1, 1]]`)
 *  - an array of `{t, v}` keyframes
 */
export type CurveLike = Curve1D | number | [number, number][] | CurveKeyframe[];
/** Gradient input. Accepts an existing `Gradient` or an array of stops. */
export type GradientLike = Gradient | GradientStop[];

function isScalarInput(v: unknown): v is ScalarInput {
  return typeof v === "object" && v !== null && "kind" in v;
}
function isVec3Input(v: unknown): v is Vec3Input {
  return typeof v === "object" && v !== null && "kind" in v;
}
function isColorInput(v: unknown): v is ColorInput {
  return typeof v === "object" && v !== null && "kind" in v;
}

export function toScalarInput(input: ScalarLike): ScalarInput {
  if (typeof input === "number") return { kind: "constant", value: input };
  if (isScalarInput(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}

export function toVec3Input(input: Vec3Like): Vec3Input {
  if (Array.isArray(input)) return { kind: "constant", value: input };
  if (isVec3Input(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}

export function toColorInput(input: ColorLike): ColorInput {
  if (Array.isArray(input)) return { kind: "constant", value: input };
  if (isColorInput(input)) return input;
  return { kind: "range", min: input.min, max: input.max };
}

export function toCurve(input: CurveLike): Curve1D {
  if (input instanceof Curve1D) return input;
  if (typeof input === "number") return Curve1D.constant(input);
  if (input.length === 0) throw new Error("plume: curve input must have at least one keyframe");
  // Detect tuple-form `[t, v][]` vs keyframe-form `{t, v}[]`.
  const first = input[0]!;
  if (Array.isArray(first)) {
    const tuples = input as [number, number][];
    return new Curve1D(tuples.map(([t, v]) => ({ t, v })));
  }
  return new Curve1D(input as CurveKeyframe[]);
}

export function toGradient(input: GradientLike): Gradient {
  if (input instanceof Gradient) return input;
  return new Gradient(input);
}

// ─ Emitter builder ──────────────────────────────────────────────────────────

export class EmitterBuilder {
  private _name?: string;
  private _capacity = 256;
  private _duration?: number;
  private _loop?: boolean;
  private _seed?: number;
  private _sortByDepth = false;
  private _events?: EmitterEventConfig;
  private _spawn: EmitterSpawnModule[] = [];
  private _init: ParticleSpawnModule[] = [];
  private _update: ParticleUpdateModule[] = [];
  private _render?: RenderModule;

  constructor(name?: string) {
    this._name = name;
  }

  // ─ Emitter-level ─
  name(value: string): this {
    this._name = value;
    return this;
  }
  capacity(value: number): this {
    this._capacity = value;
    return this;
  }
  duration(seconds: number): this {
    this._duration = seconds;
    return this;
  }
  loop(value = true): this {
    this._loop = value;
    return this;
  }
  seed(value: number): this {
    this._seed = value;
    return this;
  }
  sortByDepth(value = true): this {
    this._sortByDepth = value;
    return this;
  }
  emitEvents(config: EmitterEventConfig = { onDeath: true }): this {
    this._events = config;
    return this;
  }

  // ─ Spawn ─
  spawnRate(rate: number): this {
    this._spawn.push(new SpawnRate({ rate }));
    return this;
  }
  spawnBurst(bursts: SpawnBurstEntry | SpawnBurstEntry[]): this {
    this._spawn.push(new SpawnBurst({ bursts: Array.isArray(bursts) ? bursts : [bursts] }));
    return this;
  }
  spawnFromEvents(source: Emitter, perEvent = 1, maxEventsPerFrame?: number): this {
    this._spawn.push(new SpawnFromEvents({ source, perEvent, maxEventsPerFrame }));
    return this;
  }

  // ─ Init ─
  lifetime(input: ScalarLike): this {
    this._init.push(new InitLifetime({ lifetime: toScalarInput(input) }));
    return this;
  }
  position(params: { shape: EmissionShape; worldSpace?: boolean }): this {
    this._init.push(new InitPosition(params));
    return this;
  }
  velocity(params: {
    shape: EmissionShape;
    speed: ScalarLike;
    worldSpace?: boolean;
  }): this {
    this._init.push(
      new InitVelocity({
        shape: params.shape,
        speed: toScalarInput(params.speed),
        worldSpace: params.worldSpace,
      }),
    );
    return this;
  }
  size(input: ScalarLike): this {
    this._init.push(new InitSize({ size: toScalarInput(input) }));
    return this;
  }
  rotation(input: ScalarLike, opts: { angularVelocity?: ScalarLike } = {}): this {
    this._init.push(
      new InitRotation({
        rotation: toScalarInput(input),
        angularVelocity:
          opts.angularVelocity !== undefined ? toScalarInput(opts.angularVelocity) : undefined,
      }),
    );
    return this;
  }
  color(color: ColorLike, opts: { alpha?: ScalarLike } = {}): this {
    this._init.push(
      new InitColor({
        color: toColorInput(color),
        alpha: opts.alpha !== undefined ? toScalarInput(opts.alpha) : undefined,
      }),
    );
    return this;
  }
  fromMesh(params: InitFromMeshParams): this {
    this._init.push(new InitFromMesh(params));
    return this;
  }

  // ─ Update — in typical call order ─
  integrate(): this {
    this._update.push(new VelocityIntegrator());
    return this;
  }
  lifetimeTick(): this {
    this._update.push(new LifetimeTick());
    return this;
  }
  gravity(acceleration: Vec3Tuple | number = -9.81): this {
    const v: Vec3Tuple =
      typeof acceleration === "number" ? [0, acceleration, 0] : acceleration;
    this._update.push(new Gravity({ acceleration: v }));
    return this;
  }
  drag(coefficient: number): this {
    this._update.push(new Drag({ coefficient }));
    return this;
  }
  colorOverLife(gradient: GradientLike): this {
    this._update.push(new ColorOverLife({ gradient: toGradient(gradient) }));
    return this;
  }
  sizeOverLife(curve: CurveLike): this {
    this._update.push(new SizeOverLife({ curve: toCurve(curve) }));
    return this;
  }
  alphaOverLife(curve: CurveLike): this {
    this._update.push(new AlphaOverLife({ curve: toCurve(curve) }));
    return this;
  }
  velocityOverLife(curve: CurveLike): this {
    this._update.push(new VelocityOverLife({ curve: toCurve(curve) }));
    return this;
  }
  turbulence(params: TurbulenceForceParams): this {
    this._update.push(new TurbulenceForce(params));
    return this;
  }
  curlNoise(params: CurlNoiseForceParams): this {
    this._update.push(new CurlNoiseForce(params));
    return this;
  }
  vortex(params: VortexForceParams): this {
    this._update.push(new VortexForce(params));
    return this;
  }
  pointAttractor(params: PointAttractorParams): this {
    this._update.push(new PointAttractor(params));
    return this;
  }
  scaleBySpeed(params: ScaleBySpeedParams): this {
    this._update.push(new ScaleBySpeed(params));
    return this;
  }
  planeCollision(params: PlaneCollisionParams = {}): this {
    this._update.push(new PlaneCollision(params));
    return this;
  }
  sphereCollision(params: SphereCollisionParams): this {
    this._update.push(new SphereCollision(params));
    return this;
  }
  depthCollision(params: DepthCollisionParams): this {
    this._update.push(new DepthCollision(params));
    return this;
  }
  sdfCollision(params: SdfCollisionParams): this {
    this._update.push(new SdfCollision(params));
    return this;
  }
  limitVelocity(params: LimitVelocityParams | number): this {
    const p = typeof params === "number" ? { maxSpeed: params } : params;
    this._update.push(new LimitVelocity(p));
    return this;
  }

  // ─ Render — only one may be set; last call wins ─
  renderSprite(params: SpriteRendererParams = {}): this {
    this._render = new SpriteRenderer(params);
    return this;
  }
  renderMesh(params: MeshRendererParams): this {
    this._render = new MeshRenderer(params);
    return this;
  }
  renderRibbon(params: RibbonRendererParams = {}): this {
    this._render = new RibbonRenderer(params);
    return this;
  }
  renderBeam(params: BeamRendererParams = {}): this {
    this._render = new BeamRenderer(params);
    return this;
  }
  renderLight(params: LightEmissionParams = {}): this {
    this._render = new LightEmission(params);
    return this;
  }
  /** Attach a pre-constructed render module instance (e.g. one you already configured by hand). */
  renderWith(module: RenderModule): this {
    this._render = module;
    return this;
  }

  build(): EmitterDef {
    if (!this._render) {
      throw new Error(
        `plume: emitter${this._name ? ` "${this._name}"` : ""} has no render module; call one of renderSprite/renderMesh/renderRibbon/renderBeam/renderLight before build()`,
      );
    }
    return {
      name: this._name,
      capacity: this._capacity,
      duration: this._duration,
      loop: this._loop,
      seed: this._seed,
      sortByDepth: this._sortByDepth,
      events: this._events,
      spawn: this._spawn,
      init: this._init,
      update: this._update,
      render: this._render,
    };
  }
}

// ─ System builder ──────────────────────────────────────────────────────────

export class SystemBuilder {
  private _name?: string;
  private _duration?: number;
  private _loop?: boolean;
  private _emitters: EmitterDef[] = [];

  constructor(name?: string) {
    this._name = name;
  }

  name(value: string): this {
    this._name = value;
    return this;
  }
  duration(seconds: number): this {
    this._duration = seconds;
    return this;
  }
  loop(value = true): this {
    this._loop = value;
    return this;
  }

  /**
   * Add an emitter. Two forms:
   *  1. `.emitter("name", (e) => e.capacity(...).spawnRate(...)...)` — callback form; builder
   *     is scoped to the callback and `.build()` is called for you.
   *  2. `.emitter(alreadyBuiltEmitterBuilder)` or `.emitter(emitterDef)` — pass-through for
   *     composing pre-built emitters.
   */
  emitter(name: string, build: (e: EmitterBuilder) => EmitterBuilder): this;
  emitter(build: (e: EmitterBuilder) => EmitterBuilder): this;
  emitter(builder: EmitterBuilder): this;
  emitter(def: EmitterDef): this;
  emitter(
    arg1: string | EmitterBuilder | EmitterDef | ((e: EmitterBuilder) => EmitterBuilder),
    arg2?: (e: EmitterBuilder) => EmitterBuilder,
  ): this {
    if (typeof arg1 === "string") {
      if (!arg2) throw new Error("plume: .emitter(name, build) requires a build callback");
      const b = new EmitterBuilder(arg1);
      const out = arg2(b);
      this._emitters.push(out.build());
      return this;
    }
    if (typeof arg1 === "function") {
      const b = new EmitterBuilder();
      const out = arg1(b);
      this._emitters.push(out.build());
      return this;
    }
    if (arg1 instanceof EmitterBuilder) {
      this._emitters.push(arg1.build());
      return this;
    }
    // plain EmitterDef
    this._emitters.push(arg1);
    return this;
  }

  build(): SystemDef {
    if (this._emitters.length === 0) {
      throw new Error(
        `plume: system${this._name ? ` "${this._name}"` : ""} has no emitters; call .emitter(...) at least once before build()`,
      );
    }
    return {
      name: this._name,
      duration: this._duration,
      loop: this._loop,
      emitters: this._emitters,
    };
  }
}

// ─ Entry points ─

export function system(name?: string): SystemBuilder {
  return new SystemBuilder(name);
}

export function emitter(name?: string): EmitterBuilder {
  return new EmitterBuilder(name);
}
