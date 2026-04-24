import { texture, vec2 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { Curve1D } from "../../math/curve.js";
import { registerModule } from "../registry.js";

export interface VelocityOverLifeParams {
  curve: Curve1D;
  id?: string;
}

/** velocity = initialVelocity * curve(age/lifetime). Place before forces that add to velocity. */
export class VelocityOverLife implements ParticleUpdateModule {
  static readonly type = "update.velocity_over_life";
  readonly kind = "particle_update" as const;
  readonly type = VelocityOverLife.type;
  readonly id?: string;
  curve: Curve1D;

  constructor(params: VelocityOverLifeParams) {
    this.curve = params.curve;
    this.id = params.id;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const initial = attr.initialVelocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, initial.mul(curveValue));
  }

  toJSON(): ModuleJSON {
    return { type: VelocityOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }

  static fromJSON(data: ModuleJSON): VelocityOverLife {
    return new VelocityOverLife({
      curve: Curve1D.fromJSON(data["curve"] as { keyframes: Curve1D["keyframes"] }),
      id: data.id,
    });
  }
}

registerModule(VelocityOverLife);
