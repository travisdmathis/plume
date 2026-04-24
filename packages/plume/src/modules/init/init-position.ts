import { vec4 } from "three/tsl";
import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { EmissionShape } from "../../math/shapes.js";
import { samplePositionTSL } from "../../math/tsl-sample.js";
import { registerModule } from "../registry.js";

export interface InitPositionParams {
  shape: EmissionShape;
  /** If true (default), sampled positions are transformed by emitter world matrix. */
  worldSpace?: boolean;
  id?: string;
}

export class InitPosition implements ParticleSpawnModule {
  static readonly type = "init.position";
  readonly kind = "particle_spawn" as const;
  readonly type = InitPosition.type;
  readonly id?: string;
  shape: EmissionShape;
  worldSpace: boolean;

  constructor(params: InitPositionParams) {
    this.shape = params.shape;
    this.worldSpace = params.worldSpace ?? true;
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const localPos = samplePositionTSL(this.shape, ctx.seed, 20);
    const worldPos = this.worldSpace
      ? ctx.worldMatrix.mul(vec4(localPos, 1.0)).xyz
      : localPos;
    attr.position.write(ctx.storage, ctx.slot, worldPos);
  }

  toJSON(): ModuleJSON {
    return {
      type: InitPosition.type,
      id: this.id,
      shape: this.shape,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): InitPosition {
    return new InitPosition({
      shape: data["shape"] as EmissionShape,
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(InitPosition);
