import { texture, vec2, vec4 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { Curve1D } from "../../math/curve.js";
import { registerModule } from "../registry.js";

export interface AlphaOverLifeParams {
  curve: Curve1D;
  id?: string;
}

/** color.a = initialColor.a * curve(age/lifetime); rgb preserved. */
export class AlphaOverLife implements ParticleUpdateModule {
  static readonly type = "update.alpha_over_life";
  readonly kind = "particle_update" as const;
  readonly type = AlphaOverLife.type;
  readonly id?: string;
  curve: Curve1D;

  constructor(params: AlphaOverLifeParams) {
    this.curve = params.curve;
    this.id = params.id;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const current = ctx.storage.color.element(ctx.i);
    const initial = ctx.storage.initialColor.element(ctx.i);
    ctx.storage.color
      .element(ctx.i)
      .assign(vec4(current.rgb, initial.a.mul(curveValue)));
  }

  toJSON(): ModuleJSON {
    return { type: AlphaOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }

  static fromJSON(data: ModuleJSON): AlphaOverLife {
    return new AlphaOverLife({
      curve: Curve1D.fromJSON(data["curve"] as { keyframes: Curve1D["keyframes"] }),
      id: data.id,
    });
  }
}

registerModule(AlphaOverLife);
