import type { EmitterContext, EmitterSpawnModule, ModuleJSON } from "../module.js";
import { registerModule } from "../registry.js";

export interface SpawnBurstEntry {
  /** Seconds after emitter start when this burst fires. */
  time: number;
  /** Number of particles to emit. */
  count: number;
  /** Fire every `cycle` seconds after `time` (0 = one-shot). */
  cycle?: number;
  /** Max number of cycles to fire (defaults to Infinity when cycle > 0). */
  repeats?: number;
}

export interface SpawnBurstParams {
  bursts: SpawnBurstEntry[];
  id?: string;
}

/** Burst spawner: fires configurable bursts of particles at specific times or on a cycle. */
export class SpawnBurst implements EmitterSpawnModule {
  static readonly type = "spawn.burst";
  readonly kind = "emitter_spawn" as const;
  readonly type = SpawnBurst.type;
  readonly id?: string;
  readonly bursts: SpawnBurstEntry[];

  private _fired: number[] = [];

  constructor(params: SpawnBurstParams) {
    this.bursts = params.bursts.map((b) => ({
      time: b.time,
      count: b.count,
      cycle: b.cycle ?? 0,
      repeats: b.repeats ?? (b.cycle && b.cycle > 0 ? Infinity : 1),
    }));
    this._fired = new Array(this.bursts.length).fill(0);
    this.id = params.id;
  }

  reset(): void {
    this._fired.fill(0);
  }

  requestSpawn(ctx: EmitterContext): number {
    let total = 0;
    const t = ctx.emitterTime;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i]!;
      const fired = this._fired[i]!;
      const repeats = b.repeats ?? Infinity;
      if (fired >= repeats) continue;

      // Total number of trigger instants that have occurred by time t (independent of frame boundaries).
      let triggersSoFar: number;
      if (b.cycle && b.cycle > 0) {
        triggersSoFar = t >= b.time ? Math.floor((t - b.time) / b.cycle) + 1 : 0;
      } else {
        triggersSoFar = t >= b.time ? 1 : 0;
      }
      triggersSoFar = Math.min(triggersSoFar, repeats);

      const newTriggers = triggersSoFar - fired;
      if (newTriggers > 0) {
        total += newTriggers * Math.round(b.count * ctx.intensity);
        this._fired[i] = triggersSoFar;
      }
    }
    return total;
  }

  toJSON(): ModuleJSON {
    return {
      type: SpawnBurst.type,
      id: this.id,
      bursts: this.bursts.map((b) => ({ ...b })),
    };
  }

  static fromJSON(data: ModuleJSON): SpawnBurst {
    return new SpawnBurst({
      bursts: (data["bursts"] as SpawnBurstEntry[]) ?? [],
      id: data.id,
    });
  }
}

registerModule(SpawnBurst);
