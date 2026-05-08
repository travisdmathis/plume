# Plume

A GPU-first, Niagara-style VFX system for [three.js](https://threejs.org).

Particle simulation runs entirely on the GPU through three.js's TSL (Three Shading
Language) — spawn, update, sort, and collision all live in compute shaders. The CPU
side is a thin orchestrator that wires compose-able modules into each emitter.

**Status:** pre-1.0. Latest runtime release: `three-plume@0.1.1`. API will change before
release. See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Highlights

- **Visual node editor** — Svelte 5 + @xyflow editor with a module palette, graph canvas,
  inspector, undo/redo, autosave, JSON import/export, TypeScript code export, and a live
  WebGPU preview pane.
- **Pure-GPU pipeline** — SoA storage buffers, compute kernels for spawn/update/sort, no
  per-particle JS work.
- **Events + sub-emitters** — particles atomically append death events; a second emitter
  listens via `SpawnFromEvents` and spawns at each impact. Fireworks, raindrop splash.
- **Depth-buffer + SDF collision** — drops bounce off rendered scene geometry (via a depth
  pre-pass) or analytic signed-distance fields. Normals reconstructed from depth gradient
  or SDF gradient.
- **Mesh emission** — area-weighted surface sampling, rejection-sampling volume fill.
- **Render modules** — billboard sprites (with sub-UV animation), instanced meshes, ribbons
  (per-particle history buffer), laser-style beams, particle-driven point lights.
- **Socket-following trails** — spawn an effect with `follow.getPosition(out)` to sample a
  moving three.js object, bone, or gameplay socket into a fixed-capacity ribbon trail.
- **Depth sort for alpha blending** — uses three.js's built-in
  [`BitonicSort`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/gpgpu/BitonicSort.js)
  on packed (depth, slot-index) keys.
- **Fluent authoring API** — builder pattern; emitter + system defs compose as one chain.
- **Seeded determinism** — seeded emitters replay identically given a fixed timestep.
- **LOD + frustum culling** — per-spawn distance fade + bounding-sphere cull. Far systems
  scale intensity down to zero; off-screen systems flip `visible` off so the renderer skips
  them entirely.
- **Batched compute dispatch** — every active system's per-frame kernels (reset + update +
  spawn) coalesce into one `computeAsync([...])` call per tick, so GPU submits stay at 1
  regardless of active system count.
- **Pool warmup** — `Manager.preload(id, count)` pre-creates pooled instances AND dispatches
  their compute kernels once, so the first burst spawn of a heavy prefab doesn't stall on
  WGSL → MSL pipeline compilation.
- **Texture + shader hooks on every renderer** — `textures: { base, mask, ... }` for
  multi-texture materials and a `colorNode: (ctx) => Node<"vec4">` callback that gives full
  TSL control over the fragment with particle state, UVs, and emitter time exposed.
  Texture-driven motion via `FlowmapForce` (sample a flowmap, decode R/G as direction, push
  velocity). `MeshRenderer` composes user-supplied vertex/normal nodes instead of
  overriding them.
- **Editor-ready shader presets** — soft, hard, smoke, spark, organic procedural fire,
  texture-additive, texture-luma-alpha, magma mesh material, emissive mesh material, and
  textured fire/smoke/ember starter assets.
- **Shader dump** — export every generated compute + render WGSL for debugging.

## Add to a three.js project

Install the runtime package alongside three.js:

```bash
npm i three-plume three
```

```bash
pnpm add three-plume three
```

If your app already has `three@^0.184.0`, install `three-plume` by itself. Plume is
ESM-only and expects a WebGPU-capable renderer, so new effects should be driven from
`WebGPURenderer`:

```ts
import { WebGPURenderer } from "three/webgpu";
import { Manager, system } from "three-plume";
```

## Quick start

Minimal emitter — a smoke puff:

```ts
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Manager, system } from "three-plume";

const renderer = new WebGPURenderer();
await renderer.init();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);

const manager = new Manager({ renderer, scene, camera });

manager.register("smoke", () =>
  system("smoke")
    .duration(3)
    .emitter("puff", (e) =>
      e
        .capacity(128)
        .duration(1.5)
        .sortByDepth()
        .spawnRate(25)
        .lifetime({ min: 1.8, max: 2.8 })
        .position({ shape: { kind: "sphere", radius: 0.08, thickness: 1 } })
        .velocity({
          shape: { kind: "cone", angle: 0.18 * Math.PI },
          speed: { min: 0.3, max: 1 },
        })
        .size({ min: 0.35, max: 0.7 })
        .color({ min: [0.65, 0.65, 0.68], max: [0.85, 0.85, 0.9] }, { alpha: 0.35 })
        .rotation({ min: 0, max: Math.PI * 2 })
        .integrate()
        .drag(0.4)
        .gravity([0, 0.5, 0])
        .sizeOverLife([
          [0, 0.8],
          [0.5, 1.4],
          [1, 2.0],
        ])
        .alphaOverLife([
          [0, 0.4],
          [0.3, 1],
          [1, 0],
        ])
        .renderSprite({ blending: "alpha" }),
    )
    .build(),
);

await manager.warmup();
manager.spawn("smoke", { position: new THREE.Vector3(0, 0, 0) });

renderer.setAnimationLoop((t) => {
  manager.tick(1 / 60, camera);
  renderer.render(scene, camera);
});
```

## Socket-Following Trails

Use `follow` when an effect should be authored around something that moves every frame:
a sword tip, hand socket, projectile muzzle, wheel contact point, character bone, or any
other `Object3D`.

```ts
manager.spawn("rising-fang", {
  follow: {
    space: "world",
    getPosition: (out) => swordBladeTip.getWorldPosition(out),
  },
});
```

The matching prefab can be authored as a first-class trail. Plume uses one hidden trail
head particle, pins it to the followed point, and records that head into a fixed GPU
history buffer.

```ts
manager.register("rising-fang", () =>
  system("rising_fang")
    .duration(1.15)
    .trail("blade_ribbon", (trail) =>
      trail
        .capacity(32)
        .sampleRate(72)
        .minDistance(0.025)
        .lifetime(0.46)
        .widthOverLife([
          [0, 0.015],
          [0.18, 0.16],
          [0.62, 0.07],
          [1, 0],
        ])
        .alphaOverLife([
          [0, 0.85],
          [0.12, 1],
          [0.5, 0.55],
          [1, 0],
        ])
        .colorOverLife([
          [0, [1.0, 0.78, 0.32]],
          [0.55, [0.25, 2.8, 4.8]],
          [1, [0.8, 3.8, 5.8]],
        ])
        .renderRibbon({
          blending: "additive",
          depthTest: false,
          faceCamera: true,
          layers: [
            { width: 0.22, opacity: 0.28, color: [0.25, 3.5, 5.5] },
            { width: 0.08, opacity: 0.82, color: [5.0, 3.2, 1.2] },
          ],
        }),
    )
    .build(),
);
```

`follow.getPosition(out)` is allocation-free when you write into `out`. `capacity` is the
sample history length, `sampleRate` caps history writes, `minDistance` avoids oversampling
slow sockets, and `lifetime` controls how long sampled trail points remain visible.

## Visual editor

`packages/plume-editor` is now the main authoring surface for Plume effects. It compiles
node graphs into real `SystemDef` objects and hot-swaps them into a side-by-side three.js
preview.

```bash
pnpm install
pnpm --filter plume-editor dev
```

Current editor capabilities:

- Node palette, graph canvas, inspector, typed controls, and live preview.
- Graph persistence in localStorage, plus JSON save/load for sharing graphs.
- Undo/redo and reachability highlighting for disconnected modules.
- Code export that emits a fluent `system(...).emitter(...)` builder chain.
- Support for textures, gradients, curves, geometry pickers, SDF pickers, emitter refs,
  random color ranges, angular velocity, render order, collision params, and world-space
  toggles.
- Preview cleanup for live editing: old compiled prefab ids and inactive pools are
  unregistered so repeated graph rebuilds do not leak cached systems.

The editor ships with a preset gallery intended to show the range of the runtime:

- `Arcane starburst`
- `Cinematic fire plume`
- `Hero smoke bloom`
- `Black-hole galaxy`
- `Monsoon sheet`
- `Storm strike`
- `Nova lances`
- `Prismatic confetti burst`
- `Dream snowfield`
- `Crystal shatter`
- `Living ember lights`
- `Finale fireworks`

The fire preset is intentionally built from layered procedural flame tongues, curling side
wisps, smoke puffs, and ember streaks rather than a single repeated flame card, so it is a
good stress test for organic motion and shader variation.

## Module library

Thirty+ modules across four phases of the particle lifecycle:

- **Spawn** (emitter-level): `SpawnRate`, `SpawnBurst`, `SpawnFromEvents`
- **Init** (per-new-particle): `InitLifetime`, `InitPosition`, `InitVelocity`, `InitSize`,
  `InitColor`, `InitRotation`, `InitFromMesh` (surface or volume)
- **Update** (per-live-particle each frame): `VelocityIntegrator`, `LifetimeTick`, `Gravity`,
  `Drag`, `TurbulenceForce`, `CurlNoiseForce`, `VortexForce`, `PointAttractor`,
  `FollowPosition`, `LimitVelocity`, `ScaleBySpeed`, `ColorOverLife`, `SizeOverLife`,
  `AlphaOverLife`, `VelocityOverLife`, `PlaneCollision`, `SphereCollision`, `DepthCollision`,
  `SdfCollision`
- **Render**: `SpriteRenderer` (with SubUV animation), `MeshRenderer`, `RibbonRenderer`,
  `BeamRenderer`, `LightEmission`

All modules are data-driven: serializable to JSON via `systemDefToJSON` /
`systemDefFromJSON`. Serialization preserves event emitters, alpha depth sorting, light
renderer settings, and module JSON so editor graphs and exported effects survive a round
trip.

## Playground

```bash
pnpm install
pnpm --filter plume-playground dev
```

Opens [`examples/playground`](./examples/playground) — every feature above has a
demo button (explosion, smoke, orb, fountain, ribbons, tornado, plasma beams, ember
swarm, mesh-volume portal, depth-collision rain, SDF bouncer, LOD grid, fireworks
with sub-emitters, seeded determinism twin, shader dump).

## Packages

| Package                                     | Description                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| [`three-plume`](./packages/plume)           | Engine: modules, renderers, manager, serialization, TSL codegen              |
| [`plume-editor`](./packages/plume-editor)   | Visual node editor with live preview, preset gallery, graph save/load/export |
| [`plume-playground`](./examples/playground) | Runtime demo harness for engine features and debugging                       |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes. `0.1.1` adds socket-following
ribbon trails for moving gameplay objects such as weapons, bones, sockets, and projectiles.

## Development

```bash
pnpm install
pnpm build        # build engine + editor
pnpm typecheck    # tsc / svelte-check across the workspace
pnpm lint         # eslint + prettier check
```

CI uses `pnpm/action-setup` and reads the exact pinned pnpm version from
`package.json` (`packageManager: pnpm@10.13.1`).

## Requirements

- Node 20+ (24 recommended)
- pnpm 10.13.1+ (pinned by `packageManager`)
- three.js `^0.184.0` (peer dependency)
- WebGPU-capable browser (Chrome/Edge/Arc on desktop; Safari 18+ on macOS/iOS)

## License

MIT
