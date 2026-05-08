# three-plume

GPU-first, Niagara-style VFX system for [three.js](https://threejs.org). Particle
simulation runs entirely in compute shaders through three's TSL (Three Shading Language);
the CPU orchestrates composable modules, the GPU does all the per-particle work.

**Pre-1.0** — latest release `0.1.1`; API may change before release. See
[CHANGELOG.md](./CHANGELOG.md).

## Add to a three.js project

Install the runtime package alongside three.js:

```bash
npm i three-plume three
```

```bash
pnpm add three-plume three
```

If your app already depends on `three@^0.184.0`, install `three-plume` by itself.
Plume is ESM-only and runs on three's WebGPU renderer:

```ts
import { WebGPURenderer } from "three/webgpu";
import { Manager, system } from "three-plume";
```

A WebGPU-capable browser is required (Chrome/Edge/Arc on desktop; Safari 18+ on
macOS/iOS).

## Quick start

```ts
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Manager, system } from "three-plume";

const renderer = new WebGPURenderer();
await renderer.init();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 2, 6);

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
        .integrate()
        .drag(0.4)
        .gravity([0, 0.5, 0])
        .sizeOverLife([
          [0, 0.8],
          [0.5, 1.4],
          [1, 2],
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
manager.spawn("smoke", { position: new THREE.Vector3() });

renderer.setAnimationLoop(() => {
  manager.tick(1 / 60, camera);
  renderer.render(scene, camera);
});
```

## Features

- Pure-GPU simulation — SoA storage buffers, compute kernels for spawn/update/sort.
- 30+ composable modules: spawn (rate / burst / from-events), init (position, velocity,
  size, color, rotation, from-mesh surface or volume), update (gravity, drag, turbulence,
  curl noise, vortex, point attractor, limit velocity, scale-by-speed, color/size/alpha/
  velocity-over-life, plane/sphere/depth/SDF collision), render (sprite with sub-UV, mesh,
  ribbon, beam, point lights).
- Events + sub-emitters — particles atomically append death events; listener emitters
  spawn on each impact (fireworks, raindrop splash).
- Depth-buffer + SDF collision with normal reconstruction.
- Depth-sorted alpha via three's built-in `BitonicSort`.
- Seeded determinism + fixed-timestep option for replays and tests.
- LOD + frustum culling per spawn.
- Batched compute dispatch — one GPU submit per tick regardless of active system count.
- Pool warmup and explicit prefab cleanup via `Manager.preload(...)` and
  `Manager.unregister(...)`.
- Texture + shader hooks across renderers: multi-texture maps, custom TSL `colorNode`
  callbacks, flowmap force fields, sprite-sheet animation, ribbons, beams, instanced
  meshes, and particle-driven lights.
- Socket-following ribbon trails: `manager.spawn(id, { follow })` samples a moving three.js
  object, bone, or gameplay socket into a fixed GPU history buffer with width, alpha, color,
  sample-rate, min-distance, and layered glow controls.
- JSON serialization for system definitions, including event emitters, depth sorting, and
  light renderer settings.
- Shader dump for debugging the generated WGSL.

## Socket-following trail

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

manager.spawn("rising-fang", {
  follow: {
    space: "world",
    getPosition: (out) => swordBladeTip.getWorldPosition(out),
  },
});
```

## Exports

- `Manager`, `System`, `Emitter` — orchestration classes.
- `system(name)`, `emitter(name)` — fluent builder entry points, including
  `system().trail(...)` for socket-following ribbon trails.
- All module classes (`SpawnRate`, `Gravity`, `DepthCollision`, `SpriteRenderer`, …).
- SDF primitives: `sdfSphere`, `sdfBox`, `sdfPlane`, `sdfUnion`, `sdfIntersect`, `sdfSubtract`.
- Serialization: `systemDefToJSON`, `systemDefFromJSON`.
- Debug: `dumpShaders(renderer, system, { camera })`.

Full type definitions ship with the package.

## Editor + demos

See the [monorepo root](https://github.com/travisdmathis/plume) for the visual editor,
playground, and preset gallery. The editor compiles Svelte/@xyflow node graphs into real
`SystemDef` objects, previews them live in three.js, saves/loads graph JSON, and exports
fluent TypeScript builder code.

Included editor presets cover fire, smoke, magic sparks, black-hole galaxy, monsoon rain,
lightning, plasma beams, confetti, snow, mesh shatter, ember lights, and multi-emitter
fireworks.

## License

MIT
