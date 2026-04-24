# plume

A Niagara-equivalent VFX system for three.js.

```bash
npm i plume three
```

## Quick start

```ts
import * as THREE from "three";
import { Manager, System, Emitter, SpawnRate, Gravity, Drag, SpriteRenderer } from "plume";

const scene = new THREE.Scene();
const manager = new Manager({ scene });

const system = new System({
  emitters: [
    new Emitter({
      capacity: 1024,
      spawn: [new SpawnRate({ rate: 200 })],
      update: [new Gravity({ strength: 9.81 }), new Drag({ coefficient: 0.1 })],
      render: new SpriteRenderer({ blending: "additive" }),
    }),
  ],
});

manager.register("smoke", system);
manager.spawn("smoke", new THREE.Vector3(0, 1, 0));

// in your render loop:
manager.tick(deltaSeconds);
```

## Status

Phase A (CPU foundations) — in progress.

See the monorepo root [README](../../README.md) for the full roadmap.
