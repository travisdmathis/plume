/**
 * Built-in shader presets for sprite / ribbon / beam / mesh renderers.
 *
 * Without these the default sprite renderer draws hard-edged quads — every
 * particle reads as a "circle" or "square" with sharp corners. The presets
 * here apply per-fragment shaping (radial falloff, noise-driven alpha, magma
 * lava ramps for mesh) so out-of-the-box visuals look like real VFX instead
 * of programmer-art placeholders.
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type NodeMaterial } from "three/webgpu";
import {
  Fn,
  mix,
  smoothstep,
  vec2,
  vec3,
  vec4,
  float,
  positionLocal,
  time,
  mx_noise_float,
} from "three/tsl";
import type { ColorNodeContext, ColorNodeFn } from "three-plume";

export type SpriteShader =
  | "soft"
  | "hard"
  | "fire"
  | "smoke"
  | "spark"
  // Texture-aware presets — these REQUIRE a `textures.base` binding. They sample the
  // bound texture and combine it with `particle.color`. Use `texture_additive` for
  // additively-blended fire/embers (black pixels become free-transparent under additive
  // blending), and `texture_luma_alpha` for alpha-blended smoke / dust where you need
  // a luminance-keyed mask from a black-background source PNG.
  | "texture_additive"
  | "texture_luma_alpha";
export type MeshShader = "pbr" | "magma" | "emissive";

/**
 * Builds a sprite/ribbon/beam fragment shader. Returns `undefined` for "hard"
 * so the renderer falls back to its built-in solid-quad path; everything else
 * returns a `ColorNodeFn` that gets handed to the renderer's `colorNode` option.
 */
export function buildSpriteColorNode(preset: SpriteShader): ColorNodeFn | undefined {
  switch (preset) {
    case "hard":
      return undefined;

    case "texture_additive":
      return ({ uv, particle, textures }: ColorNodeContext) => {
        // Sample the bound base texture, multiply by particle RGBA. Under additive
        // blending the texture's black background contributes zero, so no alpha key
        // or pre-mult is needed.
        const tex = textures.base;
        if (!tex) {
          return vec4(particle.color.rgb, particle.color.a);
        }
        const sampled = tex.sample(uv);
        return vec4(sampled.rgb.mul(particle.color.rgb), sampled.a.mul(particle.color.a));
      };

    case "texture_luma_alpha":
      return ({ uv, particle, textures }: ColorNodeContext) => {
        // Use the bound texture's luminance as the alpha mask, and tint the RGB output
        // with `particle.color.rgb`. Designed for alpha-blended smoke/dust authored on
        // a pure-black background — bright wisps stay opaque, black voids stay clear.
        const tex = textures.base;
        if (!tex) {
          return vec4(particle.color.rgb, particle.color.a);
        }
        const sampled = tex.sample(uv);
        const luma = sampled.r.mul(0.299).add(sampled.g.mul(0.587)).add(sampled.b.mul(0.114));
        return vec4(particle.color.rgb, particle.color.a.mul(luma));
      };

    case "soft":
      return ({ uv, particle }: ColorNodeContext) => {
        // Smooth radial falloff: alpha is 1 at the centre and fades to 0 by
        // the edge of the quad. The smoothstep curve is gentler than a hard
        // circle, giving particles a glowing-puff read.
        const dist = uv.sub(vec2(0.5, 0.5)).length();
        const fall = float(1).sub(smoothstep(0.25, 0.5, dist));
        return vec4(particle.color.rgb, particle.color.a.mul(fall));
      };

    case "fire":
      return ({ uv, particle }: ColorNodeContext) => {
        // Organic flame look: each sprite procedurally draws several uneven
        // tongues instead of one repeated photo/teardrop. The silhouette varies
        // from particle state, so overlapping particles create irregular arms
        // and holes rather than a recognizable repeated cone.
        const u = uv.x.sub(0.5);
        const v = uv.y;

        const seed = particle.lifetime
          .mul(17.37)
          .add(particle.size.mul(9.71))
          .add(particle.position.x.mul(4.13))
          .add(particle.position.z.mul(6.19));

        const baseFade = smoothstep(0.0, 0.08, v);
        const edgeNoise = mx_noise_float(vec3(u.mul(10), v.mul(13), seed.add(5)), 1, 0);
        const edgeBite = mix(float(0.72), float(1.0), edgeNoise.mul(0.5).add(0.5));

        const tongue = (
          seedOffset: number,
          widthBase: number,
          widthTip: number,
          centerBias: number,
          start: number,
          end: number,
        ) => {
          const localT = smoothstep(start, end, v).clamp(0, 1);
          const span = smoothstep(start, start + 0.12, v).mul(
            float(1).sub(smoothstep(end - 0.16, end, v)),
          );
          const lean = mx_noise_float(vec3(v.mul(2.2), seed.add(seedOffset), 0), 1, 0).mul(0.22);
          const snake = mx_noise_float(
            vec3(v.mul(6.5), seed.add(seedOffset + 11.0), u.mul(0.7)),
            1,
            0,
          ).mul(0.12);
          const center = float(centerBias).mul(localT).add(lean).add(snake);
          const widthNoise = mx_noise_float(vec3(v.mul(8.0), seed.add(seedOffset + 23.0), 0), 1, 0)
            .mul(0.5)
            .add(0.5);
          const width = mix(float(widthBase), float(widthTip), localT.pow(0.62)).mul(
            mix(float(0.72), float(1.18), widthNoise),
          );
          const dist = u.sub(center).abs();
          return float(1)
            .sub(smoothstep(width.mul(0.72), width, dist))
            .mul(span);
        };

        const main = tongue(0.0, 0.28, 0.035, 0.02, 0.0, 0.98);
        const left = tongue(31.0, 0.18, 0.018, -0.28, 0.12, 0.9);
        const right = tongue(67.0, 0.16, 0.016, 0.27, 0.18, 0.84);
        const inner = tongue(101.0, 0.11, 0.012, -0.06, 0.02, 0.72);
        const silhouette = main
          .add(left)
          .add(right)
          .add(inner)
          .clamp(0, 1)
          .mul(baseFade)
          .mul(edgeBite);

        // Hot lower core with a thinner yellow-white line. It fades before
        // the tips so the upper arms stay orange/red and airy.
        const coreLine = float(1)
          .sub(smoothstep(0.0, 0.085, u.abs()))
          .mul(float(1).sub(smoothstep(0.22, 0.78, v)));
        const coreBloom = float(1)
          .sub(smoothstep(0.0, 0.22, u.abs()))
          .mul(float(1).sub(smoothstep(0.0, 0.62, v)));
        const core = coreLine.add(coreBloom.mul(0.45)).clamp(0, 1);
        const rgb = particle.color.rgb.add(vec3(1.8, 1.1, 0.4).mul(core));

        return vec4(rgb, particle.color.a.mul(silhouette));
      };

    case "smoke":
      return ({ uv, particle }: ColorNodeContext) => {
        // Cloud-like — heavy noise modulating the alpha so each puff has an
        // irregular wisp shape, not a perfect circle.
        const center = uv.sub(vec2(0.5, 0.5));
        const dist = center.length();
        const seed = particle.lifetime.mul(7.123);
        const n1 = mx_noise_float(vec3(uv.x.mul(2.5), uv.y.mul(2.5), seed), 0.5, 0.5);
        const n2 = mx_noise_float(vec3(uv.x.mul(5), uv.y.mul(5), seed.add(2)), 0.25, 0.25);
        const noisyDist = dist.add(n1.mul(0.2)).sub(n2.mul(0.1));
        const fall = float(1).sub(smoothstep(0.2, 0.55, noisyDist));
        return vec4(particle.color.rgb, particle.color.a.mul(fall));
      };

    case "spark":
      return ({ uv, particle }: ColorNodeContext) => {
        // 4-point star: combine a tight horizontal streak with a vertical one.
        const c = uv.sub(vec2(0.5, 0.5));
        const horiz = float(1)
          .sub(smoothstep(0.02, 0.3, c.x.abs()))
          .mul(float(1).sub(smoothstep(0.0, 0.5, c.y.abs())));
        const vert = float(1)
          .sub(smoothstep(0.02, 0.3, c.y.abs()))
          .mul(float(1).sub(smoothstep(0.0, 0.5, c.x.abs())));
        const star = horiz.add(vert).clamp(0, 1);
        // Bright punchy core.
        const core = float(1).sub(smoothstep(0.0, 0.08, c.length()));
        const alpha = star.add(core).clamp(0, 1);
        return vec4(particle.color.rgb, particle.color.a.mul(alpha));
      };
  }
}

/**
 * Build the material a `render.mesh` node uses. "pbr" returns the standard
 * `MeshStandardNodeMaterial`; "magma" returns a custom unlit material with a
 * domain-warped noise field that animates over time (looks like flowing lava
 * and is the right choice for stars/suns/molten orbs); "emissive" is a pure
 * unlit colour for non-physical glowing shapes.
 */
export function buildMeshMaterial(
  preset: MeshShader,
  color: [number, number, number],
  metalness: number,
  roughness: number,
): NodeMaterial {
  if (preset === "magma") {
    const mat = new MeshBasicNodeMaterial();
    // toneMapped=false so HDR colours stay HDR through bloom (when added).
    mat.toneMapped = false;
    void color;
    mat.colorNode = Fn(() => {
      // Sample noise in 3D position-space + time so the same point on the
      // sphere shifts colour smoothly as time advances. Domain warping (sample
      // once, perturb input, sample again) gives swirling rather than uniform
      // grain.
      const p = positionLocal.mul(2.2).add(vec3(time.mul(0.18), time.mul(0.13), time.mul(0.21)));
      const w = mx_noise_float(p, 1, 0).mul(0.55);
      const warped = p.add(vec3(w, w.mul(1.3), w.mul(0.8)));
      const n = mx_noise_float(warped, 1, 0).mul(0.5).add(0.5);

      // Magma palette: deep crust → red → orange → yellow → white-hot.
      const c1 = vec3(0.25, 0.03, 0.0);
      const c2 = vec3(2.5, 0.4, 0.05);
      const c3 = vec3(4.2, 1.6, 0.2);
      const c4 = vec3(6.5, 4.5, 1.2);
      const r1 = mix(c1, c2, smoothstep(0.0, 0.42, n));
      const r2 = mix(r1, c3, smoothstep(0.42, 0.72, n));
      return mix(r2, c4, smoothstep(0.72, 0.95, n));
    })();
    return mat;
  }

  if (preset === "emissive") {
    const mat = new MeshBasicNodeMaterial();
    mat.toneMapped = false;
    mat.color = new THREE.Color(color[0], color[1], color[2]);
    return mat;
  }

  // Default PBR.
  const m = new MeshStandardNodeMaterial();
  m.color = new THREE.Color(color[0], color[1], color[2]);
  m.metalness = metalness;
  m.roughness = roughness;
  return m;
}
