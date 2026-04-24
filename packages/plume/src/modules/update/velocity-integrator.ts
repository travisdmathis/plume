import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export interface VelocityIntegratorParams {
  id?: string;
}

/** Integrates position by velocity and rotation by angular velocity: pos += vel * dt. */
export class VelocityIntegrator implements ParticleUpdateModule {
  static readonly type = "update.velocity_integrator";
  readonly kind = "particle_update" as const;
  readonly type = VelocityIntegrator.type;
  readonly id?: string;

  constructor(params: VelocityIntegratorParams = {}) {
    this.id = params.id;
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const vel = attr.velocity.read(ctx.storage, ctx.i);
    const pos = attr.position.read(ctx.storage, ctx.i);
    attr.position.write(ctx.storage, ctx.i, pos.add(vel.mul(ctx.dt)));

    const ang = attr.angularVelocity.read(ctx.storage, ctx.i);
    const rot = attr.rotation.read(ctx.storage, ctx.i);
    attr.rotation.write(ctx.storage, ctx.i, rot.add(ang.mul(ctx.dt)));
  }

  toJSON(): ModuleJSON {
    return { type: VelocityIntegrator.type, id: this.id };
  }

  static fromJSON(data: ModuleJSON): VelocityIntegrator {
    return new VelocityIntegrator({ id: data.id });
  }
}

registerModule(VelocityIntegrator);
