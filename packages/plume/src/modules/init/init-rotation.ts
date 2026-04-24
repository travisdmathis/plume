import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { scalarInputTSL } from "../../math/tsl-sample.js";
import type { ScalarInput } from "../../types.js";
import { registerModule } from "../registry.js";

export interface InitRotationParams {
  rotation?: ScalarInput;
  angularVelocity?: ScalarInput;
  id?: string;
}

export class InitRotation implements ParticleSpawnModule {
  static readonly type = "init.rotation";
  readonly kind = "particle_spawn" as const;
  readonly type = InitRotation.type;
  readonly id?: string;
  rotation: ScalarInput;
  angularVelocity: ScalarInput;

  constructor(params: InitRotationParams) {
    this.rotation = params.rotation ?? { kind: "constant", value: 0 };
    this.angularVelocity = params.angularVelocity ?? { kind: "constant", value: 0 };
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    attr.rotation.write(ctx.storage, ctx.slot, scalarInputTSL(this.rotation, ctx.seed, 80));
    attr.angularVelocity.write(
      ctx.storage,
      ctx.slot,
      scalarInputTSL(this.angularVelocity, ctx.seed, 82),
    );
  }

  toJSON(): ModuleJSON {
    return {
      type: InitRotation.type,
      id: this.id,
      rotation: this.rotation,
      angularVelocity: this.angularVelocity,
    };
  }

  static fromJSON(data: ModuleJSON): InitRotation {
    return new InitRotation({
      rotation: data["rotation"] as ScalarInput | undefined,
      angularVelocity: data["angularVelocity"] as ScalarInput | undefined,
      id: data.id,
    });
  }
}

registerModule(InitRotation);
