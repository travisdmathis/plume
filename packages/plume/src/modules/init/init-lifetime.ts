import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { scalarInputTSL } from "../../math/tsl-sample.js";
import type { ScalarInput } from "../../types.js";
import { registerModule } from "../registry.js";

export interface InitLifetimeParams {
  lifetime: ScalarInput;
  id?: string;
}

export class InitLifetime implements ParticleSpawnModule {
  static readonly type = "init.lifetime";
  readonly kind = "particle_spawn" as const;
  readonly type = InitLifetime.type;
  readonly id?: string;
  lifetime: ScalarInput;

  constructor(params: InitLifetimeParams) {
    this.lifetime = params.lifetime;
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const life = scalarInputTSL(this.lifetime, ctx.seed, 10);
    attr.lifetime.write(ctx.storage, ctx.slot, life);
  }

  toJSON(): ModuleJSON {
    return { type: InitLifetime.type, id: this.id, lifetime: this.lifetime };
  }

  static fromJSON(data: ModuleJSON): InitLifetime {
    return new InitLifetime({
      lifetime: data["lifetime"] as ScalarInput,
      id: data.id,
    });
  }
}

registerModule(InitLifetime);
