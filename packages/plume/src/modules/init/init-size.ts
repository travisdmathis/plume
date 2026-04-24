import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { scalarInputTSL } from "../../math/tsl-sample.js";
import type { ScalarInput } from "../../types.js";
import { registerModule } from "../registry.js";

export interface InitSizeParams {
  size: ScalarInput;
  id?: string;
}

export class InitSize implements ParticleSpawnModule {
  static readonly type = "init.size";
  readonly kind = "particle_spawn" as const;
  readonly type = InitSize.type;
  readonly id?: string;
  size: ScalarInput;

  constructor(params: InitSizeParams) {
    this.size = params.size;
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const size = scalarInputTSL(this.size, ctx.seed, 70);
    attr.size.write(ctx.storage, ctx.slot, size);
  }

  toJSON(): ModuleJSON {
    return { type: InitSize.type, id: this.id, size: this.size };
  }

  static fromJSON(data: ModuleJSON): InitSize {
    return new InitSize({ size: data["size"] as ScalarInput, id: data.id });
  }
}

registerModule(InitSize);
