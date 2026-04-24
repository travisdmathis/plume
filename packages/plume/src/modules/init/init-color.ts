import { vec4 } from "three/tsl";
import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { colorInputRgbTSL, scalarInputTSL } from "../../math/tsl-sample.js";
import type { ColorInput, ScalarInput } from "../../types.js";
import { registerModule } from "../registry.js";

export interface InitColorParams {
  color: ColorInput;
  alpha?: ScalarInput;
  id?: string;
}

export class InitColor implements ParticleSpawnModule {
  static readonly type = "init.color";
  readonly kind = "particle_spawn" as const;
  readonly type = InitColor.type;
  readonly id?: string;
  color: ColorInput;
  alpha: ScalarInput;

  constructor(params: InitColorParams) {
    this.color = params.color;
    this.alpha = params.alpha ?? { kind: "constant", value: 1 };
    this.id = params.id;
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const rgb = colorInputRgbTSL(this.color, ctx.seed, 50);
    const alpha = scalarInputTSL(this.alpha, ctx.seed, 60);
    ctx.storage.color.element(ctx.slot).assign(vec4(rgb, alpha));
  }

  toJSON(): ModuleJSON {
    return {
      type: InitColor.type,
      id: this.id,
      color: this.color,
      alpha: this.alpha,
    };
  }

  static fromJSON(data: ModuleJSON): InitColor {
    return new InitColor({
      color: data["color"] as ColorInput,
      alpha: data["alpha"] as ScalarInput | undefined,
      id: data.id,
    });
  }
}

registerModule(InitColor);
