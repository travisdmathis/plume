import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { clamp, length, uniform } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface ScaleBySpeedParams {
  /** Speed at or below which the particle renders at `minScale` × its initial size. */
  minSpeed?: number;
  /** Speed at or above which the particle renders at `maxScale` × its initial size. */
  maxSpeed: number;
  /** Multiplier at min speed. Default 1. */
  minScale?: number;
  /** Multiplier at max speed. Default 2. */
  maxScale?: number;
  id?: string;
}

/**
 * Rescales each particle by its instantaneous speed — fast particles stretch, slow ones
 * shrink. Useful for sparks, debris, rain-like effects where velocity should read visually.
 *
 * Acts on `traits.size` (the live-size attribute), preserving `initialSize`. Plays nicely
 * with `SizeOverLife` — this module re-applies after the age-based scale, or vice versa,
 * depending on module order.
 */
export class ScaleBySpeed implements ParticleUpdateModule {
  static readonly type = "update.scale_by_speed";
  readonly kind = "particle_update" as const;
  readonly type = ScaleBySpeed.type;
  readonly id?: string;
  minSpeed: number;
  maxSpeed: number;
  minScale: number;
  maxScale: number;

  private _uMinSpeed: UniformNode<"float", number>;
  private _uMaxSpeed: UniformNode<"float", number>;
  private _uMinScale: UniformNode<"float", number>;
  private _uMaxScale: UniformNode<"float", number>;

  constructor(params: ScaleBySpeedParams) {
    this.minSpeed = params.minSpeed ?? 0;
    this.maxSpeed = params.maxSpeed;
    this.minScale = params.minScale ?? 1;
    this.maxScale = params.maxScale ?? 2;
    this.id = params.id;
    this._uMinSpeed = uniform(this.minSpeed) as UniformNode<"float", number>;
    this._uMaxSpeed = uniform(this.maxSpeed) as UniformNode<"float", number>;
    this._uMinScale = uniform(this.minScale) as UniformNode<"float", number>;
    this._uMaxScale = uniform(this.maxScale) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const speed = length(vel);
    // Linear remap of speed ∈ [minSpeed, maxSpeed] to t ∈ [0, 1], clamped at edges.
    const span = this._uMaxSpeed.sub(this._uMinSpeed).max(0.0001);
    const t = clamp(speed.sub(this._uMinSpeed).div(span), 0, 1);
    const scaleFactor = this._uMinScale.add(this._uMaxScale.sub(this._uMinScale).mul(t));
    const baseSize = attr.initialSize.read(ctx.storage, ctx.i);
    attr.size.write(ctx.storage, ctx.i, baseSize.mul(scaleFactor));
  }

  toJSON(): ModuleJSON {
    return {
      type: ScaleBySpeed.type,
      id: this.id,
      minSpeed: this.minSpeed,
      maxSpeed: this.maxSpeed,
      minScale: this.minScale,
      maxScale: this.maxScale,
    };
  }

  static fromJSON(data: ModuleJSON): ScaleBySpeed {
    return new ScaleBySpeed({
      minSpeed: data["minSpeed"] as number | undefined,
      maxSpeed: Number(data["maxSpeed"] ?? 1),
      minScale: data["minScale"] as number | undefined,
      maxScale: data["maxScale"] as number | undefined,
      id: data.id,
    });
  }
}

registerModule(ScaleBySpeed);
