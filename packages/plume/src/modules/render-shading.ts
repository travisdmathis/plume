/**
 * Shared types + helpers for renderer-level shading hooks (R16).
 *
 * Every visible particle renderer in plume — SpriteRenderer, RibbonRenderer, BeamRenderer —
 * accepts a `colorNode` callback that replaces the default fragment color computation. The
 * callback receives a `ColorNodeContext` carrying:
 *   - already-loaded particle state (color, age, lifetime fraction, size, world position).
 *   - the geometry's `uv` node (semantics differ per renderer — see below).
 *   - a map of TSL `texture()` nodes built from the user-supplied texture inputs, ready to
 *     `.sample(uv)` directly.
 *   - emitter time, for scrolling / time-driven effects.
 *
 * UV conventions:
 *   - Sprite quads: standard 0..1 UV across the billboard quad.
 *   - Ribbon strips: u = 0..1 along ribbon length (0 = newest sample, 1 = oldest tail),
 *     v = 0..1 across the strip width.
 *   - Beam quads: u = 0..1 along the beam (0 = tail/spawn, 1 = head/current),
 *     v = 0..1 across the strip width.
 *
 * The `colorNode` returns a `Node<"vec4">` that becomes the fragment's RGBA. Particle
 * fade-in/out via `AlphaOverLife` etc. is already baked into `particle.color.a`, so the
 * common case is just `return tex.sample(uv).mul(particle.color);`.
 */

import type Node from "three/src/nodes/core/Node.js";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import * as THREE from "three";
import { texture as tslTexture } from "three/tsl";

/** Per-fragment context passed into a renderer's `colorNode` hook. */
export interface ColorNodeContext {
  /** Per-particle state already read from GPU storage. All values are TSL nodes. */
  particle: {
    /** Current RGBA, post-`ColorOverLife` / `AlphaOverLife`. */
    color: Node<"vec4">;
    /** Current age in seconds. */
    age: Node<"float">;
    /** Current lifetime in seconds. Clamped to a small positive number to avoid /0. */
    lifetime: Node<"float">;
    /** `age / lifetime`, clamped to [0, 1]. The most useful "where am I in life" knob. */
    lifetimeT: Node<"float">;
    /** Current size (post-`SizeOverLife`). */
    size: Node<"float">;
    /** World-space position. */
    position: Node<"vec3">;
    /** 1.0 if alive, 0.0 if dead. */
    alive: Node<"float">;
  };
  /** Geometry UV — see header for per-renderer semantics. */
  uv: Node<"vec2">;
  /** Map of TSL texture nodes built from the renderer's `textures` input. Sample with `.sample(uv)`. */
  textures: Record<string, TextureNode>;
  /** Emitter time in seconds, for scrolling textures and time-driven shading. */
  time: Node<"float">;
}

/** Renderer-side `colorNode` callback signature. */
export type ColorNodeFn = (ctx: ColorNodeContext) => Node<"vec4">;

/**
 * Inputs to a renderer's texture map. Accepts either a single texture (mapped to the key
 * `"base"`) for the common case, or a `Record<string, Texture>` for multi-texture materials.
 */
export type TextureInput = THREE.Texture | Record<string, THREE.Texture>;

/** Normalize the loose `TextureInput` form into a stable `Record<string, Texture>`. */
export function normalizeTextures(input: TextureInput | undefined): Record<string, THREE.Texture> {
  if (!input) return {};
  if (input instanceof THREE.Texture) return { base: input };
  return input;
}

/**
 * Wrap each `Texture` in a TSL `texture()` node so the user's `colorNode` can call
 * `textures.base.sample(uv)` without any imports of their own.
 */
export function buildTextureNodes(
  textures: Record<string, THREE.Texture>,
): Record<string, TextureNode> {
  const out: Record<string, TextureNode> = {};
  for (const [key, tex] of Object.entries(textures)) {
    out[key] = tslTexture(tex);
  }
  return out;
}

/**
 * Helper for the common scrolling-texture pattern: returns `uv + speed * time`, with the
 * fractional part wrapped back into [0, 1) so the texture stays in its sampler's range.
 *
 * ```ts
 * colorNode: ({ textures, uv, time }) =>
 *   textures.base.sample(scrollUV(uv, vec2(0.5, 0), time)).mul(particle.color);
 * ```
 */
export function scrollUV(uv: Node<"vec2">, speed: Node<"vec2">, time: Node<"float">): Node<"vec2"> {
  return uv.add(speed.mul(time)).fract() as unknown as Node<"vec2">;
}

/**
 * Compute `age / lifetime` clamped to [0, 1]. Useful as a default fallback when the renderer
 * needs `lifetimeT` and the user just provided `age` + `lifetime` separately.
 */
export function safeLifetimeT(age: Node<"float">, lifetime: Node<"float">): Node<"float"> {
  return age.div(lifetime.max(0.0001)).clamp(0, 1);
}
