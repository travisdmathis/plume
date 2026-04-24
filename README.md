# Plume

A GPU-first, Niagara-style VFX system for [three.js](https://threejs.org).

Particle simulation runs entirely on the GPU through three.js's TSL (Three Shading
Language) — spawn, update, sort, and collision all live in compute shaders. The CPU
side is a thin orchestrator that wires compose-able modules into each emitter.

**Status:** pre-1.0. Not yet on npm. API will change before release.

## Highlights

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
- **Depth sort for alpha blending** — uses three.js's built-in
  [`BitonicSort`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/gpgpu/BitonicSort.js)
  on packed (depth, slot-index) keys.
- **Fluent authoring API** — builder pattern; emitter + system defs compose as one chain.
- **Seeded determinism** — seeded emitters replay identically given a fixed timestep.
- **LOD + frustum culling** — per-spawn distance fade + bounding-sphere cull. Far systems
  scale intensity down to zero; off-screen systems flip `visible` off so the renderer skips
  them entirely.
- **Shader dump** — export every generated compute + render WGSL for debugging.

## Quick start

Install (peer deps: three ≥ 0.184):

```bash
pnpm install
```

Minimal emitter — a smoke puff:

```ts
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Manager, system } from "plume";

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
        .sizeOverLife([[0, 0.8], [0.5, 1.4], [1, 2.0]])
        .alphaOverLife([[0, 0.4], [0.3, 1], [1, 0]])
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

## Module library

Thirty+ modules across four phases of the particle lifecycle:

- **Spawn** (emitter-level): `SpawnRate`, `SpawnBurst`, `SpawnFromEvents`
- **Init** (per-new-particle): `InitLifetime`, `InitPosition`, `InitVelocity`, `InitSize`,
  `InitColor`, `InitRotation`, `InitFromMesh` (surface or volume)
- **Update** (per-live-particle each frame): `VelocityIntegrator`, `LifetimeTick`, `Gravity`,
  `Drag`, `TurbulenceForce`, `CurlNoiseForce`, `VortexForce`, `PointAttractor`,
  `LimitVelocity`, `ScaleBySpeed`, `ColorOverLife`, `SizeOverLife`, `AlphaOverLife`,
  `VelocityOverLife`, `PlaneCollision`, `SphereCollision`, `DepthCollision`, `SdfCollision`
- **Render**: `SpriteRenderer` (with SubUV animation), `MeshRenderer`, `RibbonRenderer`,
  `BeamRenderer`, `LightEmission`

All modules are data-driven: serializable to JSON via `systemDefToJSON` / `systemDefFromJSON`.

## Playground

```bash
pnpm install
pnpm dev
```

Opens [`examples/playground`](./examples/playground) — every feature above has a
demo button (explosion, smoke, orb, fountain, ribbons, tornado, plasma beams, ember
swarm, mesh-volume portal, depth-collision rain, SDF bouncer, LOD grid, fireworks
with sub-emitters, seeded determinism twin, shader dump).

## Packages

| Package                    | Description                                         |
| -------------------------- | --------------------------------------------------- |
| [`plume`](./packages/plume) | Engine: modules, renderers, manager, TSL codegen    |

Planned:

- `plume-presets` — curated game-ready prefabs (muzzle flashes, impacts, explosions)
- `plume-editor` — visual node editor (separate package)

## Development

```bash
pnpm install
pnpm -r build       # build every package
pnpm -r typecheck   # tsc across the workspace
pnpm -r lint
```

## Requirements

- Node 20+ (24 recommended)
- pnpm 10+
- three.js `^0.184.0` (peer dependency)
- WebGPU-capable browser (Chrome/Edge/Arc on desktop; Safari 18+ on macOS/iOS)

## License

MIT
