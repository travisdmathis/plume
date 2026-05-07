/**
 * Node-spec catalog — one entry per plume module exposed in the editor.
 *
 * Each spec describes:
 *   - `category`: which stage of the particle lifecycle the node lives in. Determines
 *     visual grouping in the palette AND ordering during graph compilation: a system's
 *     emitter applies all `spawn` nodes, then `init`, then `update`, then `render`.
 *   - `label`: human display name on the canvas.
 *   - `accent`: tint for the node body so categories read at a glance.
 *   - `fields`: the parameter set surfaced in the inspector. Each field has a kind
 *     (number / range / vec3 / color / select) plus default value(s).
 *   - `defaults`: the initial `params` object stored on a graph node when it's created.
 *
 * The compiler in `compile.ts` reads the same structure to instantiate plume modules.
 */

import type { EmissionShape } from "plume";

export type Category = "emitter" | "spawn" | "init" | "update" | "render";

/** A keyframe in a 1D curve param (stored as plain JSON for trivial persistence). */
export interface CurveKey {
  t: number; // 0..1
  v: number;
}
/** A stop in a colour gradient param. RGBA in linear-ish [0..1+]. */
export interface GradientStopJSON {
  t: number; // 0..1
  color: [number, number, number, number];
}
/** An uploaded texture — stored as a data URL so the graph round-trips through
 *  JSON without losing the image. */
export interface TextureRef {
  kind: "texture";
  dataUrl: string;
  /** User-visible filename ("particle.png"). Just metadata; not used at compile. */
  name: string;
}

/** Procedural geometry — a preset choice plus its dimensions. The compiler
 *  instantiates the matching `THREE.BufferGeometry` at compile time. */
export type GeometryRef =
  | {
      kind: "geometry";
      preset: "sphere";
      radius: number;
      widthSegments: number;
      heightSegments: number;
    }
  | { kind: "geometry"; preset: "box"; width: number; height: number; depth: number }
  | {
      kind: "geometry";
      preset: "torus";
      radius: number;
      tube: number;
      radialSegments: number;
      tubularSegments: number;
    }
  | { kind: "geometry"; preset: "cone"; radius: number; height: number; radialSegments: number }
  | {
      kind: "geometry";
      preset: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      radialSegments: number;
    }
  | { kind: "geometry"; preset: "plane"; width: number; height: number };

/** Signed-distance-function preset — chosen shape + parameters. The compiler
 *  builds the corresponding `sdfSphere` / `sdfBox` / `sdfPlane` SdfFn. */
export type SdfRef =
  | { kind: "sdf"; preset: "sphere"; center: [number, number, number]; radius: number }
  | {
      kind: "sdf";
      preset: "box";
      center: [number, number, number];
      halfSize: [number, number, number];
    }
  | {
      kind: "sdf";
      preset: "plane";
      point: [number, number, number];
      normal: [number, number, number];
    };

/** Reference to another emitter node by id. Used by spawn.from_events. */
export interface EmitterRef {
  kind: "emitter-ref";
  /** Graph-node id of the source emitter. The compiler maps this to the
   *  generated emitter name when registering the system. */
  nodeId: string | undefined;
}

export type Field =
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: "range"; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: "vec3"; key: string; label: string; step?: number }
  | { kind: "color"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: string[] }
  | { kind: "shape"; key: string; label: string }
  | { kind: "curve"; key: string; label: string }
  | { kind: "gradient"; key: string; label: string }
  | { kind: "texture"; key: string; label: string; optional?: boolean }
  | { kind: "geometry"; key: string; label: string }
  | { kind: "sdf"; key: string; label: string }
  | { kind: "emitter-ref"; key: string; label: string }
  | { kind: "boolean"; key: string; label: string };

/**
 * Parameter values stored on a graph node. Curve + gradient values carry a `kind`
 * tag so deserializers can distinguish them from EmissionShape (which also has a
 * `kind` field, but with disjoint string values).
 */
export type ParamValue =
  | number
  | boolean
  | [number, number]
  | [number, number, number]
  | string
  | EmissionShape
  | { kind: "curve1d"; keys: CurveKey[] }
  | { kind: "gradient"; stops: GradientStopJSON[] }
  | TextureRef
  | GeometryRef
  | SdfRef
  | EmitterRef;

export type Params = Record<string, ParamValue>;

export interface NodeSpec {
  type: string;
  category: Category;
  label: string;
  accent: string;
  fields: Field[];
  defaults: Params;
}

const CAT_COLORS: Record<Category, string> = {
  emitter: "#2c5b8c",
  spawn: "#8c5b2c",
  init: "#2c8c5b",
  update: "#5b2c8c",
  render: "#8c2c5b",
};

export const NODE_SPECS: NodeSpec[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Emitter root — exactly one per graph (compiler enforces).
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "emitter",
    category: "emitter",
    label: "Emitter",
    accent: CAT_COLORS.emitter,
    fields: [
      { kind: "number", key: "capacity", label: "Capacity", min: 16, max: 4096, step: 16 },
      { kind: "number", key: "duration", label: "Duration (s)", min: 0.05, max: 30, step: 0.05 },
      { kind: "vec3", key: "spawnOrigin", label: "Spawn origin", step: 0.1 },
      { kind: "boolean", key: "loop", label: "Loop on its own duration" },
    ],
    defaults: { capacity: 256, duration: 2, spawnOrigin: [0, 0.5, 0], loop: true },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Spawn (CPU-side: how many particles per tick)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "spawn.rate",
    category: "spawn",
    label: "SpawnRate",
    accent: CAT_COLORS.spawn,
    fields: [{ kind: "number", key: "rate", label: "Rate (per sec)", min: 0, max: 2000, step: 1 }],
    defaults: { rate: 50 },
  },
  {
    type: "spawn.burst",
    category: "spawn",
    label: "SpawnBurst",
    accent: CAT_COLORS.spawn,
    fields: [
      { kind: "number", key: "time", label: "Time (s)", min: 0, max: 30, step: 0.05 },
      { kind: "number", key: "count", label: "Count", min: 1, max: 4096, step: 1 },
    ],
    defaults: { time: 0, count: 100 },
  },
  {
    type: "spawn.from_events",
    category: "spawn",
    label: "SpawnFromEvents",
    accent: CAT_COLORS.spawn,
    fields: [
      { kind: "emitter-ref", key: "source", label: "Source emitter" },
      { kind: "number", key: "perEvent", label: "Per event", min: 1, max: 1024, step: 1 },
      {
        kind: "number",
        key: "maxEventsPerFrame",
        label: "Max events / frame",
        min: 1,
        max: 1024,
        step: 1,
      },
      { kind: "boolean", key: "inheritVelocity", label: "Inherit velocity from event" },
    ],
    defaults: {
      source: { kind: "emitter-ref", nodeId: undefined },
      perEvent: 6,
      maxEventsPerFrame: 64,
      inheritVelocity: false,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Init (per-new-particle TSL)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "init.lifetime",
    category: "init",
    label: "InitLifetime",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "range", key: "lifetime", label: "Lifetime (s)", min: 0.1, max: 30, step: 0.05 },
    ],
    defaults: { lifetime: [1, 2] },
  },
  {
    type: "init.position",
    category: "init",
    label: "InitPosition",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "shape", key: "shape", label: "Shape" },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: {
      shape: { kind: "sphere", radius: 0.3, thickness: 1 } as EmissionShape,
      worldSpace: false,
    },
  },
  {
    type: "init.velocity",
    category: "init",
    label: "InitVelocity",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "shape", key: "shape", label: "Shape" },
      { kind: "range", key: "speed", label: "Speed", min: 0, max: 50, step: 0.1 },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: {
      shape: { kind: "cone", angle: 0.3 } as EmissionShape,
      speed: [1, 3],
      worldSpace: false,
    },
  },
  {
    type: "init.size",
    category: "init",
    label: "InitSize",
    accent: CAT_COLORS.init,
    fields: [{ kind: "range", key: "size", label: "Size", min: 0.01, max: 5, step: 0.01 }],
    defaults: { size: [0.1, 0.3] },
  },
  {
    type: "init.color",
    category: "init",
    label: "InitColor",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "color", key: "color", label: "Color (or min)" },
      { kind: "color", key: "colorMax", label: "Color max (optional)" },
      { kind: "select", key: "mode", label: "Mode", options: ["solid", "random range"] },
      { kind: "number", key: "alpha", label: "Alpha", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { color: [1, 1, 1], colorMax: [1, 1, 1], mode: "solid", alpha: 1 },
  },
  {
    type: "init.rotation",
    category: "init",
    label: "InitRotation",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "range", key: "rotation", label: "Rotation (rad)", min: 0, max: 6.283, step: 0.05 },
      {
        kind: "range",
        key: "angularVelocity",
        label: "Angular velocity (rad/s)",
        min: -20,
        max: 20,
        step: 0.05,
      },
    ],
    defaults: { rotation: [0, 6.283], angularVelocity: [0, 0] },
  },
  {
    type: "init.from_mesh",
    category: "init",
    label: "InitFromMesh",
    accent: CAT_COLORS.init,
    fields: [
      { kind: "geometry", key: "geometry", label: "Source geometry" },
      { kind: "select", key: "fill", label: "Fill mode", options: ["surface", "volume"] },
      { kind: "boolean", key: "worldSpace", label: "World space" },
      {
        kind: "number",
        key: "volumeSampleCount",
        label: "Volume samples (volume mode)",
        min: 256,
        max: 8192,
        step: 256,
      },
    ],
    defaults: {
      geometry: {
        kind: "geometry",
        preset: "sphere",
        radius: 0.5,
        widthSegments: 32,
        heightSegments: 16,
      },
      fill: "surface",
      worldSpace: false,
      volumeSampleCount: 2048,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Update (per-live-particle TSL each frame)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "update.integrate",
    category: "update",
    label: "VelocityIntegrator",
    accent: CAT_COLORS.update,
    fields: [],
    defaults: {},
  },
  {
    type: "update.gravity",
    category: "update",
    label: "Gravity",
    accent: CAT_COLORS.update,
    fields: [{ kind: "vec3", key: "acceleration", label: "Acceleration", step: 0.1 }],
    defaults: { acceleration: [0, -9.81, 0] },
  },
  {
    type: "update.drag",
    category: "update",
    label: "Drag",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "coefficient", label: "Coefficient", min: 0, max: 10, step: 0.05 },
    ],
    defaults: { coefficient: 0.5 },
  },
  {
    type: "update.alpha_over_life",
    category: "update",
    label: "AlphaOverLife",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "fadeIn", label: "Fade in", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "fadeOut", label: "Fade out", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { fadeIn: 0.1, fadeOut: 0.3 },
  },
  {
    type: "update.size_over_life",
    category: "update",
    label: "SizeOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "curve", key: "curve", label: "Scale over life" }],
    defaults: {
      curve: {
        kind: "curve1d",
        keys: [
          { t: 0, v: 1 },
          { t: 1, v: 0.5 },
        ],
      },
    },
  },
  {
    type: "update.velocity_over_life",
    category: "update",
    label: "VelocityOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "curve", key: "curve", label: "Speed multiplier" }],
    defaults: {
      curve: {
        kind: "curve1d",
        keys: [
          { t: 0, v: 1 },
          { t: 1, v: 0 },
        ],
      },
    },
  },
  {
    type: "update.color_over_life",
    category: "update",
    label: "ColorOverLife",
    accent: CAT_COLORS.update,
    fields: [{ kind: "gradient", key: "gradient", label: "Colour over life" }],
    defaults: {
      gradient: {
        kind: "gradient",
        stops: [
          { t: 0, color: [1, 1, 1, 1] },
          { t: 1, color: [1, 0.4, 0.1, 0] },
        ],
      },
    },
  },
  {
    type: "update.curl_noise",
    category: "update",
    label: "CurlNoiseForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "amplitude", label: "Amplitude (u/s²)", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "frequency", label: "Frequency", min: 0.01, max: 10, step: 0.01 },
      { kind: "number", key: "speed", label: "Speed", min: 0, max: 5, step: 0.05 },
    ],
    defaults: { amplitude: 2, frequency: 1, speed: 0.5 },
  },
  {
    type: "update.turbulence",
    category: "update",
    label: "TurbulenceForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "amplitude", label: "Amplitude (u/s²)", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "frequency", label: "Frequency", min: 0.01, max: 10, step: 0.01 },
      { kind: "number", key: "speed", label: "Speed", min: 0, max: 5, step: 0.05 },
      { kind: "number", key: "octaves", label: "Octaves", min: 1, max: 6, step: 1 },
    ],
    defaults: { amplitude: 2, frequency: 1, speed: 0.5, octaves: 3 },
  },
  {
    type: "update.vortex",
    category: "update",
    label: "VortexForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "axis", label: "Axis", step: 0.1 },
      { kind: "vec3", key: "origin", label: "Origin", step: 0.1 },
      { kind: "number", key: "strength", label: "Strength (u/s²)", min: -50, max: 50, step: 0.1 },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: { axis: [0, 1, 0], origin: [0, 0, 0], strength: 5, worldSpace: false },
  },
  {
    type: "update.point_attractor",
    category: "update",
    label: "PointAttractor",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "position", label: "Position", step: 0.1 },
      { kind: "number", key: "strength", label: "Strength (u/s²)", min: -50, max: 50, step: 0.1 },
      { kind: "number", key: "radius", label: "Radius", min: 0.01, max: 50, step: 0.05 },
      {
        kind: "select",
        key: "falloff",
        label: "Falloff",
        options: ["none", "linear", "inverse", "inverseSquared"],
      },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: {
      position: [0, 0, 0],
      strength: 5,
      radius: 2,
      falloff: "inverseSquared",
      worldSpace: false,
    },
  },
  {
    type: "update.limit_velocity",
    category: "update",
    label: "LimitVelocity",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "maxSpeed", label: "Max speed (u/s)", min: 0, max: 100, step: 0.1 },
      { kind: "number", key: "damping", label: "Damping", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { maxSpeed: 10, damping: 1 },
  },
  {
    type: "update.scale_by_speed",
    category: "update",
    label: "ScaleBySpeed",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "number", key: "minSpeed", label: "Min speed", min: 0, max: 50, step: 0.05 },
      { kind: "number", key: "maxSpeed", label: "Max speed", min: 0, max: 50, step: 0.05 },
      { kind: "number", key: "minScale", label: "Min scale", min: 0, max: 5, step: 0.05 },
      { kind: "number", key: "maxScale", label: "Max scale", min: 0, max: 5, step: 0.05 },
    ],
    defaults: { minSpeed: 0, maxSpeed: 5, minScale: 1, maxScale: 2 },
  },
  {
    type: "update.plane_collision",
    category: "update",
    label: "PlaneCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "normal", label: "Normal", step: 0.1 },
      { kind: "vec3", key: "point", label: "Point on plane", step: 0.1 },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: {
      normal: [0, 1, 0],
      point: [0, 0, 0],
      restitution: 0.5,
      friction: 0.9,
      worldSpace: false,
    },
  },
  {
    type: "update.sdf_collision",
    category: "update",
    label: "SDFCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "sdf", key: "sdf", label: "Surface" },
      { kind: "select", key: "mode", label: "Mode", options: ["bounce", "stop", "kill"] },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "thickness", label: "Thickness", min: 0, max: 0.5, step: 0.005 },
      {
        kind: "number",
        key: "gradientEpsilon",
        label: "Gradient ε",
        min: 0.001,
        max: 0.1,
        step: 0.001,
      },
    ],
    defaults: {
      sdf: { kind: "sdf", preset: "sphere", center: [0, 0, 0], radius: 1 },
      mode: "bounce",
      restitution: 0.5,
      friction: 0.9,
      thickness: 0.02,
      gradientEpsilon: 0.01,
    },
  },
  {
    type: "update.depth_collision",
    category: "update",
    label: "DepthCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "select", key: "mode", label: "Mode", options: ["bounce", "stop", "kill"] },
      {
        kind: "select",
        key: "normal",
        label: "Surface normal",
        options: ["depth-gradient", "camera"],
      },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      {
        kind: "number",
        key: "thickness",
        label: "Thickness (NDC)",
        min: 0,
        max: 0.01,
        step: 0.0001,
      },
    ],
    defaults: {
      mode: "bounce",
      normal: "depth-gradient",
      restitution: 0.5,
      friction: 0.9,
      thickness: 0.0005,
    },
  },
  {
    type: "update.flowmap_force",
    category: "update",
    label: "FlowmapForce",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "texture", key: "texture", label: "Flowmap (RG-encoded)" },
      { kind: "vec3", key: "origin", label: "Origin", step: 0.1 },
      { kind: "range", key: "size", label: "Size (w × h)", min: 0.1, max: 100, step: 0.1 },
      { kind: "select", key: "axis", label: "Axis", options: ["xz", "xy", "yz"] },
      { kind: "number", key: "amplitude", label: "Amplitude", min: 0, max: 50, step: 0.1 },
    ],
    defaults: { origin: [0, 0, 0], size: [4, 4], axis: "xz", amplitude: 1 },
  },
  {
    type: "update.sphere_collision",
    category: "update",
    label: "SphereCollision",
    accent: CAT_COLORS.update,
    fields: [
      { kind: "vec3", key: "center", label: "Center", step: 0.1 },
      { kind: "number", key: "radius", label: "Radius", min: 0.01, max: 50, step: 0.05 },
      { kind: "select", key: "side", label: "Bounce side", options: ["outside", "inside"] },
      { kind: "number", key: "restitution", label: "Restitution", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "friction", label: "Friction", min: 0, max: 1, step: 0.01 },
      { kind: "boolean", key: "worldSpace", label: "World space" },
    ],
    defaults: {
      center: [0, 0, 0],
      radius: 1,
      side: "outside",
      restitution: 0.5,
      friction: 0.9,
      worldSpace: false,
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Render — exactly one per emitter (compiler enforces).
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: "render.sprite",
    category: "render",
    label: "SpriteRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Sprite texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha",
        ],
      },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"],
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 },
    ],
    defaults: { shader: "soft", blending: "additive", opacity: 1, renderOrder: 0 },
  },
  {
    type: "render.ribbon",
    category: "render",
    label: "RibbonRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Ribbon texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha",
        ],
      },
      { kind: "number", key: "width", label: "Width (head)", min: 0.001, max: 5, step: 0.005 },
      { kind: "number", key: "historyLength", label: "History length", min: 4, max: 256, step: 1 },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"],
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 },
    ],
    defaults: {
      shader: "soft",
      width: 0.05,
      historyLength: 32,
      blending: "additive",
      opacity: 1,
      renderOrder: 0,
    },
  },
  {
    type: "render.beam",
    category: "render",
    label: "BeamRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "texture", key: "texture", label: "Beam texture", optional: true },
      {
        kind: "select",
        key: "shader",
        label: "Shader",
        options: [
          "soft",
          "hard",
          "fire",
          "smoke",
          "spark",
          "texture_additive",
          "texture_luma_alpha",
        ],
      },
      { kind: "number", key: "width", label: "Width (head)", min: 0.001, max: 5, step: 0.005 },
      { kind: "select", key: "taper", label: "Taper", options: ["to-tail", "uniform"] },
      {
        kind: "select",
        key: "blending",
        label: "Blending",
        options: ["additive", "alpha", "normal"],
      },
      { kind: "number", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 },
    ],
    defaults: {
      shader: "soft",
      width: 0.05,
      taper: "to-tail",
      blending: "additive",
      opacity: 1,
      renderOrder: 0,
    },
  },
  {
    type: "render.mesh",
    category: "render",
    label: "MeshRenderer",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "geometry", key: "geometry", label: "Instanced geometry" },
      {
        kind: "select",
        key: "material",
        label: "Material",
        options: ["pbr", "magma", "emissive"],
      },
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "metalness", label: "Metalness (PBR)", min: 0, max: 1, step: 0.05 },
      { kind: "number", key: "roughness", label: "Roughness (PBR)", min: 0, max: 1, step: 0.05 },
      { kind: "number", key: "renderOrder", label: "Render order", min: -100, max: 100, step: 1 },
    ],
    defaults: {
      geometry: { kind: "geometry", preset: "box", width: 0.1, height: 0.1, depth: 0.1 },
      material: "pbr",
      color: [1, 1, 1],
      metalness: 0.1,
      roughness: 0.4,
      renderOrder: 0,
    },
  },
  {
    type: "render.light",
    category: "render",
    label: "LightEmission",
    accent: CAT_COLORS.render,
    fields: [
      { kind: "number", key: "lightCount", label: "Light count", min: 1, max: 16, step: 1 },
      { kind: "color", key: "color", label: "Color" },
      { kind: "number", key: "intensity", label: "Intensity", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "distance", label: "Distance", min: 0, max: 50, step: 0.1 },
      { kind: "number", key: "decay", label: "Decay", min: 0, max: 5, step: 0.1 },
    ],
    defaults: { lightCount: 4, color: [1, 0.85, 0.6], intensity: 1, distance: 5, decay: 2 },
  },
];

/** Indexed lookup by `type`. Throws if asked for an unknown type. */
const INDEX = new Map(NODE_SPECS.map((s) => [s.type, s]));

export function getSpec(type: string): NodeSpec {
  const s = INDEX.get(type);
  if (!s) throw new Error(`plume-editor: unknown node type "${type}"`);
  return s;
}

export function specsByCategory(category: Category): NodeSpec[] {
  return NODE_SPECS.filter((s) => s.category === category);
}
