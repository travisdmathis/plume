import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, float, uniform, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { Vec3Tuple } from "../../types.js";
import { registerModule } from "../registry.js";

export type PointAttractorFalloff = "none" | "linear" | "inverse" | "inverseSquared";

export interface PointAttractorParams {
  position?: Vec3Tuple;
  strength: number;
  radius: number;
  falloff?: PointAttractorFalloff;
  worldSpace?: boolean;
  id?: string;
}

/** Pulls particles toward (or away from) a point within a radius. */
export class PointAttractor implements ParticleUpdateModule {
  static readonly type = "update.point_attractor";
  readonly kind = "particle_update" as const;
  readonly type = PointAttractor.type;
  readonly id?: string;
  position: Vec3Tuple;
  strength: number;
  radius: number;
  falloff: PointAttractorFalloff;
  worldSpace: boolean;

  private _uLocalPos: UniformNode<"vec3", THREE.Vector3>;
  private _uStrength: UniformNode<"float", number>;
  private _uRadius: UniformNode<"float", number>;

  constructor(params: PointAttractorParams) {
    this.position = params.position ?? [0, 0, 0];
    this.strength = params.strength;
    this.radius = params.radius;
    this.falloff = params.falloff ?? "linear";
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;
    this._uLocalPos = uniform(
      new THREE.Vector3(this.position[0], this.position[1], this.position[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
    this._uStrength = uniform(this.strength) as UniformNode<"float", number>;
    this._uRadius = uniform(this.radius) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    // Resolve attractor world-space position. When `worldSpace` is false, transform by the emitter's world matrix.
    // We stash it as a vec3 — worldMatrix is mat4 so use vec4(local, 1.0) then extract xyz.
    // For simplicity we compute world position inline; three.js uniforms unchanged.
    // Note: if worldMatrix changes per tick we pay the matrix-multiply per particle — fine for v1.
    // (Later we can precompute the worldPos on CPU as a uniform and skip per-particle.)
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const targetLocal = this._uLocalPos;
    const targetWorld = this.worldSpace
      ? targetLocal
      : ctx.worldMatrix.mul(vec4(targetLocal, 1.0)).xyz;

    const toTarget = targetWorld.sub(pos).toVar();
    const dist = toTarget.length();
    If(dist.lessThan(this._uRadius).and(dist.greaterThan(0.0001)), () => {
      const normDist = dist.div(this._uRadius);
      let f;
      switch (this.falloff) {
        case "linear":
          f = float(1).sub(normDist);
          break;
        case "inverse":
          f = float(1).div(normDist).sub(1);
          break;
        case "inverseSquared":
          f = float(1).div(normDist.mul(normDist)).sub(1);
          break;
        case "none":
        default:
          f = float(1);
          break;
      }
      const dir = toTarget.div(dist);
      const force = dir.mul(this._uStrength).mul(f);
      const vel = attr.velocity.read(ctx.storage, ctx.i);
      attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
    });
  }

  toJSON(): ModuleJSON {
    return {
      type: PointAttractor.type,
      id: this.id,
      position: this.position,
      strength: this.strength,
      radius: this.radius,
      falloff: this.falloff,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): PointAttractor {
    return new PointAttractor({
      position: data["position"] as Vec3Tuple | undefined,
      strength: Number(data["strength"] ?? 0),
      radius: Number(data["radius"] ?? 1),
      falloff: data["falloff"] as PointAttractorFalloff | undefined,
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(PointAttractor);
