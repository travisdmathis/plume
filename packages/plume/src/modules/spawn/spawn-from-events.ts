import type { Emitter } from "../../emitter.js";
import type { EmitterContext, EmitterSpawnModule, ModuleJSON } from "../module.js";
import { registerModule } from "../registry.js";

export interface SpawnFromEventsParams {
  /**
   * The emitter whose events drive spawns. Either a built `Emitter` instance
   * (must already exist when this module is constructed) or the string `name`
   * of an emitter defined elsewhere in the same `SystemDef` — the System
   * constructor resolves the name to the actual instance after every emitter
   * has been created.
   */
  source: Emitter | string;
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
  /** Resolved at construction time when an `Emitter` instance is passed, or
   *  filled in by `System` after construction when only a name was given. */
  source!: Emitter;
  /** When `source` was given as a string, this is the deferred name kept
   *  around for the System to resolve. Cleared once resolved. */
  pendingSourceName?: string;
  readonly perEvent: number;
  readonly maxEventsPerFrame: number;
  readonly inheritVelocity: boolean;

  constructor(params: SpawnFromEventsParams) {
    if (typeof params.source === "string") {
      this.pendingSourceName = params.source;
    } else {
      this.source = params.source;
    }
    this.perEvent = params.perEvent ?? 1;
    this.maxEventsPerFrame = params.maxEventsPerFrame ?? 64;
    this.inheritVelocity = params.inheritVelocity ?? false;
    this.id = params.id;
  }

  /** Called by `System` once every emitter is constructed. Looks up the
   *  source by name and finishes wiring this module. */
  resolveSource(emitters: Emitter[]): void {
    if (!this.pendingSourceName) return;
    const found = emitters.find((em) => em.name === this.pendingSourceName);
    if (!found) {
      throw new Error(
        `SpawnFromEvents: no emitter named "${this.pendingSourceName}" in this System.`,
      );
    }
    this.source = found;
    this.pendingSourceName = undefined;
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
