import type { Emitter } from "../../emitter.js";
import type { EmitterContext, EmitterSpawnModule, ModuleJSON } from "../module.js";
import { registerModule } from "../registry.js";

export interface SpawnFromEventsParams {
  /** The emitter whose events drive spawns. Must be constructed before this listener. */
  source: Emitter;
  /** Particles to emit per source event. Default 1. */
  perEvent?: number;
  /**
   * CPU-side upper bound on events per frame. Determines dispatch size each tick.
   * Excess threads exit early in the shader via the event counter. Default 64.
   */
  maxEventsPerFrame?: number;
  /** If true, new particles inherit the event's velocity (requires source to emit velocity events). */
  inheritVelocity?: boolean;
  id?: string;
}

/**
 * Spawns particles in response to events fired by another emitter (e.g. particle deaths).
 *
 * Pairs with an Emitter that has `events: { onDeath: true }`. Each frame, this module
 * requests `maxEventsPerFrame × perEvent` spawn slots. The Emitter's spawn kernel then reads
 * the source's event buffer to initialize each new particle's position (and optionally velocity).
 */
export class SpawnFromEvents implements EmitterSpawnModule {
  static readonly type = "spawn.from_events";
  readonly kind = "emitter_spawn" as const;
  readonly type = SpawnFromEvents.type;
  readonly id?: string;
  readonly source: Emitter;
  readonly perEvent: number;
  readonly maxEventsPerFrame: number;
  readonly inheritVelocity: boolean;

  constructor(params: SpawnFromEventsParams) {
    this.source = params.source;
    this.perEvent = params.perEvent ?? 1;
    this.maxEventsPerFrame = params.maxEventsPerFrame ?? 64;
    this.inheritVelocity = params.inheritVelocity ?? false;
    this.id = params.id;
  }

  requestSpawn(_ctx: EmitterContext): number {
    // CPU-side upper bound. Excess threads exit in the shader if event count is lower.
    return this.maxEventsPerFrame * this.perEvent;
  }

  toJSON(): ModuleJSON {
    // `source` is an Emitter reference — not serialized; caller must re-wire after deserialize.
    return {
      type: SpawnFromEvents.type,
      id: this.id,
      perEvent: this.perEvent,
      maxEventsPerFrame: this.maxEventsPerFrame,
      inheritVelocity: this.inheritVelocity,
    };
  }

  static fromJSON(_data: ModuleJSON): SpawnFromEvents {
    throw new Error(
      "SpawnFromEvents cannot be deserialized without a source Emitter reference. Construct manually.",
    );
  }
}

registerModule(SpawnFromEvents);
