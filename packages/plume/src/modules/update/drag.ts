import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { uniform } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface DragParams {
  coefficient: number;
  id?: string;
}

/** Exponential velocity decay: v *= exp(-coefficient * dt). */
export class Drag implements ParticleUpdateModule {
  static readonly type = "update.drag";
  readonly kind = "particle_update" as const;
  readonly type = Drag.type;
  readonly id?: string;
  coefficient: number;
  private _uCoef: UniformNode<"float", number>;

  constructor(params: DragParams) {
    this.coefficient = params.coefficient;
    this.id = params.id;
    this._uCoef = uniform(this.coefficient) as UniformNode<"float", number>;
  }

  setCoefficient(c: number): void {
    this.coefficient = c;
    this._uCoef.value = c;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const factor = this._uCoef.mul(ctx.dt).negate().exp();
    attr.velocity.write(ctx.storage, ctx.i, vel.mul(factor));
  }

  toJSON(): ModuleJSON {
    return { type: Drag.type, id: this.id, coefficient: this.coefficient };
  }

  static fromJSON(data: ModuleJSON): Drag {
    return new Drag({ coefficient: Number(data["coefficient"] ?? 0), id: data.id });
  }
}

registerModule(Drag);
