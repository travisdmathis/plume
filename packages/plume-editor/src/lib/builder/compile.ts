/**
 * Graph → SystemDef compiler.
 *
 * Each Emitter node roots its own BFS traversal of the user-drawn DAG. The compiler
 * walks every emitter independently, groups its reachable modules by category in
 * visit order, and emits one `.emitter("…", e => …)` call per Emitter node into a
 * single `SystemDef`. Modules reachable from multiple emitters are included in
 * each — that's intentional, since plume's API takes a fresh module instance per
 * emitter anyway.
 *
 * Validation rules:
 *   - At least one Emitter node required.
 *   - Each emitter must have exactly one reachable render module.
 *   - Disconnected modules (not reachable from any emitter) are silently skipped —
 *     they show up in the canvas but aren't compiled in. This makes "comment out by
 *     unwiring" a useful editor gesture.
 */

import * as THREE from "three";
import type {
  EmissionShape,
  EmitterBuilder,
  SystemDef,
  FlowmapAxis,
  SdfFn,
  DepthCollisionMode,
  DepthCollisionNormal,
  SdfCollisionMode,
} from "plume";
import { Curve1D, Gradient, system, sdfSphere, sdfBox, sdfPlane } from "plume";
import { getSpec, type Params } from "./nodes.js";
import { getTexture } from "./textures.js";
import {
  buildSpriteColorNode,
  buildMeshMaterial,
  type SpriteShader,
  type MeshShader,
} from "./shaders.js";

/** Minimal shape of a graph node we care about — matches @xyflow/svelte's `Node` shape. */
export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: { type: string; params: Params };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

/** Optional runtime hooks the editor preview supplies. `update.depth_collision`
 *  needs both; if absent the module is silently skipped at compile time so the
 *  rest of the graph still previews. (Code-export emits the call regardless.) */
export interface CompileContext {
  depthTexture?: THREE.Texture;
  camera?: THREE.Camera;
}

export interface CompileResult {
  def: SystemDef;
  /** Plain-text summary of what got compiled — surfaced in the editor status bar. */
  summary: string;
}

export class CompileError extends Error {}

interface EmitterPlan {
  emitterNode: GraphNode;
  spawn: GraphNode[];
  init: GraphNode[];
  update: GraphNode[];
  render: GraphNode;
  /** Stable name for the `.emitter("…", …)` call — derived from the node id. */
  name: string;
}

export function compileGraph(
  nodes: GraphNode[],
  edges: GraphEdge[] = [],
  context: CompileContext = {},
): CompileResult {
  const emitters = nodes.filter((n) => getSpec(n.data.type).category === "emitter");
  if (emitters.length === 0) {
    throw new CompileError("Graph needs at least one Emitter node.");
  }

  // Adjacency: source-id → ordered list of targets. Edge insertion order is what
  // xyflow gives us when the user draws wires; we preserve it as the tiebreaker
  // for "order within a category" during BFS.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function bfs(rootId: string): GraphNode[] {
    const visited = new Set<string>();
    const queue: string[] = [rootId];
    const out: GraphNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node) continue;
      out.push(node);
      for (const next of adj.get(id) ?? []) if (!visited.has(next)) queue.push(next);
    }
    return out;
  }

  // Discover which emitters are referenced as event sources by `spawn.from_events`
  // nodes anywhere in the graph. Those emitters need `.emitEvents()` set on
  // their builder during compilation so their dying particles dispatch events.
  const eventSourceIds = new Set<string>();
  for (const n of nodes) {
    if (n.data.type !== "spawn.from_events") continue;
    const id = readEmitterRef(n.data.params, "source");
    if (id) eventSourceIds.add(id);
  }

  const plans: EmitterPlan[] = [];
  const reachableUnion = new Set<string>();

  for (const em of emitters) {
    const visited = bfs(em.id);
    for (const n of visited) reachableUnion.add(n.id);
    const spawn: GraphNode[] = [];
    const init: GraphNode[] = [];
    const update: GraphNode[] = [];
    const renders: GraphNode[] = [];
    for (const n of visited) {
      const cat = getSpec(n.data.type).category;
      if (cat === "spawn") spawn.push(n);
      else if (cat === "init") init.push(n);
      else if (cat === "update") update.push(n);
      else if (cat === "render") renders.push(n);
    }
    if (renders.length === 0) {
      throw new CompileError(
        `Emitter "${em.id}" has no reachable render module — wire a SpriteRenderer in.`,
      );
    }
    if (renders.length > 1) {
      throw new CompileError(
        `Emitter "${em.id}" reaches ${renders.length} render modules. Disconnect extras.`,
      );
    }
    plans.push({
      emitterNode: em,
      spawn,
      init,
      update,
      render: renders[0]!,
      name: emitterNameFromId(em.id),
    });
  }

  // System-level duration: the longest emitter duration + 1s tail.
  const maxDuration = Math.max(
    ...plans.map((p) => readNumber(p.emitterNode.data.params, "duration", 2)),
  );

  let builder = system("editor_graph")
    .duration(maxDuration + 1)
    .loop();

  for (const plan of plans) {
    const capacity = readNumber(plan.emitterNode.data.params, "capacity", 256);
    const duration = readNumber(plan.emitterNode.data.params, "duration", 2);
    const emitsEvents = eventSourceIds.has(plan.emitterNode.id);
    const looping = readBool(plan.emitterNode.data.params, "loop", true);
    builder = builder.emitter(plan.name, (e) => {
      e.capacity(capacity).duration(duration);
      if (looping) e.loop();
      if (emitsEvents) e.emitEvents({ onDeath: true });
      for (const n of plan.spawn) applyToBuilder(e, n, context);
      for (const n of plan.init) applyToBuilder(e, n, context);
      for (const n of plan.update) applyToBuilder(e, n, context);
      applyToBuilder(e, plan.render, context);
      return e;
    });
  }
  const def = builder.build();

  const totalReachable = reachableUnion.size;
  const skipped = nodes.length - totalReachable;
  const moduleCount = plans.reduce(
    (n, p) => n + p.spawn.length + p.init.length + p.update.length + 1,
    0,
  );
  const emitterTag = plans.length === 1 ? "1 emitter" : `${plans.length} emitters`;
  const summary = `${emitterTag} · ${moduleCount} modules${
    skipped > 0 ? ` · ${skipped} unwired (skipped)` : ""
  }`;

  return { def, summary: `Compiled: ${summary}` };
}

/** Stable, plume-friendly name from a node id (e.g. "emitter_3" → "em_3"). */
function emitterNameFromId(id: string): string {
  return id.replace(/^emitter_/, "em_");
}

// ─ Builder dispatch ────────────────────────────────────────────────────────

function applyToBuilder(e: EmitterBuilder, node: GraphNode, context: CompileContext): void {
  const p = node.data.params;
  switch (node.data.type) {
    // ── Spawn ──
    case "spawn.rate":
      e.spawnRate(readNumber(p, "rate", 50));
      break;
    case "spawn.burst":
      e.spawnBurst({ time: readNumber(p, "time", 0), count: readNumber(p, "count", 100) });
      break;
    case "spawn.from_events": {
      const ref = readEmitterRef(p, "source");
      if (!ref) {
        // No source picked yet — module is inert in the preview. Code-export
        // still emits a placeholder name that the user can fix in their copy.
        break;
      }
      // The fluent helper only exposes (source, perEvent, max). For the inherit-
      // velocity bool we drop down to the underlying class via its registry —
      // builder doesn't expose it as a positional. Acceptable: editor calls
      // builder.spawnFromEvents and the inheritVelocity option is captured by
      // the editor and re-applied via direct push if non-default.
      e.spawnFromEvents(
        emitterNameFromId(ref),
        readNumber(p, "perEvent", 6),
        readNumber(p, "maxEventsPerFrame", 64),
      );
      // inheritVelocity isn't on builder yet — silently ignored for now. Tracked
      // as a follow-up in plume itself.
      break;
    }

    // ── Init ──
    case "init.lifetime": {
      const [min, max] = readRange(p, "lifetime", [1, 2]);
      e.lifetime({ min, max });
      break;
    }
    case "init.position":
      e.position({
        shape: readShape(p, "shape", { kind: "sphere", radius: 0.3, thickness: 1 }),
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    case "init.velocity": {
      const [smin, smax] = readRange(p, "speed", [1, 3]);
      e.velocity({
        shape: readShape(p, "shape", { kind: "cone", angle: 0.3 }),
        speed: { min: smin, max: smax },
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    }
    case "init.size": {
      const [smin, smax] = readRange(p, "size", [0.1, 0.3]);
      e.size({ min: smin, max: smax });
      break;
    }
    case "init.color": {
      const mode = readSelect(p, "mode", ["solid", "random range"], "solid");
      const cmin = readVec3(p, "color", [1, 1, 1]);
      if (mode === "random range") {
        const cmax = readVec3(p, "colorMax", [1, 1, 1]);
        e.color({ min: cmin, max: cmax }, { alpha: readNumber(p, "alpha", 1) });
      } else {
        e.color(cmin, { alpha: readNumber(p, "alpha", 1) });
      }
      break;
    }
    case "init.rotation": {
      const [rmin, rmax] = readRange(p, "rotation", [0, Math.PI * 2]);
      const [avmin, avmax] = readRange(p, "angularVelocity", [0, 0]);
      const hasSpin = avmin !== 0 || avmax !== 0;
      e.rotation(
        { min: rmin, max: rmax },
        hasSpin ? { angularVelocity: { min: avmin, max: avmax } } : {},
      );
      break;
    }
    case "init.from_mesh": {
      const geom = buildGeometry(readGeometry(p, "geometry"));
      e.fromMesh({
        geometry: geom,
        fill: readSelect(p, "fill", ["surface", "volume"], "surface") as "surface" | "volume",
        worldSpace: readBool(p, "worldSpace", false),
        volumeSampleCount: readNumber(p, "volumeSampleCount", 2048),
      });
      break;
    }

    // ── Update ──
    case "update.integrate":
      e.integrate();
      break;
    case "update.gravity":
      e.gravity(readVec3(p, "acceleration", [0, -9.81, 0]));
      break;
    case "update.drag":
      e.drag(readNumber(p, "coefficient", 0.5));
      break;
    case "update.alpha_over_life": {
      // Map two simple knobs (fadeIn, fadeOut) into a 4-keyframe trapezoidal curve. Keeps
      // the inspector tiny while still producing the most common alpha shape.
      const fadeIn = clamp01(readNumber(p, "fadeIn", 0.1));
      const fadeOut = clamp01(readNumber(p, "fadeOut", 0.3));
      const start = Math.min(fadeIn, 1);
      const end = Math.max(0, 1 - fadeOut);
      const curve =
        start < end
          ? new Curve1D([
              { t: 0, v: 0 },
              { t: start, v: 1 },
              { t: end, v: 1 },
              { t: 1, v: 0 },
            ])
          : Curve1D.constant(1);
      e.alphaOverLife(curve);
      break;
    }
    case "update.size_over_life":
      e.sizeOverLife(
        readCurve(p, "curve", [
          { t: 0, v: 1 },
          { t: 1, v: 0.5 },
        ]),
      );
      break;
    case "update.velocity_over_life":
      e.velocityOverLife(
        readCurve(p, "curve", [
          { t: 0, v: 1 },
          { t: 1, v: 0 },
        ]),
      );
      break;
    case "update.color_over_life":
      e.colorOverLife(
        readGradient(p, "gradient", [
          { t: 0, color: [1, 1, 1, 1] },
          { t: 1, color: [1, 0.4, 0.1, 0] },
        ]),
      );
      break;
    case "update.curl_noise":
      e.curlNoise({
        amplitude: readNumber(p, "amplitude", 2),
        frequency: readNumber(p, "frequency", 1),
        speed: readNumber(p, "speed", 0.5),
      });
      break;
    case "update.turbulence":
      e.turbulence({
        amplitude: readNumber(p, "amplitude", 2),
        frequency: readNumber(p, "frequency", 1),
        speed: readNumber(p, "speed", 0.5),
        octaves: readNumber(p, "octaves", 3),
      });
      break;
    case "update.vortex":
      e.vortex({
        axis: readVec3(p, "axis", [0, 1, 0]),
        origin: readVec3(p, "origin", [0, 0, 0]),
        strength: readNumber(p, "strength", 5),
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    case "update.point_attractor":
      e.pointAttractor({
        position: readVec3(p, "position", [0, 0, 0]),
        strength: readNumber(p, "strength", 5),
        radius: readNumber(p, "radius", 2),
        falloff: readSelect(
          p,
          "falloff",
          ["none", "linear", "inverse", "inverseSquared"],
          "inverseSquared",
        ) as "none" | "linear" | "inverse" | "inverseSquared",
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    case "update.limit_velocity":
      e.limitVelocity({
        maxSpeed: readNumber(p, "maxSpeed", 10),
        damping: readNumber(p, "damping", 1),
      });
      break;
    case "update.scale_by_speed":
      e.scaleBySpeed({
        minSpeed: readNumber(p, "minSpeed", 0),
        maxSpeed: readNumber(p, "maxSpeed", 5),
        minScale: readNumber(p, "minScale", 1),
        maxScale: readNumber(p, "maxScale", 2),
      });
      break;
    case "update.plane_collision":
      e.planeCollision({
        normal: readVec3(p, "normal", [0, 1, 0]),
        point: readVec3(p, "point", [0, 0, 0]),
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    case "update.sphere_collision":
      e.sphereCollision({
        center: readVec3(p, "center", [0, 0, 0]),
        radius: readNumber(p, "radius", 1),
        outside: readSelect(p, "side", ["outside", "inside"], "outside") === "outside",
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        worldSpace: readBool(p, "worldSpace", false),
      });
      break;
    case "update.sdf_collision":
      e.sdfCollision({
        sdf: buildSdf(readSdf(p, "sdf")),
        mode: readSelect(p, "mode", ["bounce", "stop", "kill"], "bounce") as SdfCollisionMode,
        restitution: readNumber(p, "restitution", 0.5),
        friction: readNumber(p, "friction", 0.9),
        thickness: readNumber(p, "thickness", 0.02),
        gradientEpsilon: readNumber(p, "gradientEpsilon", 0.01),
      });
      break;
    case "update.depth_collision":
      // Live preview only — depthTexture + camera must be supplied by the editor's
      // PreviewPane via CompileContext. Without them the module silently no-ops so
      // the rest of the graph still renders; code-export emits the call regardless.
      if (context.depthTexture && context.camera) {
        e.depthCollision({
          depthTexture: context.depthTexture,
          camera: context.camera,
          mode: readSelect(p, "mode", ["bounce", "stop", "kill"], "bounce") as DepthCollisionMode,
          normal: readSelect(
            p,
            "normal",
            ["depth-gradient", "camera"],
            "depth-gradient",
          ) as DepthCollisionNormal,
          restitution: readNumber(p, "restitution", 0.5),
          friction: readNumber(p, "friction", 0.9),
          thickness: readNumber(p, "thickness", 0.0005),
        });
      }
      break;
    case "update.flowmap_force": {
      const tex = readTexture(p, "texture");
      if (!tex) {
        // Module is opted-in by adding the node, but no texture chosen yet —
        // skip rather than throw so the user can still preview the rest of
        // the graph while uploading.
        break;
      }
      const sz = readRange(p, "size", [4, 4]);
      e.flowmapForce({
        texture: tex,
        origin: readVec3(p, "origin", [0, 0, 0]),
        size: sz,
        axis: readSelect(p, "axis", ["xz", "xy", "yz"], "xz") as FlowmapAxis,
        amplitude: readNumber(p, "amplitude", 1),
      });
      break;
    }

    // ── Render ──
    case "render.sprite": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        ["soft", "hard", "fire", "smoke", "spark", "texture_additive", "texture_luma_alpha"],
        "soft",
      ) as SpriteShader;
      // Texture-aware shaders combine texture + particle colour explicitly, so they
      // always get both inputs. Other presets fall back to procedural shaping when no
      // texture was uploaded; if a texture IS uploaded with a procedural shader, the
      // texture wins and the renderer's default (sample × particle.color) is used.
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const colorNode = isTextureShader || !tex ? buildSpriteColorNode(shader) : undefined;
      e.renderSprite({
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive") as
          | "additive"
          | "alpha"
          | "normal",
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        ...(tex ? { textures: { base: tex } } : {}),
        ...(colorNode ? { colorNode } : {}),
      });
      break;
    }
    case "render.ribbon": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        ["soft", "hard", "fire", "smoke", "spark", "texture_additive", "texture_luma_alpha"],
        "soft",
      ) as SpriteShader;
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const colorNode = isTextureShader || !tex ? buildSpriteColorNode(shader) : undefined;
      e.renderRibbon({
        width: readNumber(p, "width", 0.05),
        historyLength: readNumber(p, "historyLength", 32),
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive") as
          | "additive"
          | "alpha"
          | "normal",
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        ...(tex ? { textures: { base: tex } } : {}),
        ...(colorNode ? { colorNode } : {}),
      });
      break;
    }
    case "render.beam": {
      const tex = readTexture(p, "texture");
      const shader = readSelect(
        p,
        "shader",
        ["soft", "hard", "fire", "smoke", "spark", "texture_additive", "texture_luma_alpha"],
        "soft",
      ) as SpriteShader;
      const isTextureShader = shader === "texture_additive" || shader === "texture_luma_alpha";
      const colorNode = isTextureShader || !tex ? buildSpriteColorNode(shader) : undefined;
      e.renderBeam({
        width: readNumber(p, "width", 0.05),
        taperToTail: readSelect(p, "taper", ["to-tail", "uniform"], "to-tail") === "to-tail",
        blending: readSelect(p, "blending", ["additive", "alpha", "normal"], "additive") as
          | "additive"
          | "alpha"
          | "normal",
        opacity: readNumber(p, "opacity", 1),
        renderOrder: readNumber(p, "renderOrder", 0),
        ...(tex ? { textures: { base: tex } } : {}),
        ...(colorNode ? { colorNode } : {}),
      });
      break;
    }
    case "render.mesh": {
      const c = readVec3(p, "color", [1, 1, 1]);
      const matPreset = readSelect(
        p,
        "material",
        ["pbr", "magma", "emissive"],
        "pbr",
      ) as MeshShader;
      const material = buildMeshMaterial(
        matPreset,
        c,
        readNumber(p, "metalness", 0.1),
        readNumber(p, "roughness", 0.4),
      );
      e.renderMesh({
        geometry: buildGeometry(readGeometry(p, "geometry")),
        material,
        renderOrder: readNumber(p, "renderOrder", 0),
      });
      break;
    }
    case "render.light": {
      const c = readVec3(p, "color", [1, 0.85, 0.6]);
      e.renderLight({
        lightCount: readNumber(p, "lightCount", 4),
        color: new THREE.Color(c[0], c[1], c[2]),
        intensity: readNumber(p, "intensity", 1),
        distance: readNumber(p, "distance", 5),
        decay: readNumber(p, "decay", 2),
      });
      break;
    }

    case "emitter":
      // Already consumed at the top of `compileGraph` — appearing here means a duplicate.
      throw new CompileError("Multiple Emitter nodes — graph must have exactly one.");

    default:
      throw new CompileError(`Compiler doesn't know node type "${node.data.type}" yet.`);
  }
}

// ─ Param accessors with defaults ───────────────────────────────────────────

function readNumber(p: Params, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === "number" ? v : fallback;
}
function readRange(p: Params, key: string, fallback: [number, number]): [number, number] {
  const v = p[key];
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
    return [v[0], v[1]];
  }
  return fallback;
}
function readVec3(
  p: Params,
  key: string,
  fallback: [number, number, number],
): [number, number, number] {
  const v = p[key];
  if (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    typeof v[2] === "number"
  ) {
    return [v[0], v[1], v[2]];
  }
  return fallback;
}
function readShape(p: Params, key: string, fallback: EmissionShape): EmissionShape {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v) return v as EmissionShape;
  return fallback;
}
function readSelect(p: Params, key: string, options: string[], fallback: string): string {
  const v = p[key];
  return typeof v === "string" && options.includes(v) ? v : fallback;
}
function readBool(p: Params, key: string, fallback: boolean): boolean {
  const v = p[key];
  return typeof v === "boolean" ? v : fallback;
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function readCurve(p: Params, key: string, fallbackKeys: { t: number; v: number }[]): Curve1D {
  const v = p[key];
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "kind" in v &&
    v.kind === "curve1d" &&
    Array.isArray(v.keys) &&
    v.keys.length > 0
  ) {
    return new Curve1D(
      v.keys.map((k) => ({
        t: typeof k.t === "number" ? k.t : 0,
        v: typeof k.v === "number" ? k.v : 0,
      })),
    );
  }
  return new Curve1D(fallbackKeys);
}

import type { GeometryRef, SdfRef } from "./nodes.js";

function readGeometry(p: Params, key: string): GeometryRef {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "geometry") {
    return v;
  }
  return { kind: "geometry", preset: "sphere", radius: 0.5, widthSegments: 32, heightSegments: 16 };
}

function readEmitterRef(p: Params, key: string): string | undefined {
  const v = p[key];
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "kind" in v &&
    v.kind === "emitter-ref" &&
    typeof v.nodeId === "string"
  ) {
    return v.nodeId;
  }
  return undefined;
}

function readSdf(p: Params, key: string): SdfRef {
  const v = p[key];
  if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "sdf") {
    return v;
  }
  return { kind: "sdf", preset: "sphere", center: [0, 0, 0], radius: 1 };
}

function buildGeometry(g: GeometryRef): THREE.BufferGeometry {
  switch (g.preset) {
    case "sphere":
      return new THREE.SphereGeometry(g.radius, g.widthSegments, g.heightSegments);
    case "box":
      return new THREE.BoxGeometry(g.width, g.height, g.depth);
    case "torus":
      return new THREE.TorusGeometry(g.radius, g.tube, g.radialSegments, g.tubularSegments);
    case "cone":
      return new THREE.ConeGeometry(g.radius, g.height, g.radialSegments);
    case "cylinder":
      return new THREE.CylinderGeometry(g.radiusTop, g.radiusBottom, g.height, g.radialSegments);
    case "plane":
      return new THREE.PlaneGeometry(g.width, g.height);
  }
}

function buildSdf(s: SdfRef): SdfFn {
  switch (s.preset) {
    case "sphere":
      return sdfSphere(s.center, s.radius);
    case "box":
      return sdfBox(s.center, s.halfSize);
    case "plane":
      return sdfPlane(s.point, s.normal);
  }
}

function readTexture(p: Params, key: string): THREE.Texture | undefined {
  const v = p[key];
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "kind" in v &&
    v.kind === "texture" &&
    typeof v.dataUrl === "string"
  ) {
    return getTexture(v.dataUrl);
  }
  return undefined;
}

function readGradient(
  p: Params,
  key: string,
  fallbackStops: { t: number; color: [number, number, number, number] }[],
): Gradient {
  const v = p[key];
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "kind" in v &&
    v.kind === "gradient" &&
    Array.isArray(v.stops) &&
    v.stops.length > 0
  ) {
    return new Gradient(
      v.stops.map((s) => ({
        t: typeof s.t === "number" ? s.t : 0,
        color:
          Array.isArray(s.color) && s.color.length === 4
            ? ([s.color[0], s.color[1], s.color[2], s.color[3]] as [number, number, number, number])
            : [1, 1, 1, 1],
      })),
    );
  }
  return new Gradient(fallbackStops);
}
