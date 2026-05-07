/**
 * Preset graph gallery — hand-tuned VFX recipes that load with one click.
 *
 * Each preset is authored as a `(): { nodes, edges }` factory so node ids stay
 * fresh on every load (avoids collisions with existing graphs). Recipes use
 * the same `makeNode` / edge utilities as the starter graph and the full param
 * surface (color random ranges, angular velocity, world-space spawn origins,
 * collision params, etc.) so they look the way they're meant to look.
 */

import type { Edge } from "@xyflow/svelte";
import { makeNode, type PlumeNode } from "../graph/graphStore.svelte.js";

interface Preset {
  name: string;
  description: string;
  build(): { nodes: PlumeNode[]; edges: Edge[] };
}

type ParamPatch = PlumeNode["data"]["params"];

function texture(name: "flame.png" | "smoke-puff.png" | "ember.png") {
  return {
    kind: "texture" as const,
    dataUrl: `/textures/${name}`,
    name,
  };
}

function chain(
  nodes: PlumeNode[],
  ...patches: ParamPatch[]
): { nodes: PlumeNode[]; edges: Edge[] } {
  const out: PlumeNode[] = nodes.map((n, i) => {
    const patch = patches[i];
    if (!patch) return n;
    return {
      ...n,
      data: { ...n.data, params: { ...n.data.params, ...patch } as ParamPatch },
    };
  });
  const edges: Edge[] = [];
  for (let i = 1; i < out.length; i++) {
    const src = out[i - 1]!;
    const dst = out[i]!;
    edges.push({
      id: `e_${src.id}__${dst.id}`,
      source: src.id,
      target: dst.id,
      style: "stroke:#3a72ad;stroke-width:1.5;",
      interactionWidth: 18,
    });
  }
  return { nodes: out, edges };
}

function pos(
  category: "emitter" | "spawn" | "init" | "update" | "render",
  row: number,
): {
  x: number;
  y: number;
} {
  const X = { emitter: 80, spawn: 320, init: 560, update: 800, render: 1040 };
  return { x: X[category], y: 40 + row * 110 };
}

export const PRESETS: Preset[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Magic sparks — bright HDR sparks with curl noise + color ramp
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Arcane starburst",
    description: "A crisp violet-cyan fountain of HDR star sparks with controlled magical drift.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.rate", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.curl_noise", pos("update", 1)),
          makeNode("update.gravity", pos("update", 2)),
          makeNode("update.alpha_over_life", pos("update", 3)),
          makeNode("update.color_over_life", pos("update", 4)),
          makeNode("render.sprite", pos("render", 1)),
        ],
        { capacity: 1536, duration: 4, spawnOrigin: [0, 1, 0] },
        { rate: 480 },
        { lifetime: [0.9, 1.55] },
        { shape: { kind: "point" } },
        { shape: { kind: "sphere", radius: 1, thickness: 1 }, speed: [1.2, 3.0] },
        { size: [0.025, 0.075] },
        // Random per-particle violet → pink → cyan
        {
          color: [1.6, 0.6, 2.4],
          colorMax: [3.0, 1.4, 1.8],
          mode: "random range",
          alpha: 1,
        },
        {},
        { amplitude: 4.5, frequency: 1.6, speed: 1.0 },
        { acceleration: [0, -0.25, 0] },
        { fadeIn: 0.05, fadeOut: 0.5 },
        {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [3.4, 1.0, 5.0, 0] },
              { t: 0.12, color: [4.0, 1.6, 5.5, 1] },
              { t: 0.55, color: [1.2, 3.2, 5.0, 1] },
              { t: 1, color: [0.1, 1.2, 3.0, 0] },
            ],
          },
        },
        { shader: "spark", blending: "additive", opacity: 1, renderOrder: 10 },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Fire plume — multi-emitter composite: flames + embers + smoke
  //
  // Uses shipped textures only for secondary detail:
  //   - smoke-puff.png → soft cloud puff, rendered alpha-blended with the
  //                       texture's luminance keyed as alpha (so dark grey
  //                       smoke can DARKEN the scene behind it).
  //   - ember.png      → vertical streak ember; rotation locked to 0 so the
  //                       streak stays oriented along world-Y.
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Cinematic fire plume",
    description: "Layered flame tongues and curling side wisps that dance around a white-hot core.",
    build() {
      function patch<T extends PlumeNode>(n: T, p: T["data"]["params"]): T {
        return { ...n, data: { ...n.data, params: { ...n.data.params, ...p } } } as T;
      }
      function edge(src: PlumeNode, dst: PlumeNode): Edge {
        return {
          id: `e_${src.id}__${dst.id}`,
          source: src.id,
          target: dst.id,
          style: "stroke:#3a72ad;stroke-width:1.5;",
          interactionWidth: 18,
        };
      }

      // Fire is procedural here so every particle gets a different multi-arm
      // silhouette. The single flame photo is still useful as an asset example,
      // but repeating it in the body made the whole plume read cone-shaped.
      const smokeTex = texture("smoke-puff.png");
      const emberTex = texture("ember.png");

      // ── Flame body — broad low-opacity tongues that make the main mass ──
      const flameE = makeNode("emitter", { x: 80, y: 60 });
      const flameS = makeNode("spawn.rate", { x: 320, y: 60 });
      const flameL = makeNode("init.lifetime", { x: 560, y: 40 });
      const flameP = makeNode("init.position", { x: 560, y: 150 });
      const flameV = makeNode("init.velocity", { x: 560, y: 260 });
      const flameSize = makeNode("init.size", { x: 560, y: 370 });
      const flameRot = makeNode("init.rotation", { x: 560, y: 480 });
      const flameC = makeNode("init.color", { x: 560, y: 590 });
      const flameI = makeNode("update.integrate", { x: 800, y: 40 });
      const flameCurl = makeNode("update.curl_noise", { x: 800, y: 150 });
      const flameD = makeNode("update.drag", { x: 800, y: 260 });
      const flameSOL = makeNode("update.size_over_life", { x: 800, y: 370 });
      const flameCOL = makeNode("update.color_over_life", { x: 800, y: 480 });
      const flameR = makeNode("render.sprite", { x: 1040, y: 60 });

      // ── Hot inner core — small bright fast flickers near the base ──────
      const coreE = makeNode("emitter", { x: 80, y: 760 });
      const coreS = makeNode("spawn.rate", { x: 320, y: 760 });
      const coreL = makeNode("init.lifetime", { x: 560, y: 720 });
      const coreP = makeNode("init.position", { x: 560, y: 830 });
      const coreV = makeNode("init.velocity", { x: 560, y: 940 });
      const coreSize = makeNode("init.size", { x: 560, y: 1050 });
      const coreRot = makeNode("init.rotation", { x: 560, y: 1160 });
      const coreC = makeNode("init.color", { x: 560, y: 1270 });
      const coreI = makeNode("update.integrate", { x: 800, y: 720 });
      const coreD = makeNode("update.drag", { x: 800, y: 830 });
      const coreSOL = makeNode("update.size_over_life", { x: 800, y: 940 });
      const coreCOL = makeNode("update.color_over_life", { x: 800, y: 1050 });
      const coreR = makeNode("render.sprite", { x: 1040, y: 760 });

      // ── Side wisps — small hotter tongues that peel away into arms ─────
      const wispE = makeNode("emitter", { x: 80, y: 1460 });
      const wispS = makeNode("spawn.rate", { x: 320, y: 1460 });
      const wispL = makeNode("init.lifetime", { x: 560, y: 1420 });
      const wispP = makeNode("init.position", { x: 560, y: 1530 });
      const wispV = makeNode("init.velocity", { x: 560, y: 1640 });
      const wispSize = makeNode("init.size", { x: 560, y: 1750 });
      const wispRot = makeNode("init.rotation", { x: 560, y: 1860 });
      const wispC = makeNode("init.color", { x: 560, y: 1970 });
      const wispI = makeNode("update.integrate", { x: 800, y: 1420 });
      const wispCurl = makeNode("update.curl_noise", { x: 800, y: 1530 });
      const wispD = makeNode("update.drag", { x: 800, y: 1640 });
      const wispSOL = makeNode("update.size_over_life", { x: 800, y: 1750 });
      const wispCOL = makeNode("update.color_over_life", { x: 800, y: 1860 });
      const wispR = makeNode("render.sprite", { x: 1040, y: 1460 });

      // ── Smoke — chained from outer-flame deaths ─────────────────────────
      const smokeE = makeNode("emitter", { x: 80, y: 2160 });
      const smokeS = makeNode("spawn.from_events", { x: 320, y: 2160 });
      const smokeL = makeNode("init.lifetime", { x: 560, y: 2120 });
      const smokeV = makeNode("init.velocity", { x: 560, y: 2230 });
      const smokeSize = makeNode("init.size", { x: 560, y: 2340 });
      const smokeC = makeNode("init.color", { x: 560, y: 2450 });
      const smokeRot = makeNode("init.rotation", { x: 560, y: 2560 });
      const smokeI = makeNode("update.integrate", { x: 800, y: 2120 });
      const smokeG = makeNode("update.gravity", { x: 800, y: 2230 });
      const smokeDrag = makeNode("update.drag", { x: 800, y: 2340 });
      const smokeTurb = makeNode("update.turbulence", { x: 800, y: 2450 });
      const smokeSOL = makeNode("update.size_over_life", { x: 800, y: 2560 });
      const smokeCOL = makeNode("update.color_over_life", { x: 800, y: 2670 });
      const smokeR = makeNode("render.sprite", { x: 1040, y: 2160 });

      // ── Embers — chained from outer-flame deaths ────────────────────────
      const emberE = makeNode("emitter", { x: 80, y: 2860 });
      const emberS = makeNode("spawn.from_events", { x: 320, y: 2860 });
      const emberL = makeNode("init.lifetime", { x: 560, y: 2820 });
      const emberV = makeNode("init.velocity", { x: 560, y: 2930 });
      const emberSize = makeNode("init.size", { x: 560, y: 3040 });
      const emberRot = makeNode("init.rotation", { x: 560, y: 3150 });
      const emberC = makeNode("init.color", { x: 560, y: 3260 });
      const emberI = makeNode("update.integrate", { x: 800, y: 2820 });
      const emberG = makeNode("update.gravity", { x: 800, y: 2930 });
      const emberTurb = makeNode("update.turbulence", { x: 800, y: 3040 });
      const emberA = makeNode("update.alpha_over_life", { x: 800, y: 3150 });
      const emberR = makeNode("render.sprite", { x: 1040, y: 2860 });

      const nodes: PlumeNode[] = [
        // ── Flame body ────────────────────────────────────────────────────
        // Wider spawn, looser cone, low opacity. The body should breathe and
        // leave holes rather than fill a perfect triangle.
        patch(flameE, { capacity: 160, duration: 12, spawnOrigin: [0, 0.04, 0], loop: true }),
        patch(flameS, { rate: 72 }),
        patch(flameL, { lifetime: [0.58, 1.05] }),
        patch(flameP, { shape: { kind: "disc", radius: 0.22, thickness: 1 } }),
        patch(flameV, {
          shape: { kind: "cone", angle: 0.32 },
          speed: [0.8, 1.75],
        }),
        patch(flameSize, { size: [0.72, 1.28] }),
        patch(flameRot, { rotation: [-0.38, 0.38], angularVelocity: [-0.55, 0.55] }),
        patch(flameC, {
          color: [2.1, 1.05, 0.35],
          colorMax: [2.8, 1.45, 0.55],
          mode: "random range",
          alpha: 1,
        }),
        flameI,
        patch(flameCurl, { amplitude: 1.35, frequency: 0.85, speed: 0.95 }),
        patch(flameD, { coefficient: 0.75 }),
        patch(flameSOL, {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 0.55 },
              { t: 0.25, v: 1.05 },
              { t: 0.72, v: 0.72 },
              { t: 1, v: 0.22 },
            ],
          },
        }),
        patch(flameCOL, {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [3.0, 1.75, 0.55, 0] },
              { t: 0.1, color: [2.8, 1.45, 0.35, 0.75] },
              { t: 0.55, color: [2.0, 0.55, 0.12, 0.48] },
              { t: 1, color: [0.45, 0.06, 0.02, 0] },
            ],
          },
        }),
        patch(flameR, {
          shader: "fire",
          blending: "additive",
          opacity: 0.64,
          renderOrder: 5,
        }),

        // ── Hot core ──────────────────────────────────────────────────────
        // Bright white-yellow flames concentrated at the base, shorter than
        // the outer flame so the inner fire glows from the bottom only.
        patch(coreE, { capacity: 56, duration: 12, spawnOrigin: [0, 0.02, 0], loop: true }),
        patch(coreS, { rate: 44 }),
        patch(coreL, { lifetime: [0.32, 0.58] }),
        patch(coreP, { shape: { kind: "disc", radius: 0.07, thickness: 1 } }),
        patch(coreV, {
          shape: { kind: "cone", angle: 0.18 },
          speed: [0.75, 1.35],
        }),
        patch(coreSize, { size: [0.44, 0.82] }),
        patch(coreRot, { rotation: [-0.18, 0.18], angularVelocity: [-0.25, 0.25] }),
        patch(coreC, {
          color: [4.0, 3.0, 1.4],
          colorMax: [4.6, 3.6, 1.8],
          mode: "random range",
          alpha: 1,
        }),
        coreI,
        patch(coreD, { coefficient: 1.4 }),
        patch(coreSOL, {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 0.65 },
              { t: 0.35, v: 1.0 },
              { t: 1, v: 0.25 },
            ],
          },
        }),
        patch(coreCOL, {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [4.5, 3.6, 1.8, 0] },
              { t: 0.18, color: [4.2, 3.0, 1.2, 1] },
              { t: 0.65, color: [3.0, 1.4, 0.3, 0.7] },
              { t: 1, color: [1.0, 0.25, 0.05, 0] },
            ],
          },
        }),
        patch(coreR, {
          shader: "fire",
          blending: "additive",
          opacity: 0.58,
          renderOrder: 6,
        }),

        // ── Side wisps ───────────────────────────────────────────────────
        // These are the dancing arms: broader launch cone, stronger curl,
        // bigger rotation range, shorter life. They peel away from the main
        // body and keep the silhouette from resolving into one cone.
        patch(wispE, { capacity: 180, duration: 12, spawnOrigin: [0, 0.12, 0], loop: true }),
        patch(wispS, { rate: 92 }),
        patch(wispL, { lifetime: [0.42, 0.9] }),
        patch(wispP, { shape: { kind: "ring", radius: 0.28, thickness: 0.55 } }),
        patch(wispV, {
          shape: { kind: "cone", angle: 0.58 },
          speed: [0.7, 2.15],
        }),
        patch(wispSize, { size: [0.34, 0.92] }),
        patch(wispRot, { rotation: [-0.95, 0.95], angularVelocity: [-1.35, 1.35] }),
        patch(wispC, {
          color: [2.4, 0.78, 0.16],
          colorMax: [3.2, 1.35, 0.34],
          mode: "random range",
          alpha: 1,
        }),
        wispI,
        patch(wispCurl, { amplitude: 2.2, frequency: 1.15, speed: 1.35 }),
        patch(wispD, { coefficient: 0.95 }),
        patch(wispSOL, {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 0.25 },
              { t: 0.3, v: 1.0 },
              { t: 0.72, v: 0.55 },
              { t: 1, v: 0.08 },
            ],
          },
        }),
        patch(wispCOL, {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [3.0, 1.2, 0.28, 0] },
              { t: 0.16, color: [3.0, 1.1, 0.22, 0.72] },
              { t: 0.55, color: [2.2, 0.45, 0.08, 0.45] },
              { t: 1, color: [0.7, 0.08, 0.02, 0] },
            ],
          },
        }),
        patch(wispR, {
          shader: "fire",
          blending: "additive",
          opacity: 0.62,
          renderOrder: 7,
        }),

        // ── Smoke ─────────────────────────────────────────────────────────
        // Textured, low-alpha smoke born above the flame. It should feel like
        // heat exhaust, not a gray ball sitting inside the fire.
        patch(smokeE, { capacity: 512, duration: 12, spawnOrigin: [0, 0, 0], loop: true }),
        patch(smokeS, {
          source: { kind: "emitter-ref", nodeId: flameE.id },
          perEvent: 2,
          maxEventsPerFrame: 64,
          inheritVelocity: false,
        }),
        patch(smokeL, { lifetime: [2.4, 4.0] }),
        patch(smokeV, {
          shape: { kind: "cone", angle: 0.4 },
          speed: [0.45, 1.0],
        }),
        patch(smokeSize, { size: [0.28, 0.52] }),
        patch(smokeC, {
          color: [0.34, 0.33, 0.32],
          colorMax: [0.56, 0.54, 0.5],
          mode: "random range",
          alpha: 0.55,
        }),
        // Random rotation per puff so the noise pattern doesn't repeat.
        patch(smokeRot, { rotation: [0, 6.283], angularVelocity: [-0.4, 0.4] }),
        smokeI,
        patch(smokeG, { acceleration: [0, 0.45, 0] }),
        patch(smokeDrag, { coefficient: 0.45 }),
        patch(smokeTurb, { amplitude: 0.9, frequency: 0.45, speed: 0.35, octaves: 2 }),
        patch(smokeSOL, {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 0.45 },
              { t: 0.45, v: 1.6 },
              { t: 1, v: 3.1 },
            ],
          },
        }),
        patch(smokeCOL, {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [0.45, 0.39, 0.32, 0] },
              { t: 0.22, color: [0.42, 0.38, 0.34, 0.1] },
              { t: 0.55, color: [0.36, 0.36, 0.37, 0.28] },
              { t: 0.88, color: [0.22, 0.23, 0.25, 0.13] },
              { t: 1, color: [0.12, 0.12, 0.14, 0] },
            ],
          },
        }),
        patch(smokeR, {
          shader: "texture_luma_alpha",
          texture: smokeTex,
          blending: "alpha",
          opacity: 0.9,
          renderOrder: 0,
        }),

        // ── Embers ────────────────────────────────────────────────────────
        // Spawned at outer-flame death points. Vertical streak texture →
        // rotation locked to 0 so the streak stays oriented along Y. Strong
        // upward velocity, light turbulence so they don't all rise straight.
        patch(emberE, { capacity: 192, duration: 12, spawnOrigin: [0, 0, 0], loop: true }),
        patch(emberS, {
          source: { kind: "emitter-ref", nodeId: flameE.id },
          perEvent: 2,
          maxEventsPerFrame: 64,
          inheritVelocity: false,
        }),
        patch(emberL, { lifetime: [1.0, 2.0] }),
        patch(emberV, {
          shape: { kind: "cone", angle: 0.22 },
          speed: [1.6, 3.2],
        }),
        // Texture is portrait (~1:2), so size roughly 0.06–0.12 reads as a
        // small streak when rendered on a square quad.
        patch(emberSize, { size: [0.06, 0.12] }),
        patch(emberRot, { rotation: [0, 0], angularVelocity: [0, 0] }),
        patch(emberC, {
          color: [4.0, 2.0, 0.4],
          colorMax: [5.0, 2.8, 0.6],
          mode: "random range",
          alpha: 1,
        }),
        emberI,
        patch(emberG, { acceleration: [0, 1.0, 0] }),
        patch(emberTurb, { amplitude: 1.4, frequency: 1.2, speed: 1.0, octaves: 2 }),
        patch(emberA, { fadeIn: 0.05, fadeOut: 0.5 }),
        patch(emberR, {
          shader: "texture_additive",
          texture: emberTex,
          blending: "additive",
          opacity: 1,
          renderOrder: 8,
        }),
      ];

      const edges: Edge[] = [
        // Outer-flame chain
        edge(flameE, flameS),
        edge(flameS, flameL),
        edge(flameL, flameP),
        edge(flameP, flameV),
        edge(flameV, flameSize),
        edge(flameSize, flameRot),
        edge(flameRot, flameC),
        edge(flameC, flameI),
        edge(flameI, flameCurl),
        edge(flameCurl, flameD),
        edge(flameD, flameSOL),
        edge(flameSOL, flameCOL),
        edge(flameCOL, flameR),

        // Hot-core chain
        edge(coreE, coreS),
        edge(coreS, coreL),
        edge(coreL, coreP),
        edge(coreP, coreV),
        edge(coreV, coreSize),
        edge(coreSize, coreRot),
        edge(coreRot, coreC),
        edge(coreC, coreI),
        edge(coreI, coreD),
        edge(coreD, coreSOL),
        edge(coreSOL, coreCOL),
        edge(coreCOL, coreR),

        // Side-wisp chain
        edge(wispE, wispS),
        edge(wispS, wispL),
        edge(wispL, wispP),
        edge(wispP, wispV),
        edge(wispV, wispSize),
        edge(wispSize, wispRot),
        edge(wispRot, wispC),
        edge(wispC, wispI),
        edge(wispI, wispCurl),
        edge(wispCurl, wispD),
        edge(wispD, wispSOL),
        edge(wispSOL, wispCOL),
        edge(wispCOL, wispR),

        // Smoke chain
        edge(smokeE, smokeS),
        edge(smokeS, smokeL),
        edge(smokeL, smokeV),
        edge(smokeV, smokeSize),
        edge(smokeSize, smokeC),
        edge(smokeC, smokeRot),
        edge(smokeRot, smokeI),
        edge(smokeI, smokeG),
        edge(smokeG, smokeDrag),
        edge(smokeDrag, smokeTurb),
        edge(smokeTurb, smokeSOL),
        edge(smokeSOL, smokeCOL),
        edge(smokeCOL, smokeR),

        // Ember chain
        edge(emberE, emberS),
        edge(emberS, emberL),
        edge(emberL, emberV),
        edge(emberV, emberSize),
        edge(emberSize, emberRot),
        edge(emberRot, emberC),
        edge(emberC, emberI),
        edge(emberI, emberG),
        edge(emberG, emberTurb),
        edge(emberTurb, emberA),
        edge(emberA, emberR),
      ];

      return { nodes, edges };
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Smoke puff — slow rising, large soft particles, alpha-blended
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Hero smoke bloom",
    description: "Layered textured smoke puffs that billow upward, roll, and cool out softly.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.rate", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("init.rotation", pos("init", 5)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.drag", pos("update", 1)),
          makeNode("update.gravity", pos("update", 2)),
          makeNode("update.turbulence", pos("update", 3)),
          makeNode("update.size_over_life", pos("update", 4)),
          makeNode("update.alpha_over_life", pos("update", 5)),
          makeNode("render.sprite", pos("render", 1)),
        ],
        { capacity: 384, duration: 7, spawnOrigin: [0, 0.25, 0] },
        { rate: 34 },
        { lifetime: [3.0, 5.2] },
        { shape: { kind: "disc", radius: 0.32, thickness: 1 } },
        { shape: { kind: "cone", angle: 0.55 }, speed: [0.25, 0.8] },
        { size: [0.36, 0.72] },
        // Subtle gray variance — keeps the smoke from looking like a solid wall.
        {
          color: [0.28, 0.29, 0.31],
          colorMax: [0.64, 0.64, 0.68],
          mode: "random range",
          alpha: 0.5,
        },
        // Slow tumble.
        { rotation: [0, 6.28], angularVelocity: [-0.18, 0.18] },
        {},
        { coefficient: 0.55 },
        { acceleration: [0, 0.34, 0] },
        { amplitude: 1.05, frequency: 0.42, speed: 0.28, octaves: 3 },
        {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 0.35 },
              { t: 0.45, v: 1.45 },
              { t: 1, v: 3.4 },
            ],
          },
        },
        { fadeIn: 0.18, fadeOut: 0.55 },
        {
          shader: "texture_luma_alpha",
          texture: texture("smoke-puff.png"),
          blending: "alpha",
          opacity: 0.9,
          renderOrder: 0,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Galaxy swirl — slow orbiting disc with a bright sun at the center
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Black-hole galaxy",
    description: "A pink-cyan accretion disc spiraling around a white-hot animated star core.",
    build() {
      function patch<T extends PlumeNode>(n: T, p: T["data"]["params"]): T {
        return { ...n, data: { ...n.data, params: { ...n.data.params, ...p } } } as T;
      }
      function edge(src: PlumeNode, dst: PlumeNode): Edge {
        return {
          id: `e_${src.id}__${dst.id}`,
          source: src.id,
          target: dst.id,
          style: "stroke:#3a72ad;stroke-width:1.5;",
          interactionWidth: 18,
        };
      }

      // ── Disc emitter (orbiting particles) — top half of the canvas ──────
      const discEmitter = makeNode("emitter", { x: 80, y: 60 });
      const discSpawn = makeNode("spawn.rate", { x: 320, y: 60 });
      const discLifetime = makeNode("init.lifetime", { x: 560, y: 40 });
      const discPosition = makeNode("init.position", { x: 560, y: 150 });
      const discVelocity = makeNode("init.velocity", { x: 560, y: 260 });
      const discSize = makeNode("init.size", { x: 560, y: 370 });
      const discColor = makeNode("init.color", { x: 560, y: 480 });
      const discIntegrate = makeNode("update.integrate", { x: 800, y: 40 });
      const discVortex = makeNode("update.vortex", { x: 800, y: 150 });
      const discAttractor = makeNode("update.point_attractor", { x: 800, y: 260 });
      const discDrag = makeNode("update.drag", { x: 800, y: 370 });
      const discAlpha = makeNode("update.alpha_over_life", { x: 800, y: 480 });
      const discColorOverLife = makeNode("update.color_over_life", { x: 800, y: 590 });
      const discRender = makeNode("render.sprite", { x: 1040, y: 60 });

      // ── Sun emitter (single long-lived sphere, magma material) ──────────
      // ONE particle that lives for the whole loop — no spawn flicker. The
      // magma material does its own time-based noise animation, so the sun
      // appears to swirl/boil naturally without spawning new particles.
      const sunEmitter = makeNode("emitter", { x: 80, y: 760 });
      const sunSpawn = makeNode("spawn.burst", { x: 320, y: 760 });
      const sunLifetime = makeNode("init.lifetime", { x: 560, y: 720 });
      const sunPosition = makeNode("init.position", { x: 560, y: 830 });
      const sunVelocity = makeNode("init.velocity", { x: 560, y: 940 });
      const sunSize = makeNode("init.size", { x: 560, y: 1050 });
      const sunColor = makeNode("init.color", { x: 560, y: 1160 });
      const sunIntegrate = makeNode("update.integrate", { x: 800, y: 720 });
      const sunRender = makeNode("render.mesh", { x: 1040, y: 760 });

      const nodes: PlumeNode[] = [
        // Disc emitter — the orbiting particles
        patch(discEmitter, { capacity: 2048, duration: 12, spawnOrigin: [0, 1.2, 0] }),
        patch(discSpawn, { rate: 300 }),
        patch(discLifetime, { lifetime: [7.0, 11.0] }),
        patch(discPosition, {
          shape: { kind: "ring", radius: 3.1, thickness: 0.45 },
          worldSpace: false,
        }),
        patch(discVelocity, {
          shape: { kind: "point" },
          speed: [0, 0],
          worldSpace: false,
        }),
        patch(discSize, { size: [0.018, 0.055] }),
        patch(discColor, {
          color: [2.6, 1.0, 1.6],
          colorMax: [1.0, 2.2, 3.0],
          mode: "random range",
          alpha: 1,
        }),
        discIntegrate,
        patch(discVortex, {
          axis: [0, 1, 0],
          origin: [0, 1.2, 0],
          strength: 2.4,
          worldSpace: true,
        }),
        patch(discAttractor, {
          position: [0, 1.2, 0],
          strength: 0.85,
          radius: 7,
          falloff: "linear",
          worldSpace: true,
        }),
        patch(discDrag, { coefficient: 0.3 }),
        patch(discAlpha, { fadeIn: 0.1, fadeOut: 0.25 }),
        patch(discColorOverLife, {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [2.0, 1.0, 2.8, 0] },
              { t: 0.2, color: [2.6, 1.4, 3.2, 1] },
              { t: 0.7, color: [1.4, 2.4, 3.4, 1] },
              { t: 1, color: [0.4, 0.8, 1.6, 0] },
            ],
          },
        }),
        patch(discRender, { shader: "spark", blending: "additive", opacity: 0.95, renderOrder: 5 }),

        // Sun: single particle, very long lifetime, sphere mesh with magma
        // material. The magma shader animates noise over time so the surface
        // looks like flowing lava without needing to respawn particles.
        patch(sunEmitter, { capacity: 4, duration: 100, spawnOrigin: [0, 1.2, 0] }),
        patch(sunSpawn, { time: 0, count: 1 }),
        patch(sunLifetime, { lifetime: [1000, 1000] }),
        patch(sunPosition, {
          shape: { kind: "point" },
          worldSpace: false,
        }),
        patch(sunVelocity, {
          shape: { kind: "point" },
          speed: [0, 0],
          worldSpace: false,
        }),
        patch(sunSize, { size: [1.25, 1.25] }),
        // Magma material does its own colour — these RGB values are unused,
        // but plume requires init.color to set particle.alpha.
        patch(sunColor, {
          color: [1, 1, 1],
          mode: "solid",
          alpha: 1,
        }),
        sunIntegrate,
        patch(sunRender, {
          geometry: {
            kind: "geometry",
            preset: "sphere",
            radius: 0.5,
            widthSegments: 64,
            heightSegments: 32,
          },
          material: "magma",
          color: [1, 1, 1],
          metalness: 0,
          roughness: 1,
          renderOrder: 2,
        }),
      ];

      const edges: Edge[] = [
        // Disc chain
        edge(discEmitter, discSpawn),
        edge(discSpawn, discLifetime),
        edge(discLifetime, discPosition),
        edge(discPosition, discVelocity),
        edge(discVelocity, discSize),
        edge(discSize, discColor),
        edge(discColor, discIntegrate),
        edge(discIntegrate, discVortex),
        edge(discVortex, discAttractor),
        edge(discAttractor, discDrag),
        edge(discDrag, discAlpha),
        edge(discAlpha, discColorOverLife),
        edge(discColorOverLife, discRender),

        // Sun chain
        edge(sunEmitter, sunSpawn),
        edge(sunSpawn, sunLifetime),
        edge(sunLifetime, sunPosition),
        edge(sunPosition, sunVelocity),
        edge(sunVelocity, sunSize),
        edge(sunSize, sunColor),
        edge(sunColor, sunIntegrate),
        edge(sunIntegrate, sunRender),
      ];

      return { nodes, edges };
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Rain — sky-to-ground HDR drops, plane collision, dense visible volume
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Monsoon sheet",
    description:
      "Dense cool rain streaks sweeping through the camera frame without sticky floor artifacts.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.rate", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.gravity", pos("update", 1)),
          makeNode("update.drag", pos("update", 2)),
          makeNode("update.limit_velocity", pos("update", 3)),
          makeNode("update.alpha_over_life", pos("update", 4)),
          makeNode("render.beam", pos("render", 1)),
        ],
        // Spawn high and expire before particles can sit on the ground. A
        // previous floor-collision version left long beams pinned to impact
        // points because beams reconstruct their tail from initial velocity.
        { capacity: 2048, duration: 12, spawnOrigin: [0, 6.5, 0] },
        // Heavy rate so the volume reads as actual rain.
        { rate: 1400 },
        { lifetime: [0.45, 0.72] },
        { shape: { kind: "box", size: [11, 0.1, 11] } },
        { shape: { kind: "point" }, speed: [-17, -12] },
        // Bigger so each drop is visible against the dark scene.
        { size: [0.05, 0.09] },
        // HDR cool blue — bright enough to hold against additive blending.
        {
          color: [0.8, 1.4, 3.0],
          colorMax: [1.4, 2.0, 4.0],
          mode: "random range",
          alpha: 1,
        },
        {},
        { acceleration: [0, -8, 0] },
        { coefficient: 0.08 },
        { maxSpeed: 18, damping: 1 },
        { fadeIn: 0, fadeOut: 0.35 },
        {
          shader: "soft",
          width: 0.026,
          taper: "to-tail",
          blending: "additive",
          opacity: 0.82,
          renderOrder: 5,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Lightning — bright zig-zag bolts plunging from sky to ground
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Storm strike",
    description:
      "Multiple jagged plasma ribbons tearing from sky to ground in a camera-filling flash.",
    build() {
      // Each bolt = ribbon trail of one fast-falling particle. Its history
      // captures the curving path through space; turbulence makes that path
      // jagged. Several particles per burst → several bolts on screen.
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.burst", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.gravity", pos("update", 1)),
          makeNode("update.turbulence", pos("update", 2)),
          makeNode("update.alpha_over_life", pos("update", 3)),
          makeNode("render.ribbon", pos("render", 1)),
        ],
        // Short violent strike with a clean gap before the next flash.
        { capacity: 12, duration: 0.9, spawnOrigin: [0, 5.2, 0] },
        { time: 0, count: 3 },
        { lifetime: [0.22, 0.34] },
        { shape: { kind: "box", size: [2.4, 0.05, 2.4] } },
        // Fast downward launch makes the trail form immediately; turbulence
        // cuts the path into angular-looking segments.
        { shape: { kind: "cone", angle: 0.08 }, speed: [-30, -22] },
        { size: [0.04, 0.065] },
        {
          color: [4.0, 7.0, 14.0],
          colorMax: [6.0, 9.0, 16.0],
          mode: "random range",
          alpha: 1,
        },
        {},
        { acceleration: [0, -35, 0] },
        // Powerful high-frequency turbulence makes the zig-zag.
        { amplitude: 38, frequency: 24, speed: 5, octaves: 4 },
        { fadeIn: 0.0, fadeOut: 0.65 },
        // Thick ribbon "rod" + long history captures the full jagged path.
        {
          shader: "soft",
          width: 0.045,
          historyLength: 40,
          blending: "additive",
          opacity: 1,
          renderOrder: 12,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Plasma burst — directional beams from a center point, taper-to-tail
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Nova lances",
    description:
      "A spherical shock of sharp violet-blue energy lances bursting outward from a core.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.burst", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.drag", pos("update", 1)),
          makeNode("update.scale_by_speed", pos("update", 2)),
          makeNode("update.alpha_over_life", pos("update", 3)),
          makeNode("render.beam", pos("render", 1)),
        ],
        { capacity: 160, duration: 1.15, spawnOrigin: [0, 1.4, 0] },
        { time: 0, count: 56 },
        { lifetime: [0.55, 0.95] },
        { shape: { kind: "sphere", radius: 0.15, thickness: 1 } },
        { shape: { kind: "sphere", radius: 1, thickness: 0 }, speed: [6, 12] },
        { size: [1, 1] },
        {
          color: [4.0, 2.0, 6.0],
          colorMax: [2.0, 4.0, 6.0],
          mode: "random range",
          alpha: 1,
        },
        {},
        { coefficient: 0.75 },
        { minSpeed: 0, maxSpeed: 12, minScale: 0.25, maxScale: 1.45 },
        { fadeIn: 0.0, fadeOut: 0.5 },
        {
          shader: "soft",
          width: 0.145,
          taper: "to-tail",
          blending: "additive",
          opacity: 0.95,
          renderOrder: 10,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Confetti — rainbow flat-card mesh tumbling in gravity + floor bounce
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Prismatic confetti burst",
    description: "Hundreds of colored metallic cards spray outward, tumble, bounce, and settle.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.burst", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("init.rotation", pos("init", 5)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.gravity", pos("update", 1)),
          makeNode("update.drag", pos("update", 2)),
          makeNode("update.plane_collision", pos("update", 3)),
          makeNode("update.color_over_life", pos("update", 4)),
          makeNode("render.mesh", pos("render", 1)),
        ],
        { capacity: 512, duration: 6, spawnOrigin: [0, 2.35, 0] },
        { time: 0, count: 300 },
        { lifetime: [4.5, 6.0] },
        { shape: { kind: "sphere", radius: 0.4, thickness: 0 } },
        { shape: { kind: "sphere", radius: 1, thickness: 1 }, speed: [2.7, 5.6] },
        { size: [1, 1] },
        // Hot-pink → green-yellow random for a real confetti spread.
        {
          color: [2.4, 0.4, 1.2],
          colorMax: [0.4, 2.4, 0.4],
          mode: "random range",
          alpha: 1,
        },
        // Tumble + spin makes the flat cards readable.
        { rotation: [0, 6.28], angularVelocity: [-12, 12] },
        {},
        { acceleration: [0, -8, 0] },
        { coefficient: 1.35 },
        // Floor at world y=0 — soft bounce + lots of friction so cards settle.
        {
          normal: [0, 1, 0],
          point: [0, 0, 0],
          restitution: 0.25,
          friction: 0.85,
          worldSpace: true,
        },
        {
          gradient: {
            kind: "gradient",
            stops: [
              { t: 0, color: [1, 1, 1, 1] },
              { t: 0.75, color: [1, 1, 1, 1] },
              { t: 1, color: [1, 1, 1, 0] },
            ],
          },
        },
        // Real confetti card dimensions.
        {
          geometry: { kind: "geometry", preset: "box", width: 0.16, height: 0.12, depth: 0.004 },
          color: [1, 1, 1],
          metalness: 0.05,
          roughness: 0.6,
          renderOrder: 0,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Snow — slow drifting flakes with low gravity and broad scatter
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Dream snowfield",
    description: "Soft layered flakes drifting through a wide, calm wind field.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.rate", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.position", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("init.rotation", pos("init", 5)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.gravity", pos("update", 1)),
          makeNode("update.curl_noise", pos("update", 2)),
          makeNode("update.alpha_over_life", pos("update", 3)),
          makeNode("render.sprite", pos("render", 1)),
        ],
        { capacity: 1024, duration: 12, spawnOrigin: [0, 6, 0] },
        { rate: 75 },
        { lifetime: [6.5, 11] },
        { shape: { kind: "box", size: [9, 0.1, 9] } },
        { shape: { kind: "point" }, speed: [0, 0] },
        { size: [0.035, 0.11] },
        {
          color: [1.4, 1.5, 1.8],
          colorMax: [2.0, 2.0, 2.4],
          mode: "random range",
          alpha: 0.9,
        },
        // Spin slowly — flakes rotate as they fall.
        { rotation: [0, 6.28], angularVelocity: [-0.4, 0.4] },
        {},
        { acceleration: [0, -0.32, 0] },
        // Gentle horizontal drift via curl noise — looks like wind.
        { amplitude: 0.55, frequency: 0.32, speed: 0.24 },
        { fadeIn: 0.18, fadeOut: 0.35 },
        { shader: "soft", blending: "alpha", opacity: 0.95, renderOrder: 0 },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Mesh shatter — torus surface explosion with tumbling chunks + bounce
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Crystal shatter",
    description:
      "A glowing torus detonates into thousands of colored metallic shards that bounce outward.",
    build() {
      return chain(
        [
          makeNode("emitter", pos("emitter", 2)),
          makeNode("spawn.burst", pos("spawn", 2)),
          makeNode("init.lifetime", pos("init", 0)),
          makeNode("init.from_mesh", pos("init", 1)),
          makeNode("init.velocity", pos("init", 2)),
          makeNode("init.size", pos("init", 3)),
          makeNode("init.color", pos("init", 4)),
          makeNode("init.rotation", pos("init", 5)),
          makeNode("update.integrate", pos("update", 0)),
          makeNode("update.gravity", pos("update", 1)),
          makeNode("update.plane_collision", pos("update", 2)),
          makeNode("update.alpha_over_life", pos("update", 3)),
          makeNode("render.mesh", pos("render", 1)),
        ],
        { capacity: 2048, duration: 5, spawnOrigin: [0, 1.6, 0] },
        { time: 0, count: 1900 },
        { lifetime: [3, 4] },
        // Spawn directly from a torus surface — mesh-explosion read.
        {
          geometry: {
            kind: "geometry",
            preset: "torus",
            radius: 0.7,
            tube: 0.18,
            radialSegments: 32,
            tubularSegments: 64,
          },
          fill: "surface",
          worldSpace: false,
          volumeSampleCount: 2048,
        },
        { shape: { kind: "sphere", radius: 1, thickness: 1 }, speed: [2.2, 6.2] },
        { size: [1, 1] },
        // Cool violet-cyan crystal palette.
        {
          color: [0.65, 1.4, 3.2],
          colorMax: [2.0, 0.75, 4.8],
          mode: "random range",
          alpha: 1,
        },
        // Tumbling chunks.
        { rotation: [0, 6.28], angularVelocity: [-14, 14] },
        {},
        { acceleration: [0, -7, 0] },
        // Floor bounce so chunks scatter satisfyingly.
        {
          normal: [0, 1, 0],
          point: [0, 0, 0],
          restitution: 0.58,
          friction: 0.62,
          worldSpace: true,
        },
        { fadeIn: 0, fadeOut: 0.4 },
        // Small metallic chunks — look like real shatter debris.
        {
          geometry: { kind: "geometry", preset: "box", width: 0.05, height: 0.05, depth: 0.04 },
          color: [1, 1, 1],
          metalness: 0.72,
          roughness: 0.22,
          renderOrder: 0,
        },
      );
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Ember swarm — lazy floating embers with light contribution to scene
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Living ember lights",
    description: "Visible ember sprites plus a small companion light swarm that warms the scene.",
    build() {
      function patch<T extends PlumeNode>(n: T, p: T["data"]["params"]): T {
        return { ...n, data: { ...n.data, params: { ...n.data.params, ...p } } } as T;
      }
      function edge(src: PlumeNode, dst: PlumeNode): Edge {
        return {
          id: `e_${src.id}__${dst.id}`,
          source: src.id,
          target: dst.id,
          style: "stroke:#3a72ad;stroke-width:1.5;",
          interactionWidth: 18,
        };
      }

      const spriteE = makeNode("emitter", { x: 80, y: 60 });
      const spriteS = makeNode("spawn.rate", { x: 320, y: 60 });
      const spriteL = makeNode("init.lifetime", { x: 560, y: 40 });
      const spriteP = makeNode("init.position", { x: 560, y: 150 });
      const spriteV = makeNode("init.velocity", { x: 560, y: 260 });
      const spriteSize = makeNode("init.size", { x: 560, y: 370 });
      const spriteC = makeNode("init.color", { x: 560, y: 480 });
      const spriteI = makeNode("update.integrate", { x: 800, y: 40 });
      const spriteCurl = makeNode("update.curl_noise", { x: 800, y: 150 });
      const spriteG = makeNode("update.gravity", { x: 800, y: 260 });
      const spriteA = makeNode("update.alpha_over_life", { x: 800, y: 370 });
      const spriteR = makeNode("render.sprite", { x: 1040, y: 60 });

      const lightE = makeNode("emitter", { x: 80, y: 760 });
      const lightS = makeNode("spawn.rate", { x: 320, y: 760 });
      const lightL = makeNode("init.lifetime", { x: 560, y: 720 });
      const lightP = makeNode("init.position", { x: 560, y: 830 });
      const lightV = makeNode("init.velocity", { x: 560, y: 940 });
      const lightSize = makeNode("init.size", { x: 560, y: 1050 });
      const lightC = makeNode("init.color", { x: 560, y: 1160 });
      const lightI = makeNode("update.integrate", { x: 800, y: 720 });
      const lightCurl = makeNode("update.curl_noise", { x: 800, y: 830 });
      const lightG = makeNode("update.gravity", { x: 800, y: 940 });
      const lightA = makeNode("update.alpha_over_life", { x: 800, y: 1050 });
      const lightR = makeNode("render.light", { x: 1040, y: 760 });

      const sharedMotion = {
        lifetime: [2.4, 4.0] as [number, number],
        position: { kind: "sphere" as const, radius: 0.35, thickness: 1 },
        velocity: { kind: "sphere" as const, radius: 1, thickness: 1 },
      };

      const nodes: PlumeNode[] = [
        patch(spriteE, { capacity: 192, duration: 6, spawnOrigin: [0, 0.55, 0] }),
        patch(spriteS, { rate: 42 }),
        patch(spriteL, { lifetime: sharedMotion.lifetime }),
        patch(spriteP, { shape: sharedMotion.position }),
        patch(spriteV, { shape: sharedMotion.velocity, speed: [0.18, 0.75] }),
        patch(spriteSize, { size: [0.055, 0.13] }),
        patch(spriteC, {
          color: [3.4, 1.35, 0.25],
          colorMax: [5.0, 2.5, 0.55],
          mode: "random range",
          alpha: 1,
        }),
        spriteI,
        patch(spriteCurl, { amplitude: 0.75, frequency: 0.75, speed: 0.45 }),
        patch(spriteG, { acceleration: [0, 0.35, 0] }),
        patch(spriteA, { fadeIn: 0.12, fadeOut: 0.45 }),
        patch(spriteR, {
          shader: "spark",
          blending: "additive",
          opacity: 1,
          renderOrder: 8,
        }),

        patch(lightE, { capacity: 32, duration: 6, spawnOrigin: [0, 0.55, 0] }),
        patch(lightS, { rate: 10 }),
        patch(lightL, { lifetime: sharedMotion.lifetime }),
        patch(lightP, { shape: sharedMotion.position }),
        patch(lightV, { shape: sharedMotion.velocity, speed: [0.14, 0.55] }),
        patch(lightSize, { size: [0.05, 0.1] }),
        patch(lightC, { color: [1, 1, 1], mode: "solid", alpha: 1 }),
        lightI,
        patch(lightCurl, { amplitude: 0.55, frequency: 0.7, speed: 0.4 }),
        patch(lightG, { acceleration: [0, 0.28, 0] }),
        patch(lightA, { fadeIn: 0.15, fadeOut: 0.5 }),
        patch(lightR, {
          lightCount: 8,
          color: [2.6, 1.2, 0.32],
          intensity: 2.4,
          distance: 4.2,
          decay: 2,
        }),
      ];

      const edges: Edge[] = [
        edge(spriteE, spriteS),
        edge(spriteS, spriteL),
        edge(spriteL, spriteP),
        edge(spriteP, spriteV),
        edge(spriteV, spriteSize),
        edge(spriteSize, spriteC),
        edge(spriteC, spriteI),
        edge(spriteI, spriteCurl),
        edge(spriteCurl, spriteG),
        edge(spriteG, spriteA),
        edge(spriteA, spriteR),

        edge(lightE, lightS),
        edge(lightS, lightL),
        edge(lightL, lightP),
        edge(lightP, lightV),
        edge(lightV, lightSize),
        edge(lightSize, lightC),
        edge(lightC, lightI),
        edge(lightI, lightCurl),
        edge(lightCurl, lightG),
        edge(lightG, lightA),
        edge(lightA, lightR),
      ];

      return { nodes, edges };
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Fireworks — multi-rocket sub-emitter chain (demonstrates spawn.from_events)
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Finale fireworks",
    description: "Four rockets arc upward, die into events, and blossom into dense rainbow bursts.",
    build() {
      // Two emitters, two chains. Burst's spawn.from_events picks rocket as the source.
      const rocketEmitter = makeNode("emitter", { x: 80, y: 60 });
      const rocketSpawn = makeNode("spawn.burst", { x: 320, y: 60 });
      const rocketLifetime = makeNode("init.lifetime", { x: 560, y: 60 });
      const rocketPosition = makeNode("init.position", { x: 560, y: 170 });
      const rocketVelocity = makeNode("init.velocity", { x: 560, y: 280 });
      const rocketSize = makeNode("init.size", { x: 560, y: 390 });
      const rocketColor = makeNode("init.color", { x: 560, y: 500 });
      const rocketIntegrate = makeNode("update.integrate", { x: 800, y: 60 });
      const rocketGravity = makeNode("update.gravity", { x: 800, y: 170 });
      const rocketDrag = makeNode("update.drag", { x: 800, y: 280 });
      const rocketAlpha = makeNode("update.alpha_over_life", { x: 800, y: 390 });
      const rocketRender = makeNode("render.ribbon", { x: 1040, y: 60 });

      const burstEmitter = makeNode("emitter", { x: 80, y: 720 });
      const burstSpawn = makeNode("spawn.from_events", { x: 320, y: 720 });
      const burstLifetime = makeNode("init.lifetime", { x: 560, y: 660 });
      const burstVelocity = makeNode("init.velocity", { x: 560, y: 770 });
      const burstSize = makeNode("init.size", { x: 560, y: 880 });
      const burstColor = makeNode("init.color", { x: 560, y: 990 });
      const burstIntegrate = makeNode("update.integrate", { x: 800, y: 660 });
      const burstGravity = makeNode("update.gravity", { x: 800, y: 770 });
      const burstDrag = makeNode("update.drag", { x: 800, y: 880 });
      const burstSizeOverLife = makeNode("update.size_over_life", { x: 800, y: 990 });
      const burstAlpha = makeNode("update.alpha_over_life", { x: 800, y: 1100 });
      const burstRender = makeNode("render.sprite", { x: 1040, y: 720 });

      function patch<T extends PlumeNode>(n: T, p: T["data"]["params"]): T {
        return { ...n, data: { ...n.data, params: { ...n.data.params, ...p } } } as T;
      }

      const nodes: PlumeNode[] = [
        // Rocket. `loop: false` means the emitter fires its burst exactly
        // ONCE per system cycle (system loops at duration+1, which calls
        // play() and resets the rocket emitter). No more pile-up from the
        // emitter looping every `duration` seconds.
        patch(rocketEmitter, { capacity: 32, duration: 1.5, spawnOrigin: [0, 0, 0], loop: false }),
        patch(rocketSpawn, { time: 0, count: 4 }),
        patch(rocketLifetime, { lifetime: [1.0, 1.4] }),
        // Spawn rockets at the ground level, not on a sphere shell. Sphere with
        // thickness 0 puts particles at points all around the origin (some at
        // negative Y), which read as a "pile". Point gives all rockets the
        // exact same launch point.
        patch(rocketPosition, { shape: { kind: "point" } }),
        patch(rocketVelocity, {
          shape: { kind: "cone", angle: 0.18 },
          speed: [6.5, 8.5],
        }),
        patch(rocketSize, { size: [0.08, 0.12] }),
        patch(rocketColor, {
          color: [3.0, 2.2, 0.8],
          colorMax: [3.0, 2.6, 1.4],
          mode: "random range",
          alpha: 1,
        }),
        rocketIntegrate,
        patch(rocketGravity, { acceleration: [0, -3.5, 0] }),
        patch(rocketDrag, { coefficient: 0.25 }),
        patch(rocketAlpha, { fadeIn: 0.0, fadeOut: 0.25 }),
        patch(rocketRender, {
          shader: "soft",
          width: 0.045,
          historyLength: 56,
          blending: "additive",
          opacity: 1,
          renderOrder: 5,
        }),

        // Burst consumes rocket onDeath events. Each rocket's death point becomes
        // the spawn position of ~200 burst particles flying outward in a sphere.
        // Also `loop: false` so the burst doesn't fire spontaneously — only on
        // events from the rocket.
        patch(burstEmitter, { capacity: 4096, duration: 5, spawnOrigin: [0, 0, 0], loop: false }),
        patch(burstSpawn, {
          source: { kind: "emitter-ref", nodeId: rocketEmitter.id },
          perEvent: 260,
          maxEventsPerFrame: 8,
          inheritVelocity: false,
        }),
        patch(burstLifetime, { lifetime: [1.0, 2.0] }),
        patch(burstVelocity, {
          shape: { kind: "sphere", radius: 1, thickness: 1 },
          speed: [2.5, 7],
        }),
        patch(burstSize, { size: [0.12, 0.24] }),
        // Random across the firework rainbow palette.
        patch(burstColor, {
          color: [3.0, 0.8, 1.2],
          colorMax: [0.8, 2.4, 3.2],
          mode: "random range",
          alpha: 1,
        }),
        burstIntegrate,
        patch(burstGravity, { acceleration: [0, -3.5, 0] }),
        patch(burstDrag, { coefficient: 1.0 }),
        patch(burstSizeOverLife, {
          curve: {
            kind: "curve1d",
            keys: [
              { t: 0, v: 1 },
              { t: 1, v: 0.4 },
            ],
          },
        }),
        patch(burstAlpha, { fadeIn: 0.0, fadeOut: 0.6 }),
        patch(burstRender, { shader: "spark", blending: "additive", opacity: 1, renderOrder: 6 }),
      ];

      function edge(src: PlumeNode, dst: PlumeNode): Edge {
        return {
          id: `e_${src.id}__${dst.id}`,
          source: src.id,
          target: dst.id,
          style: "stroke:#3a72ad;stroke-width:1.5;",
          interactionWidth: 18,
        };
      }

      const edges: Edge[] = [
        // Rocket chain
        edge(rocketEmitter, rocketSpawn),
        edge(rocketSpawn, rocketLifetime),
        edge(rocketLifetime, rocketPosition),
        edge(rocketPosition, rocketVelocity),
        edge(rocketVelocity, rocketSize),
        edge(rocketSize, rocketColor),
        edge(rocketColor, rocketIntegrate),
        edge(rocketIntegrate, rocketGravity),
        edge(rocketGravity, rocketDrag),
        edge(rocketDrag, rocketAlpha),
        edge(rocketAlpha, rocketRender),

        // Burst chain
        edge(burstEmitter, burstSpawn),
        edge(burstSpawn, burstLifetime),
        edge(burstLifetime, burstVelocity),
        edge(burstVelocity, burstSize),
        edge(burstSize, burstColor),
        edge(burstColor, burstIntegrate),
        edge(burstIntegrate, burstGravity),
        edge(burstGravity, burstDrag),
        edge(burstDrag, burstSizeOverLife),
        edge(burstSizeOverLife, burstAlpha),
        edge(burstAlpha, burstRender),
      ];

      return { nodes, edges };
    },
  },
];
