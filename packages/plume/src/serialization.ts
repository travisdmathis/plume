import type { EmitterDef } from "./emitter.js";
import type { SystemDef } from "./system.js";
import type {
  EmitterSpawnModule,
  ModuleJSON,
  ParticleSpawnModule,
  ParticleUpdateModule,
  RenderModule,
} from "./modules/module.js";
import { moduleFromJSON } from "./modules/registry.js";

/** Versioned top-level system blob. */
export interface SystemJSON {
  /** Format version. Bumped on breaking changes. */
  version: 1;
  name?: string;
  duration?: number;
  loop?: boolean;
  emitters: EmitterJSON[];
}

export interface EmitterJSON {
  name?: string;
  capacity: number;
  seed?: number;
  duration?: number;
  loop?: boolean;
  spawn: ModuleJSON[];
  init: ModuleJSON[];
  update: ModuleJSON[];
  render: ModuleJSON;
}

/** Serialize a System *definition* — operates on SystemDef, not a live System instance. */
export function systemDefToJSON(def: SystemDef): SystemJSON {
  return {
    version: 1,
    name: def.name,
    duration: def.duration,
    loop: def.loop,
    emitters: def.emitters.map(emitterDefToJSON),
  };
}

export function emitterDefToJSON(def: EmitterDef): EmitterJSON {
  return {
    name: def.name,
    capacity: def.capacity,
    seed: def.seed,
    duration: def.duration,
    loop: def.loop,
    spawn: def.spawn.map((m) => m.toJSON()),
    init: def.init.map((m) => m.toJSON()),
    update: def.update.map((m) => m.toJSON()),
    render: def.render.toJSON(),
  };
}

/** Deserialize into a SystemDef (module instances are rebuilt via the registry). */
export function systemDefFromJSON(json: SystemJSON): SystemDef {
  if (json.version !== 1) {
    throw new Error(`plume: unsupported system JSON version ${json.version}`);
  }
  return {
    name: json.name,
    duration: json.duration,
    loop: json.loop,
    emitters: json.emitters.map(emitterDefFromJSON),
  };
}

export function emitterDefFromJSON(json: EmitterJSON): EmitterDef {
  return {
    name: json.name,
    capacity: json.capacity,
    seed: json.seed,
    duration: json.duration,
    loop: json.loop,
    spawn: json.spawn.map((m) => moduleFromJSON(m) as EmitterSpawnModule),
    init: json.init.map((m) => moduleFromJSON(m) as ParticleSpawnModule),
    update: json.update.map((m) => moduleFromJSON(m) as ParticleUpdateModule),
    render: moduleFromJSON(json.render) as RenderModule,
  };
}
