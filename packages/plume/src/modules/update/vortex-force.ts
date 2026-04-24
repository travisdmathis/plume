import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { cross, uniform, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { Vec3Tuple } from "../../types.js";
import { registerModule } from "../registry.js";

export interface VortexForceParams {
  /** Rotation axis (world-space unless `worldSpace` is false). Auto-normalized. */
  axis?: Vec3Tuple;
  /** A point on the axis. Defaults to origin (emitter local). */
  origin?: Vec3Tuple;
  /** Tangential acceleration magnitude (units/sec²). Positive = counterclockwise around axis. */
  strength: number;
  /** If true, `origin` is taken as-is in world space; otherwise transformed by emitter world. */
  worldSpace?: boolean;
  id?: string;
}

/**
 * Rotational force that pulls particles in a circular path around an arbitrary axis.
 * At each particle, the tangent direction is `axis × (p - origin)` — pushing it perpendicular
 * to both the axis and the radial vector. Use for whirlwinds, vortexes, circular wind.
 */
export class VortexForce implements ParticleUpdateModule {
  static readonly type = "update.vortex_force";
  readonly kind = "particle_update" as const;
  readonly type = VortexForce.type;
  readonly id?: string;
  axis: Vec3Tuple;
  origin: Vec3Tuple;
  strength: number;
  worldSpace: boolean;

  private _uAxis: UniformNode<"vec3", THREE.Vector3>;
  private _uOrigin: UniformNode<"vec3", THREE.Vector3>;
  private _uStrength: UniformNode<"float", number>;

  constructor(params: VortexForceParams) {
    this.axis = params.axis ?? [0, 1, 0];
    this.origin = params.origin ?? [0, 0, 0];
    this.strength = params.strength;
    this.worldSpace = params.worldSpace ?? false;
    this.id = params.id;

    const a = new THREE.Vector3(this.axis[0], this.axis[1], this.axis[2]);
    if (a.lengthSq() > 0) a.normalize();
    else a.set(0, 1, 0);
    this._uAxis = uniform(a) as UniformNode<"vec3", THREE.Vector3>;
    this._uOrigin = uniform(
      new THREE.Vector3(this.origin[0], this.origin[1], this.origin[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
    this._uStrength = uniform(this.strength) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const originWorld = this.worldSpace
      ? this._uOrigin
      : ctx.worldMatrix.mul(vec4(this._uOrigin, 1.0)).xyz;
    const radial = pos.sub(originWorld);
    // Tangent = axis × radial, direction of rotation. Magnitude scaled by strength.
    const tangent = cross(this._uAxis, radial);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(tangent.mul(this._uStrength).mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return {
      type: VortexForce.type,
      id: this.id,
      axis: this.axis,
      origin: this.origin,
      strength: this.strength,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): VortexForce {
    return new VortexForce({
      axis: data["axis"] as Vec3Tuple | undefined,
      origin: data["origin"] as Vec3Tuple | undefined,
      strength: Number(data["strength"] ?? 0),
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(VortexForce);
