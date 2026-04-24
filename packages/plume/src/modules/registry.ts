import type { Module, ModuleFactory, ModuleJSON } from "./module.js";

const factories = new Map<string, ModuleFactory>();

/** Register a module factory (module class with static `type` + `fromJSON`). */
export function registerModule(factory: ModuleFactory): void {
  factories.set(factory.type, factory);
}

export function unregisterModule(type: string): void {
  factories.delete(type);
}

export function getModuleFactory(type: string): ModuleFactory | undefined {
  return factories.get(type);
}

export function listRegisteredModules(): string[] {
  return [...factories.keys()].sort();
}

export function moduleFromJSON(data: ModuleJSON): Module {
  const factory = factories.get(data.type);
  if (!factory) {
    throw new Error(
      `plume: unknown module type "${data.type}". Known: ${[...factories.keys()].join(", ")}`,
    );
  }
  return factory.fromJSON(data);
}
