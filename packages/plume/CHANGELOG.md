# Changelog

Runtime package release notes for `three-plume`.

For full monorepo notes, see
[travisdmathis/plume CHANGELOG.md](https://github.com/travisdmathis/plume/blob/main/CHANGELOG.md).

## 0.1.1

- Added socket-following trails via `manager.spawn(id, { follow })`.
- Added `system().trail(...)` / `TrailBuilder` for fixed-capacity ribbon trails.
- Added `FollowPosition` for pinning a trail-head particle to a moving object, socket,
  bone, projectile, or gameplay point.
- Expanded `RibbonRenderer` with sampling controls, lifetime fades, width/alpha/color
  curves, depth controls, camera-facing control, and layered glow rendering.
- Fixed ribbon post-update ordering so trail history samples after current-frame particle
  compute work is submitted.

## 0.1.0

- Initial public npm release as `three-plume`.
- Included GPU-first particle simulation, fluent builders, serialization, manager pooling,
  warmup, LOD, culling, sorting, events, sub-emitters, collisions, mesh emission, sprites,
  meshes, ribbons, beams, particle lights, shader dumps, and type definitions.
