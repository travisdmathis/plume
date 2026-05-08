# Changelog

All notable changes to Plume are documented here.

## 0.1.1

- Added first-class socket-following trails for moving gameplay objects:
  `manager.spawn(id, { follow: { getPosition(out) } })`.
- Added `system().trail(...)` / `TrailBuilder` for authoring fixed-capacity ribbon trails
  with sample rate, minimum-distance sampling, lifetime fades, width curves, alpha curves,
  color gradients, and layered additive glow.
- Added `FollowPosition`, a particle update module that pins a hidden trail-head particle
  to a followed object, bone, socket, projectile, or gameplay point.
- Expanded `RibbonRenderer` with `sampleRate`, `minDistance`, `sampleLifetime`,
  `sampleUntil`, `widthOverLife`, `alphaOverLife`, `colorOverLife`, `depthTest`,
  `depthWrite`, `faceCamera`, and multi-layer ribbon rendering.
- Fixed render post-update ordering so ribbon history samples after the current particle
  compute batch has been submitted.
- Added a playground Socket trail demo with a moving sword-tip socket.
- Updated README usage docs for adding Plume to npm/pnpm three.js projects and authoring
  moving-object VFX.

## 0.1.0

- Initial public npm release as `three-plume`.
- Shipped GPU-first particle simulation for three.js/WebGPU using TSL compute kernels.
- Included fluent authoring APIs, module serialization, manager pooling, warmup, LOD,
  frustum culling, depth sorting, event emitters, sub-emitters, SDF/depth collisions,
  mesh emission, sprites, meshes, ribbons, beams, particle lights, shader dumps, playground
  demos, and the Svelte visual editor.
