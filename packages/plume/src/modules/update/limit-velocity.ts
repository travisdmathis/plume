import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, length, uniform } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface LimitVelocityParams {
  /** Maximum allowed speed (units/sec). Particles faster than this are rescaled. */
  maxSpeed: number;
  /**
   * How aggressively to apply the limit.
   * - 1 (default): hard clamp — anything above `maxSpeed` is set to exactly `maxSpeed`.
   * - <1: soft damp — excess speed is multiplied by `1 - damping * dt` per frame, easing in.
   */
  damping?: number;
  id?: string;
}

/**
 * Caps the particle speed at `maxSpeed`. With `damping < 1`, excess velocity decays over time
 * instead of snapping — gives a more natural feel for things like wind-buffeted debris.
 */
export class LimitVelocity implements ParticleUpdateModule {
  static readonly type = "update.limit_velocity";
  readonly kind = "particle_update" as const;
  readonly type = LimitVelocity.type;
  readonly id?: string;
  maxSpeed: number;
  damping: number;

  private _uMax: UniformNode<"float", number>;
  private _uDamping: UniformNode<"float", number>;

  constructor(params: LimitVelocityParams) {
    this.maxSpeed = params.maxSpeed;
    this.damping = params.damping ?? 1;
    this.id = params.id;
    this._uMax = uniform(this.maxSpeed) as UniformNode<"float", number>;
    this._uDamping = uniform(this.damping) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const vel = attr.velocity.read(ctx.storage, ctx.i).toVar();
    const speed = length(vel);
    If(speed.greaterThan(this._uMax), () => {
      // Hard-clamp when damping = 1; otherwise lerp current speed toward the cap.
      const targetSpeed = speed.add(this._uMax.sub(speed).mul(this._uDamping));
      const scale = targetSpeed.div(speed);
      attr.velocity.write(ctx.storage, ctx.i, vel.mul(scale));
    });
  }

  toJSON(): ModuleJSON {
    return {
      type: LimitVelocity.type,
      id: this.id,
      maxSpeed: this.maxSpeed,
      damping: this.damping,
    };
  }

  static fromJSON(data: ModuleJSON): LimitVelocity {
    return new LimitVelocity({
      maxSpeed: Number(data["maxSpeed"] ?? 1),
      damping: data["damping"] as number | undefined,
      id: data.id,
    });
  }
}

registerModule(LimitVelocity);
