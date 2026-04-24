import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, dot, length, uniform, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { Vec3Tuple } from "../../types.js";
import { registerModule } from "../registry.js";

export interface SphereCollisionParams {
  center?: Vec3Tuple;
  radius: number;
  /** If true, particles bounce off the OUTSIDE of the sphere; false = inside containment. */
  outside?: boolean;
  restitution?: number;
  friction?: number;
  worldSpace?: boolean;
  id?: string;
}

/**
 * Sphere collision — either particles bounce off the outside (default) or are contained
 * inside. Useful for spherical obstacles or magical barriers.
 */
export class SphereCollision implements ParticleUpdateModule {
  static readonly type = "update.sphere_collision";
  readonly kind = "particle_update" as const;
  readonly type = SphereCollision.type;
  readonly id?: string;
  center: Vec3Tuple;
  radius: number;
  outside: boolean;
  restitution: number;
  friction: number;
  worldSpace: boolean;

  private _uCenter: UniformNode<"vec3", THREE.Vector3>;
  private _uRadius: UniformNode<"float", number>;
  private _uRestitution: UniformNode<"float", number>;
  private _uFriction: UniformNode<"float", number>;

  constructor(params: SphereCollisionParams) {
    this.center = params.center ?? [0, 0, 0];
    this.radius = params.radius;
    this.outside = params.outside ?? true;
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;

    this._uCenter = uniform(
      new THREE.Vector3(this.center[0], this.center[1], this.center[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
    this._uRadius = uniform(this.radius) as UniformNode<"float", number>;
    this._uRestitution = uniform(this.restitution) as UniformNode<"float", number>;
    this._uFriction = uniform(this.friction) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const center = this.worldSpace
      ? this._uCenter
      : ctx.worldMatrix.mul(vec4(this._uCenter, 1.0)).xyz;

    const offset = pos.sub(center);
    const dist = length(offset).max(0.0001);
    const normal = offset.div(dist);

    // For `outside=true`: collision when dist < radius (particle inside sphere). Push out.
    // For `outside=false`: collision when dist > radius (particle outside container). Pull in.
    const penetrating = this.outside
      ? dist.lessThan(this._uRadius)
      : dist.greaterThan(this._uRadius);

    If(penetrating, () => {
      // Snap to surface. For outside-mode, move outward along normal to radius;
      // for inside-mode, move inward (flip the normal direction).
      const surfaceNormal = this.outside ? normal : normal.negate();
      pos.assign(center.add(surfaceNormal.mul(this._uRadius)));
      const vn = dot(vel, surfaceNormal);
      If(vn.lessThan(0), () => {
        const normalVel = surfaceNormal.mul(vn);
        const tangentVel = vel.sub(normalVel);
        vel.assign(tangentVel.mul(this._uFriction).sub(normalVel.mul(this._uRestitution)));
      });
      attr.position.write(ctx.storage, ctx.i, pos);
      attr.velocity.write(ctx.storage, ctx.i, vel);
    });
  }

  toJSON(): ModuleJSON {
    return {
      type: SphereCollision.type,
      id: this.id,
      center: this.center,
      radius: this.radius,
      outside: this.outside,
      restitution: this.restitution,
      friction: this.friction,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): SphereCollision {
    return new SphereCollision({
      center: data["center"] as Vec3Tuple | undefined,
      radius: Number(data["radius"] ?? 1),
      outside: data["outside"] as boolean | undefined,
      restitution: data["restitution"] as number | undefined,
      friction: data["friction"] as number | undefined,
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(SphereCollision);
