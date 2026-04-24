import { texture, vec2 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { Gradient } from "../../math/gradient.js";
import { registerModule } from "../registry.js";

export interface ColorOverLifeParams {
  gradient: Gradient;
  id?: string;
}

/** Modulates particle color: color = initialColor * gradient(age/lifetime). */
export class ColorOverLife implements ParticleUpdateModule {
  static readonly type = "update.color_over_life";
  readonly kind = "particle_update" as const;
  readonly type = ColorOverLife.type;
  readonly id?: string;
  gradient: Gradient;

  constructor(params: ColorOverLifeParams) {
    this.gradient = params.gradient;
    this.id = params.id;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const tex = this.gradient.getTexture();
    const texNode = texture(tex);
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const gradRgba = texNode.sample(vec2(t, 0.5));
    const initial = ctx.storage.initialColor.element(ctx.i);
    ctx.storage.color.element(ctx.i).assign(initial.mul(gradRgba));
  }

  toJSON(): ModuleJSON {
    return { type: ColorOverLife.type, id: this.id, gradient: this.gradient.toJSON() };
  }

  static fromJSON(data: ModuleJSON): ColorOverLife {
    return new ColorOverLife({
      gradient: Gradient.fromJSON(data["gradient"] as { stops: Gradient["stops"] }),
      id: data.id,
    });
  }
}

registerModule(ColorOverLife);
