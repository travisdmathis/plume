import * as THREE from "three";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { uniform, vec4 } from "three/tsl";

import { attr } from "../../particle-buffer.js";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { registerModule } from "../registry.js";

export interface FollowPositionParams {
  id?: string;
}

/**
 * Pins live particles to the `Manager.spawn(..., { follow })` target position.
 *
 * When no follow target is active, it falls back to the system origin from `worldMatrix`.
 * That makes trail prefabs useful both as socket-following effects and as regular
 * position-driven effects.
 */
export class FollowPosition implements ParticleUpdateModule {
  static readonly type = "update.follow_position";
  readonly kind = "particle_update" as const;
  readonly type = FollowPosition.type;
  readonly id?: string;

  private _uPosition: UniformNode<"vec3", THREE.Vector3>;
  private _uHasFollow: UniformNode<"float", number>;

  constructor(params: FollowPositionParams = {}) {
    this.id = params.id;
    this._uPosition = uniform(new THREE.Vector3()) as UniformNode<"vec3", THREE.Vector3>;
    this._uHasFollow = uniform(0) as UniformNode<"float", number>;
  }

  setFollowPosition(position: THREE.Vector3, hasFollow: boolean): void {
    this._uPosition.value.copy(position);
    this._uHasFollow.value = hasFollow ? 1 : 0;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const systemOrigin = ctx.worldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const target = this._uHasFollow.greaterThan(0.5).select(this._uPosition, systemOrigin);
    attr.position.write(ctx.storage, ctx.i, target);
  }

  toJSON(): ModuleJSON {
    return { type: FollowPosition.type, id: this.id };
  }

  static fromJSON(data: ModuleJSON): FollowPosition {
    return new FollowPosition({ id: data.id });
  }
}

registerModule(FollowPosition);
