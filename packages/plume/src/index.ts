// Core types
export type {
  Vec3Tuple,
  Vec4Tuple,
  ColorTuple,
  ColorRGBATuple,
  ScalarInput,
  Vec3Input,
  ColorInput,
  Disposable,
  WorldTransform,
} from "./types.js";

// Math
export { RNG, sharedRNG } from "./math/rng.js";
export { Curve1D } from "./math/curve.js";
export type { CurveKeyframe } from "./math/curve.js";
export { Gradient } from "./math/gradient.js";
export type { GradientStop } from "./math/gradient.js";
export { samplePosition, sampleDirection } from "./math/shapes.js";
export type { EmissionShape } from "./math/shapes.js";
export { sampleScalar, sampleVec3, sampleColor } from "./math/sample.js";
export {
  sdfSphere,
  sdfBox,
  sdfPlane,
  sdfUnion,
  sdfIntersect,
  sdfSubtract,
} from "./math/sdf.js";
export type { SdfFn } from "./math/sdf.js";

// Storage
export { ParticleBuffer } from "./particle-buffer.js";
export type { ParticleStorage } from "./particle-buffer.js";

// Module system
export type {
  Module,
  ModuleFactory,
  ModuleJSON,
  ModuleKind,
  EmitterContext,
  SpawnInitContext,
  UpdateContext,
  RenderContext,
  EmitterSpawnModule,
  ParticleSpawnModule,
  ParticleUpdateModule,
  RenderModule,
} from "./modules/module.js";
export {
  registerModule,
  unregisterModule,
  getModuleFactory,
  listRegisteredModules,
  moduleFromJSON,
} from "./modules/registry.js";

// Spawn modules (emitter-level)
export { SpawnRate } from "./modules/spawn/spawn-rate.js";
export type { SpawnRateParams } from "./modules/spawn/spawn-rate.js";
export { SpawnBurst } from "./modules/spawn/spawn-burst.js";
export type { SpawnBurstEntry, SpawnBurstParams } from "./modules/spawn/spawn-burst.js";
export { SpawnFromEvents } from "./modules/spawn/spawn-from-events.js";
export type { SpawnFromEventsParams } from "./modules/spawn/spawn-from-events.js";

// Init modules (particle-spawn)
export { InitLifetime } from "./modules/init/init-lifetime.js";
export type { InitLifetimeParams } from "./modules/init/init-lifetime.js";
export { InitPosition } from "./modules/init/init-position.js";
export type { InitPositionParams } from "./modules/init/init-position.js";
export { InitVelocity } from "./modules/init/init-velocity.js";
export type { InitVelocityParams } from "./modules/init/init-velocity.js";
export { InitColor } from "./modules/init/init-color.js";
export type { InitColorParams } from "./modules/init/init-color.js";
export { InitSize } from "./modules/init/init-size.js";
export type { InitSizeParams } from "./modules/init/init-size.js";
export { InitRotation } from "./modules/init/init-rotation.js";
export type { InitRotationParams } from "./modules/init/init-rotation.js";
export { InitFromMesh } from "./modules/init/init-from-mesh.js";
export type { InitFromMeshFill, InitFromMeshParams } from "./modules/init/init-from-mesh.js";

// Update modules
export { LifetimeTick } from "./modules/update/lifetime-tick.js";
export { VelocityIntegrator } from "./modules/update/velocity-integrator.js";
export { Gravity } from "./modules/update/gravity.js";
export type { GravityParams } from "./modules/update/gravity.js";
export { Drag } from "./modules/update/drag.js";
export type { DragParams } from "./modules/update/drag.js";
export { ColorOverLife } from "./modules/update/color-over-life.js";
export type { ColorOverLifeParams } from "./modules/update/color-over-life.js";
export { SizeOverLife } from "./modules/update/size-over-life.js";
export type { SizeOverLifeParams } from "./modules/update/size-over-life.js";
export { AlphaOverLife } from "./modules/update/alpha-over-life.js";
export type { AlphaOverLifeParams } from "./modules/update/alpha-over-life.js";
export { VelocityOverLife } from "./modules/update/velocity-over-life.js";
export type { VelocityOverLifeParams } from "./modules/update/velocity-over-life.js";
export { TurbulenceForce } from "./modules/update/turbulence-force.js";
export type { TurbulenceForceParams } from "./modules/update/turbulence-force.js";
export { CurlNoiseForce } from "./modules/update/curl-noise-force.js";
export type { CurlNoiseForceParams } from "./modules/update/curl-noise-force.js";
export { VortexForce } from "./modules/update/vortex-force.js";
export type { VortexForceParams } from "./modules/update/vortex-force.js";
export { PointAttractor } from "./modules/update/point-attractor.js";
export type { PointAttractorFalloff, PointAttractorParams } from "./modules/update/point-attractor.js";
export { ScaleBySpeed } from "./modules/update/scale-by-speed.js";
export type { ScaleBySpeedParams } from "./modules/update/scale-by-speed.js";
export { PlaneCollision } from "./modules/update/plane-collision.js";
export type { PlaneCollisionParams } from "./modules/update/plane-collision.js";
export { SphereCollision } from "./modules/update/sphere-collision.js";
export type { SphereCollisionParams } from "./modules/update/sphere-collision.js";
export { LimitVelocity } from "./modules/update/limit-velocity.js";
export type { LimitVelocityParams } from "./modules/update/limit-velocity.js";
export { DepthCollision } from "./modules/update/depth-collision.js";
export type {
  DepthCollisionMode,
  DepthCollisionNormal,
  DepthCollisionParams,
} from "./modules/update/depth-collision.js";
export { SdfCollision } from "./modules/update/sdf-collision.js";
export type {
  SdfCollisionMode,
  SdfCollisionParams,
} from "./modules/update/sdf-collision.js";

// Render modules
export { SpriteRenderer } from "./modules/render/sprite-renderer.js";
export type {
  SpriteAnimationParams,
  SpriteBlendMode,
  SpriteRendererParams,
} from "./modules/render/sprite-renderer.js";
export { MeshRenderer } from "./modules/render/mesh-renderer.js";
export type { MeshRendererParams } from "./modules/render/mesh-renderer.js";
export { RibbonRenderer } from "./modules/render/ribbon-renderer.js";
export type { RibbonBlendMode, RibbonRendererParams } from "./modules/render/ribbon-renderer.js";
export { BeamRenderer } from "./modules/render/beam-renderer.js";
export type { BeamBlendMode, BeamRendererParams } from "./modules/render/beam-renderer.js";
export { LightEmission } from "./modules/render/light-emission.js";
export type { LightEmissionParams } from "./modules/render/light-emission.js";

// Orchestration
export { Emitter } from "./emitter.js";
export type { EmitterDef, EmitterEventConfig } from "./emitter.js";
export { System } from "./system.js";
export type { SystemDef } from "./system.js";
export { Manager } from "./manager.js";
export type { ManagerOptions, SpawnOptions } from "./manager.js";

// Serialization
export {
  systemDefToJSON,
  systemDefFromJSON,
  emitterDefToJSON,
  emitterDefFromJSON,
} from "./serialization.js";
export type { SystemJSON, EmitterJSON } from "./serialization.js";

// Fluent authoring API (R6)
export {
  system,
  emitter,
  SystemBuilder,
  EmitterBuilder,
  toScalarInput,
  toVec3Input,
  toColorInput,
  toCurve,
  toGradient,
} from "./builder.js";
export type { ScalarLike, Vec3Like, ColorLike, CurveLike, GradientLike } from "./builder.js";

// Debug helpers (R12)
export { dumpShaders } from "./debug.js";
export type { EmitterShaderDump, ShaderDump, DumpOptions } from "./debug.js";

// Textures
export {
  softCircleTexture,
  circleTexture,
  streakTexture,
  disposeTextureCache,
} from "./textures/procedural.js";

