import { vec4 } from "three/tsl";
import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import type { EmissionShape } from "../../math/shapes.js";
import { sampleDirectionTSL, scalarInputTSL } from "../../math/tsl-sample.js";
import type { ScalarInput } from "../../types.js";
import { registerModule } from "../registry.js";

export interface InitVelocityParams {
  shape: EmissionShape;
  speed: ScalarInput;
  /** If true (default), the sampled direction is rotated by the emitter's world matrix. */
  worldSpace?: boolean;
  id?: string;
}

export class InitVelocity implements ParticleSpawnModule {
  static readonly type = "init.velocity";
  readonly kind = "particle_spawn" as const;
  readonly type = InitVelocity.type;
  readonly id?: string;
  shape: EmissionShape;
  speed: ScalarInput;
  worldSpace: boolean;

  constructor(params: InitVelocityParams) {
    this.shape = params.shape;
    this.speed = params.speed;
    this.worldSpace = params.worldSpace ?? true;
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const localDir = sampleDirectionTSL(this.shape, ctx.seed, 30);
    const speed = scalarInputTSL(this.speed, ctx.seed, 40);
    const localVel = localDir.mul(speed);
    const worldVel = this.worldSpace
      ? ctx.worldMatrix.mul(vec4(localVel, 0.0)).xyz
      : localVel;
    attr.velocity.write(ctx.storage, ctx.slot, worldVel);
  }

  toJSON(): ModuleJSON {
    return {
      type: InitVelocity.type,
      id: this.id,
      shape: this.shape,
      speed: this.speed,
      worldSpace: this.worldSpace,
    };
  }

  static fromJSON(data: ModuleJSON): InitVelocity {
    return new InitVelocity({
      shape: data["shape"] as EmissionShape,
      speed: data["speed"] as ScalarInput,
      worldSpace: data["worldSpace"] as boolean | undefined,
      id: data.id,
    });
  }
}

registerModule(InitVelocity);
