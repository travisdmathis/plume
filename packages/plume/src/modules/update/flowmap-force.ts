import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { texture, uniform, vec2, vec3 } from "three/tsl";

import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

/** Which world plane the flowmap texture covers. The other axis is preserved untouched. */
export type FlowmapAxis = "xz" | "xy" | "yz";

export interface FlowmapForceParams {
  /**
   * RGBA texture whose R/G channels encode a 2D flow direction. Convention: each pixel's
   * `(r, g)` is decoded as `(r * 2 - 1, g * 2 - 1)` to recover a direction in [-1, +1]² —
   * standard "centered-at-0.5" flowmap encoding (matches Houdini, Substance, common engines).
   * The B/A channels are unused by this module but you can repurpose them in custom shaders.
   */
  texture: THREE.Texture;
  /**
   * World-space corner where the texture's UV (0, 0) sits. Together with `size` and `axis`
   * this defines the rectangle that maps onto the texture.
   */
  origin: [number, number, number];
  /**
   * Width × height of the textured rectangle in world units, along the two axes named by
   * `axis`. Particles outside this rectangle still get sampled — texture wrapping comes from
   * the underlying `THREE.Texture` settings (default repeat or clamp).
   */
  size: [number, number];
  /** Which world plane the flowmap covers. Default `"xz"` (top-down ground flow). */
  axis?: FlowmapAxis;
  /** How hard the flow pushes velocity. Multiplied into the decoded direction × dt. Default 1. */
  amplitude?: number;
  id?: string;
}

/**
 * Texture-driven motion. Each frame, every particle samples a flowmap texture at its world
 * position projected onto the configured plane, decodes the R/G channels into a 2D direction,
 * scales by `amplitude * dt`, and adds the result to the particle's velocity.
 *
 * Use for: wind fields, water currents, magical streams that follow painted curves, lava
 * flow, fluid simulations baked from offline tools like Houdini.
 *
 * Example — particles drifting along a top-down flowmap:
 * ```ts
 * .flowmapForce({
 *   texture: flowmap,           // RGBA, R/G = direction
 *   origin: [-10, 0, -10],      // (0,0) UV maps here
 *   size: [20, 20],             // 20×20 world units → full texture
 *   axis: "xz",
 *   amplitude: 3,
 * })
 * ```
 */
export class FlowmapForce implements ParticleUpdateModule {
  static readonly type = "update.flowmap_force";
  readonly kind = "particle_update" as const;
  readonly type = FlowmapForce.type;
  readonly id?: string;

  texture: THREE.Texture;
  origin: [number, number, number];
  size: [number, number];
  axis: FlowmapAxis;
  amplitude: number;

  private _uOrigin: UniformNode<"vec3", THREE.Vector3>;
  private _uInvSize: UniformNode<"vec2", THREE.Vector2>;
  private _uAmplitude: UniformNode<"float", number>;

  constructor(params: FlowmapForceParams) {
    this.texture = params.texture;
    this.origin = params.origin;
    this.size = params.size;
    this.axis = params.axis ?? "xz";
    this.amplitude = params.amplitude ?? 1;
    this.id = params.id;

    this._uOrigin = uniform(
      new THREE.Vector3(this.origin[0], this.origin[1], this.origin[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
    // Pre-invert so the shader does a single multiply instead of a divide per particle.
    this._uInvSize = uniform(
      new THREE.Vector2(1 / Math.max(this.size[0], 1e-6), 1 / Math.max(this.size[1], 1e-6)),
    ) as UniformNode<"vec2", THREE.Vector2>;
    this._uAmplitude = uniform(this.amplitude) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const tex = texture(this.texture);

    // World position relative to the flowmap rectangle's origin, projected onto the
    // configured plane → UV.
    const rel = pos.sub(this._uOrigin);
    let u: Node<"float">;
    let v: Node<"float">;
    let force: Node<"vec3">;
    switch (this.axis) {
      case "xz": {
        u = rel.x.mul(this._uInvSize.x);
        v = rel.z.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        // R/G are centered at 0.5, decode to [-1, +1].
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(dir2.x, 0, dir2.y);
        break;
      }
      case "xy": {
        u = rel.x.mul(this._uInvSize.x);
        v = rel.y.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(dir2.x, dir2.y, 0);
        break;
      }
      case "yz": {
        u = rel.y.mul(this._uInvSize.x);
        v = rel.z.mul(this._uInvSize.y);
        const sample = tex.sample(vec2(u, v));
        const dir2 = vec2(sample.r.mul(2).sub(1), sample.g.mul(2).sub(1));
        force = vec3(0, dir2.x, dir2.y);
        break;
      }
    }

    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(this._uAmplitude).mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return {
      type: FlowmapForce.type,
      id: this.id,
      origin: this.origin,
      size: this.size,
      axis: this.axis,
      amplitude: this.amplitude,
      // texture isn't serializable — caller must re-supply on fromJSON.
    };
  }

  static fromJSON(_data: ModuleJSON): FlowmapForce {
    throw new Error("FlowmapForce cannot be deserialized without a texture reference.");
  }
}

registerModule(FlowmapForce);
