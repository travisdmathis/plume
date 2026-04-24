/**
 * Signed-distance-function (SDF) primitive builders for `SdfCollision`.
 *
 * Each helper returns a function `(p: Node<"vec3">) => Node<"float">` that evaluates the
 * signed distance from world-space point `p` to the surface of the shape. Negative means
 * inside, positive means outside. Collisions fire when the value drops below zero (or
 * below `thickness` for tolerance).
 *
 * Primitives follow iq's standard formulations (https://iquilezles.org/articles/distfunctions/).
 * They're pure TSL — compose them with `min`/`max`/`abs` for booleans, or call multiple in
 * parallel for a scene.
 */

import type Node from "three/src/nodes/core/Node.js";
import { abs, dot, length, max, min, vec3 } from "three/tsl";
import type { Vec3Tuple } from "../types.js";

export type SdfFn = (p: Node<"vec3">) => Node<"float">;

/** Sphere centered at `center` with radius `radius`. */
export function sdfSphere(center: Vec3Tuple, radius: number): SdfFn {
  const c = vec3(center[0], center[1], center[2]);
  return (p) => length(p.sub(c)).sub(radius);
}

/**
 * Axis-aligned box centered at `center` with half-extents `halfSize`. Exact (not bounding)
 * SDF — interior distance is correctly negative.
 */
export function sdfBox(center: Vec3Tuple, halfSize: Vec3Tuple): SdfFn {
  const c = vec3(center[0], center[1], center[2]);
  const h = vec3(halfSize[0], halfSize[1], halfSize[2]);
  return (p) => {
    const q = abs(p.sub(c)).sub(h);
    const outside = length(max(q, vec3(0, 0, 0)));
    const inside = min(max(q.x, max(q.y, q.z)), 0);
    return outside.add(inside);
  };
}

/**
 * Plane passing through `point` with unit normal `normal`. Positive distance on the normal's
 * side, negative on the opposite side.
 */
export function sdfPlane(point: Vec3Tuple, normal: Vec3Tuple): SdfFn {
  const p0 = vec3(point[0], point[1], point[2]);
  const n = vec3(normal[0], normal[1], normal[2]);
  return (p) => dot(p.sub(p0), n);
}

/** Union of two SDFs — the closer surface wins. */
export function sdfUnion(a: SdfFn, b: SdfFn): SdfFn {
  return (p) => min(a(p), b(p));
}

/** Intersection of two SDFs — inside only where both are inside. */
export function sdfIntersect(a: SdfFn, b: SdfFn): SdfFn {
  return (p) => max(a(p), b(p));
}

/** Subtraction `a - b`: `a` with `b` carved out. */
export function sdfSubtract(a: SdfFn, b: SdfFn): SdfFn {
  return (p) => max(a(p), b(p).negate());
}
