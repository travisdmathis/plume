import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { mx_noise_vec3, uniform, vec3 } from "three/tsl";
import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface CurlNoiseForceParams {
  /** Peak force magnitude (world units / s²). */
  amplitude: number;
  /** Spatial frequency of the underlying noise field (higher = tighter swirls). */
  frequency: number;
  /** Rate at which the noise field drifts through time. Default 0.5. */
  speed?: number;
  id?: string;
}

/**
 * Divergence-free swirl force. Samples three decorrelated `mx_noise_vec3` fields as a
 * vector potential `ψ` and returns `curl(ψ) = ∇ × ψ`. Curl of any smooth vector field is
 * divergence-free, so particles don't clump into sinks/sources — they endlessly swirl. This
 * is the standard "curl noise" force used for smoke, fluid, magic effects.
 *
 * Compared to `TurbulenceForce` (independent per-axis noise = has divergence → clumping),
 * this produces visibly more organic, fluid-like motion.
 */
export class CurlNoiseForce implements ParticleUpdateModule {
  static readonly type = "update.curl_noise_force";
  readonly kind = "particle_update" as const;
  readonly type = CurlNoiseForce.type;
  readonly id?: string;
  amplitude: number;
  frequency: number;
  speed: number;

  private _uAmp: UniformNode<"float", number>;
  private _uFreq: UniformNode<"float", number>;
  private _uSpeed: UniformNode<"float", number>;

  constructor(params: CurlNoiseForceParams) {
    this.amplitude = params.amplitude;
    this.frequency = params.frequency;
    this.speed = params.speed ?? 0.5;
    this.id = params.id;
    this._uAmp = uniform(this.amplitude) as UniformNode<"float", number>;
    this._uFreq = uniform(this.frequency) as UniformNode<"float", number>;
    this._uSpeed = uniform(this.speed) as UniformNode<"float", number>;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    // Decorrelation offsets for the three potential fields. Must be large enough that the
    // three noise samples are effectively independent at a given `p`.
    const OFF_Y = vec3(31.416, 47.853, 53.089);
    const OFF_Z = vec3(83.517, 71.239, 19.841);
    const H = 0.01; // finite-difference epsilon (world-space units, pre-frequency)

    const pos = attr.position.read(ctx.storage, ctx.i);
    const t = ctx.emitterTime.mul(this._uSpeed);
    const p = pos.mul(this._uFreq).add(vec3(t, t, t));

    // Three vector potentials at `p`. Each field is a vec3 noise sampled at an offset input
    // so they're effectively decorrelated.
    const px = p;
    const py = p.add(OFF_Y);
    const pz = p.add(OFF_Z);

    // Central-difference partial derivatives of the z-component of field-x (∂ψx.z/∂y) etc.
    // We only need the components required for the curl formula, which keeps the sample count
    // at 6 noise evaluations (vs 9 for a full Jacobian).
    const hx = vec3(H, 0, 0);
    const hy = vec3(0, H, 0);
    const hz = vec3(0, 0, H);
    const invH2 = 1.0 / (2.0 * H);

    // ∂ψz/∂y and ∂ψy/∂z
    const dPz_dy = mx_noise_vec3(pz.add(hy))
      .sub(mx_noise_vec3(pz.sub(hy)))
      .mul(invH2);
    const dPy_dz = mx_noise_vec3(py.add(hz))
      .sub(mx_noise_vec3(py.sub(hz)))
      .mul(invH2);
    // ∂ψx/∂z and ∂ψz/∂x
    const dPx_dz = mx_noise_vec3(px.add(hz))
      .sub(mx_noise_vec3(px.sub(hz)))
      .mul(invH2);
    const dPz_dx = mx_noise_vec3(pz.add(hx))
      .sub(mx_noise_vec3(pz.sub(hx)))
      .mul(invH2);
    // ∂ψy/∂x and ∂ψx/∂y
    const dPy_dx = mx_noise_vec3(py.add(hx))
      .sub(mx_noise_vec3(py.sub(hx)))
      .mul(invH2);
    const dPx_dy = mx_noise_vec3(px.add(hy))
      .sub(mx_noise_vec3(px.sub(hy)))
      .mul(invH2);

    // curl = (∂ψz.y/∂y - ∂ψy.z/∂z, ∂ψx.z/∂z - ∂ψz.x/∂x, ∂ψy.x/∂x - ∂ψx.y/∂y)
    // Using x/y/z components of each partial so the result is a single vec3.
    const curl = vec3(dPz_dy.y.sub(dPy_dz.z), dPx_dz.z.sub(dPz_dx.x), dPy_dx.x.sub(dPx_dy.y));

    const force = curl.mul(this._uAmp);
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    attr.velocity.write(ctx.storage, ctx.i, vel.add(force.mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return {
      type: CurlNoiseForce.type,
      id: this.id,
      amplitude: this.amplitude,
      frequency: this.frequency,
      speed: this.speed,
    };
  }

  static fromJSON(data: ModuleJSON): CurlNoiseForce {
    return new CurlNoiseForce({
      amplitude: Number(data["amplitude"] ?? 0),
      frequency: Number(data["frequency"] ?? 1),
      speed: data["speed"] as number | undefined,
      id: data.id,
    });
  }
}

registerModule(CurlNoiseForce);
