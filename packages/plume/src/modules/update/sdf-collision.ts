import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, dot, float, normalize, uniform, vec3 } from "three/tsl";

import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { SdfFn } from "../../math/sdf.js";
import { registerModule } from "../registry.js";

export type SdfCollisionMode = "kill" | "stop" | "bounce";

export interface SdfCollisionParams {
  /**
   * Signed-distance function evaluated per particle. Return value < 0 means inside (collided),
   * > 0 means outside. Typically composed from `sdfSphere`/`sdfBox`/`sdfPlane` + union/
   * intersect/subtract helpers exported from `plume`.
   */
  sdf: SdfFn;
  /**
   * How to respond on collision.
   * - `"kill"`: set `alive = 0`, retiring the particle.
   * - `"stop"`: zero the velocity.
   * - `"bounce"` (default): reflect velocity about the SDF gradient (the surface normal),
   *   scaled by `restitution` / `friction`. Position is pushed out to the surface to
   *   prevent stick-through on the next frame.
   */
  mode?: SdfCollisionMode;
  /** Bounce normal-component energy retention. Default 0.5. */
  restitution?: number;
  /** Bounce tangential-component retention. Default 0.9. */
  friction?: number;
  /** Particles with SDF value below this threshold count as collided. Default 0.02. */
  thickness?: number;
  /** Epsilon for finite-difference gradient — smaller is more accurate but noisier. Default 0.01. */
  gradientEpsilon?: number;
  id?: string;
}

/**
 * Analytic collision against an arbitrary signed-distance field. Unlike `DepthCollision`,
 * this works for every particle regardless of camera — no depth pre-pass, no screen-space
 * limits. Cost: up to 5 SDF evaluations per particle per frame in `"bounce"` mode (one for
 * the hit test, four for the gradient-based normal via Mikael Hvidtfeldt Christensen's
 * tetrahedron trick).
 *
 * Use for magical barriers, force fields, procedural colliders, or anything where a closed-
 * form distance is known. Compose primitives via `sdfUnion`/`sdfIntersect`/`sdfSubtract`.
 */
export class SdfCollision implements ParticleUpdateModule {
  static readonly type = "update.sdf_collision";
  readonly kind = "particle_update" as const;
  readonly type = SdfCollision.type;
  readonly id?: string;

  sdf: SdfFn;
  mode: SdfCollisionMode;
  restitution: number;
  friction: number;
  thickness: number;
  gradientEpsilon: number;

  private _uRestitution: UniformNode<"float", number>;
  private _uFriction: UniformNode<"float", number>;
  private _uThickness: UniformNode<"float", number>;
  private _uEps: UniformNode<"float", number>;

  constructor(params: SdfCollisionParams) {
    this.sdf = params.sdf;
    this.mode = params.mode ?? "bounce";
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.thickness = params.thickness ?? 0.02;
    this.gradientEpsilon = params.gradientEpsilon ?? 0.01;
    this.id = params.id;
    this._uRestitution = uniform(this.restitution) as UniformNode<"float", number>;
    this._uFriction = uniform(this.friction) as UniformNode<"float", number>;
    this._uThickness = uniform(this.thickness) as UniformNode<"float", number>;
    this._uEps = uniform(this.gradientEpsilon) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const d = this.sdf(pos);
    const collided = d.lessThan(this._uThickness);

    If(collided, () => {
      if (this.mode === "kill") {
        attr.alive.write(ctx.storage, ctx.i, float(0));
      } else if (this.mode === "stop") {
        attr.velocity.write(ctx.storage, ctx.i, vec3(0, 0, 0));
      } else {
        // "bounce": reconstruct normal via the tetrahedron trick — 4 SDF evaluations
        // combined with sign vectors yield the gradient of the SDF, which for a smooth
        // surface is its outward normal.
        const n = this._gradientNormal(pos);
        // Push the particle back to the surface (plus `thickness` tolerance) so it doesn't
        // stay inside and re-collide every frame.
        const pushed = pos.add(n.mul(this._uThickness.sub(d)));
        attr.position.write(ctx.storage, ctx.i, pushed);

        const vel = attr.velocity.read(ctx.storage, ctx.i);
        const vDotN = dot(vel, n);
        const vNormal = n.mul(vDotN);
        const vTangent = vel.sub(vNormal);
        const reflected: Node<"vec3"> = vTangent
          .mul(this._uFriction)
          .sub(vNormal.mul(this._uRestitution));
        attr.velocity.write(ctx.storage, ctx.i, reflected);
      }
    });
  }

  /**
   * SDF gradient via Christensen's tetrahedron offsets — 4 SDF evaluations instead of 6
   * for central differences, with identical accuracy at typical epsilons.
   */
  private _gradientNormal(p: Node<"vec3">): Node<"vec3"> {
    const h = this._uEps;
    const k1 = vec3(1, -1, -1);
    const k2 = vec3(-1, -1, 1);
    const k3 = vec3(-1, 1, -1);
    const k4 = vec3(1, 1, 1);
    const d1 = this.sdf(p.add(k1.mul(h)));
    const d2 = this.sdf(p.add(k2.mul(h)));
    const d3 = this.sdf(p.add(k3.mul(h)));
    const d4 = this.sdf(p.add(k4.mul(h)));
    const grad = k1.mul(d1).add(k2.mul(d2)).add(k3.mul(d3)).add(k4.mul(d4));
    return normalize(grad);
  }

  toJSON(): ModuleJSON {
    return {
      type: SdfCollision.type,
      id: this.id,
      mode: this.mode,
      restitution: this.restitution,
      friction: this.friction,
      thickness: this.thickness,
      gradientEpsilon: this.gradientEpsilon,
      // sdf function isn't serializable — caller must re-supply on fromJSON.
    };
  }

  static fromJSON(_data: ModuleJSON): SdfCollision {
    throw new Error("SdfCollision cannot be deserialized without an `sdf` function reference.");
  }
}

registerModule(SdfCollision);
