import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { uniform } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { Vec3Tuple } from "../../types.js";
import { registerModule } from "../registry.js";

export interface GravityParams {
  acceleration?: Vec3Tuple;
  id?: string;
}

export class Gravity implements ParticleUpdateModule {
  static readonly type = "update.gravity";
  readonly kind = "particle_update" as const;
  readonly type = Gravity.type;
  readonly id?: string;
  acceleration: Vec3Tuple;
  private _uAccel: UniformNode<"vec3", THREE.Vector3>;

  constructor(params: GravityParams = {}) {
    this.acceleration = params.acceleration ?? [0, -9.81, 0];
    this.id = params.id;
    this._uAccel = uniform(
      new THREE.Vector3(this.acceleration[0], this.acceleration[1], this.acceleration[2]),
    ) as UniformNode<"vec3", THREE.Vector3>;
  }

  /** Change acceleration at runtime without rebuilding the kernel. */
  setAcceleration(x: number, y: number, z: number): void {
    this.acceleration = [x, y, z];
    this._uAccel.value.set(x, y, z);
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(this._uAccel.mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return { type: Gravity.type, id: this.id, acceleration: this.acceleration };
  }

  static fromJSON(data: ModuleJSON): Gravity {
    return new Gravity({
      acceleration: data["acceleration"] as Vec3Tuple | undefined,
      id: data.id,
    });
  }
}

registerModule(Gravity);
