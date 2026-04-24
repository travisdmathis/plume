import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { mx_fractal_noise_vec3, uniform, vec3 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface TurbulenceForceParams {
  amplitude: number;
  frequency: number;
  speed?: number;
  octaves?: number;
  id?: string;
}

/** Pseudo-random swirl sampled from a 3D noise field. Adds to velocity each frame. */
export class TurbulenceForce implements ParticleUpdateModule {
  static readonly type = "update.turbulence_force";
  readonly kind = "particle_update" as const;
  readonly type = TurbulenceForce.type;
  readonly id?: string;
  amplitude: number;
  frequency: number;
  speed: number;
  octaves: number;

  private _uAmp: UniformNode<"float", number>;
  private _uFreq: UniformNode<"float", number>;
  private _uSpeed: UniformNode<"float", number>;

  constructor(params: TurbulenceForceParams) {
    this.amplitude = params.amplitude;
    this.frequency = params.frequency;
    this.speed = params.speed ?? 0.5;
    this.octaves = params.octaves ?? 1;
    this.id = params.id;
    this._uAmp = uniform(this.amplitude) as UniformNode<"float", number>;
    this._uFreq = uniform(this.frequency) as UniformNode<"float", number>;
    this._uSpeed = uniform(this.speed) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const time = ctx.emitterTime.mul(this._uSpeed);
    // Three decorrelated noise fields at offset input positions → force vector
    const p0 = pos.mul(this._uFreq).add(vec3(time, 0, 0));
    const p1 = pos.mul(this._uFreq).add(vec3(17.1, 13.9, 43.7).add(vec3(0, time, 0)));
    const p2 = pos.mul(this._uFreq).add(vec3(79.3, 53.2, 31.4).add(vec3(0, 0, time)));
    const n0 = mx_fractal_noise_vec3(p0);
    const n1 = mx_fractal_noise_vec3(p1);
    const n2 = mx_fractal_noise_vec3(p2);
    const force = vec3(n0.x, n1.y, n2.z).mul(this._uAmp);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return {
      type: TurbulenceForce.type,
      id: this.id,
      amplitude: this.amplitude,
      frequency: this.frequency,
      speed: this.speed,
      octaves: this.octaves,
    };
  }

  static fromJSON(data: ModuleJSON): TurbulenceForce {
    return new TurbulenceForce({
      amplitude: Number(data["amplitude"] ?? 0),
      frequency: Number(data["frequency"] ?? 1),
      speed: data["speed"] as number | undefined,
      octaves: data["octaves"] as number | undefined,
      id: data.id,
    });
  }
}

registerModule(TurbulenceForce);
