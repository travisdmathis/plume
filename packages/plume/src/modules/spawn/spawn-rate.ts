import type { EmitterContext, EmitterSpawnModule, ModuleJSON } from "../module.js";
import { registerModule } from "../registry.js";

export interface SpawnRateParams {
  /** Particles per second. */
  rate: number;
  id?: string;
}

/** Continuous spawner emitting `rate` particles per second. Fractional carry-over accumulates. */
export class SpawnRate implements EmitterSpawnModule {
  static readonly type = "spawn.rate";
  readonly kind = "emitter_spawn" as const;
  readonly type = SpawnRate.type;
  readonly id?: string;
  rate: number;

  private _accumulator = 0;

  constructor(params: SpawnRateParams) {
    this.rate = params.rate;
    this.id = params.id;
  }

  reset(): void {
    this._accumulator = 0;
  }

  requestSpawn(ctx: EmitterContext): number {
    if (this.rate <= 0) return 0;
    this._accumulator += this.rate * ctx.deltaTime * ctx.intensity;
    const whole = Math.floor(this._accumulator);
    this._accumulator -= whole;
    return whole;
  }

  toJSON(): ModuleJSON {
    return { type: SpawnRate.type, id: this.id, rate: this.rate };
  }

  static fromJSON(data: ModuleJSON): SpawnRate {
    return new SpawnRate({
      rate: Number(data["rate"] ?? 0),
      id: data.id,
    });
  }
}

registerModule(SpawnRate);
