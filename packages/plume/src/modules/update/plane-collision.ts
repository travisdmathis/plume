import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, dot, uniform, vec3, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { Vec3Tuple } from "../../types.js";
import { registerModule } from "../registry.js";

export interface PlaneCollisionParams {
  /** Normal of the collision plane (auto-normalized). Default +Y (floor). */
  normal?: Vec3Tuple;
  /** Any point on the plane. Default origin. */
  point?: Vec3Tuple;
  /** 1.0 = perfect bounce, 0.0 = stick. Default 0.5. */
  restitution?: number;
  /** Tangential velocity retention after bounce. 1.0 = no friction. Default 0.9. */
  friction?: number;
  /** If true, plane is taken in world space as given; else transformed by emitter world matrix. */
  worldSpace?: boolean;
  id?: string;
}

/**
 * Infinite plane collision with restitution + friction. Reflects velocity component along the
 * plane normal, optionally dampens tangential motion. Clamps position so particles never
 * penetrate. For a floor, use default `normal = [0, 1, 0]`.
 */
export class PlaneCollision implements ParticleUpdateModule {
  static readonly type = "update.plane_collision";
  readonly kind = "particle_update" as const;
  readonly type = PlaneCollision.type;
  readonly id?: string;
  normal: Vec3Tuple;
  point: Vec3Tuple;
  restitution: number;
  friction: number;
  worldSpace: boolean;

  private _uNormal: UniformNode<"vec3", THREE.Vector3>;
  private _uPoint: UniformNode<"vec3", THREE.Vector3>;
  private _uRestitution: UniformNode<"float", number>;
  private _uFriction: UniformNode<"float", number>;

  constructor(params: PlaneCollisionParams = {}) {
    this.normal = params.normal ?? [0, 1, 0];
    this.point = params.point ?? [0, 0, 0];
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;

    const n = new THREE.Vector3(this.normal[0], this.normal[1], this.normal[2]);
    if (n.lengthSq() > 0) n.normalize();
    else n.set(0, 1, 0);
    this._uNormal = uniform(n) as UniformNode<"vec3", THREE.Vector3>;
    this._uPoint = uniform(
      new THREE.Vector3(this.point[0], this.point[1], this.point[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
    this._uRestitution = uniform(this.restitution) as UniformNode<"float", number>;
    this._uFriction = uniform(this.friction) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i).toVar();
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const normal = this.worldSpace
      ? this._uNormal
      : ctx.worldMatrix.mul(vec4(this._uNormal, 0.0)).xyz;
    const planePoint = this.worldSpace
      ? this._uPoint
      : ctx.worldMatrix.mul(vec4(this._uPoint, 1.0)).xyz;

    // Signed distance from particle to plane.
    const signedDist = dot(pos.sub(planePoint), normal);
    // Penetration: signedDist < 0 (behind the plane along its normal).
    If(signedDist.lessThan(0), () => {
      // Snap back to the plane surface.
      pos.assign(pos.sub(normal.mul(signedDist)));
      const vn = dot(vel, normal);
      // Only reflect if actually moving into the plane (vn < 0).
      If(vn.lessThan(0), () => {
        const normalVel = normal.mul(vn);
        const tangentVel = vel.sub(normalVel);
        vel.assign(tangentVel.mul(this._uFriction).sub(normalVel.mul(this._uRestitution)));
      });
      attr.position.write(ctx.storage, ctx.i, pos);
      attr.velocity.write(ctx.storage, ctx.i, vel);
    });
    void vec3; // keep import used
  }

  toJSON(): ModuleJSON {
    return {
      type: PlaneCollision.type,
      id: this.id,
      normal: this.normal,
      point: this.point,
      restitution: this.restitution,
      friction: this.friction,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): PlaneCollision {
    return new PlaneCollision({
      normal: data["normal"] as Vec3Tuple | undefined,
      point: data["point"] as Vec3Tuple | undefined,
      restitution: data["restitution"] as number | undefined,
      friction: data["friction"] as number | undefined,
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(PlaneCollision);
