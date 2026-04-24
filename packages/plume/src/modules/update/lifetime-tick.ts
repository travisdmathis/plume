import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { registerModule } from "../registry.js";

/**
 * Deprecated — the Emitter now runs the age+kill step internally before any user update
 * module executes. This class is kept as a no-op for backward JSON compatibility so old
 * presets that included "update.lifetime_tick" don't fail to deserialize.
 */
export class LifetimeTick implements ParticleUpdateModule {
  static readonly type = "update.lifetime_tick";
  readonly kind = "particle_update" as const;
  readonly type = LifetimeTick.type;
  readonly id?: string;

  constructor(params: { id?: string } = {}) {
    this.id = params.id;
  }

  contributeUpdateTSL(_ctx: UpdateContext): void {
    // Emitter handles age + kill implicitly; nothing to contribute.
  }

  toJSON(): ModuleJSON {
    return { type: LifetimeTick.type, id: this.id };
  }

  static fromJSON(data: ModuleJSON): LifetimeTick {
    return new LifetimeTick({ id: data.id });
  }
}

registerModule(LifetimeTick);
