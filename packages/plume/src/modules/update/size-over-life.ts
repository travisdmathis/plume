import { texture, vec2 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { Curve1D } from "../../math/curve.js";
import { registerModule } from "../registry.js";

export interface SizeOverLifeParams {
  curve: Curve1D;
  id?: string;
}

/** size = initialSize * curve(age/lifetime) */
export class SizeOverLife implements ParticleUpdateModule {
  static readonly type = "update.size_over_life";
  readonly kind = "particle_update" as const;
  readonly type = SizeOverLife.type;
  readonly id?: string;
  curve: Curve1D;

  constructor(params: SizeOverLifeParams) {
    this.curve = params.curve;
    this.id = params.id;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const texNode = texture(this.curve.getTexture());
    const age = attr.age.read(ctx.storage, ctx.i);
    const life = attr.lifetime.read(ctx.storage, ctx.i);
    const t = age.div(life).clamp(0, 1);
    const curveValue = texNode.sample(vec2(t, 0.5)).r;
    const initial = attr.initialSize.read(ctx.storage, ctx.i);
    attr.size.write(ctx.storage, ctx.i, initial.mul(curveValue));
  }

  toJSON(): ModuleJSON {
    return { type: SizeOverLife.type, id: this.id, curve: this.curve.toJSON() };
  }

  static fromJSON(data: ModuleJSON): SizeOverLife {
    return new SizeOverLife({
      curve: Curve1D.fromJSON(data["curve"] as { keyframes: Curve1D["keyframes"] }),
      id: data.id,
    });
  }
}

registerModule(SizeOverLife);
