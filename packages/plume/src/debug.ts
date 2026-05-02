/**
 * Shader dump / debug helpers.
 *
 * Three.js exposes `renderer.debug.getShaderAsync(scene, camera, object)` for render
 * pipelines. For compute pipelines it doesn't have a public getter — but the generated
 * WGSL is cached on `renderer._nodes.getForCompute(kernel).computeShader` after first
 * dispatch (which is what three's own backend reads from). We surface both behind a
 * single `dumpShaders()` entry point.
 *
 * Usage:
 * ```ts
 * const dump = await dumpShaders(renderer, system, { camera });
 * console.log(dump.markdown());
 * // or download it:
 * new Blob([dump.markdown()], { type: "text/markdown" });
 * ```
 */

import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";

import type { Emitter } from "./emitter.js";
import type { System } from "./system.js";

export interface EmitterShaderDump {
  /** Emitter name (or `"<anon>"`). */
  name: string;
  /** Generated WGSL for the spawn compute kernel. */
  spawn: string | null;
  /** Generated WGSL for the update compute kernel. */
  update: string | null;
  /** Generated WGSL for the sort-key compute kernel. Only present when `sortByDepth`. */
  sort: string | null;
  /** Generated WGSL for the event-reset compute kernel. Only present when `events.onDeath`. */
  resetEvents: string | null;
  /** Render pipeline vertex + fragment shaders. `null` when no draw object found. */
  render: { vertex: string | null; fragment: string | null } | null;
}

export interface ShaderDump {
  emitters: EmitterShaderDump[];
  /** Pretty-printed markdown — good for console.log, saving to file, or displaying in UI. */
  markdown(): string;
}

export interface DumpOptions {
  /** Camera passed to `renderer.debug.getShaderAsync`. Required for render shaders. */
  camera?: THREE.Camera;
  /** Scene containing the emitter's render meshes. Defaults to a fresh scene holding the emitter. */
  scene?: THREE.Scene;
}

/**
 * Extract every shader associated with a `System` or a single `Emitter`. Kernels must have
 * been dispatched at least once (via `Emitter.warmup()` or a normal frame) before their
 * WGSL is cached — call `Manager.warmup()` first for reliable output.
 */
export async function dumpShaders(
  renderer: WebGPURenderer,
  target: System | Emitter,
  options: DumpOptions = {},
): Promise<ShaderDump> {
  const emitters: Emitter[] = "emitters" in target ? target.emitters : [target];
  const perEmitter = await Promise.all(emitters.map((em) => dumpEmitter(renderer, em, options)));
  return {
    emitters: perEmitter,
    markdown: () => formatMarkdown(perEmitter),
  };
}

async function dumpEmitter(
  renderer: WebGPURenderer,
  em: Emitter,
  options: DumpOptions,
): Promise<EmitterShaderDump> {
  const name = em.name ?? "<anon>";

  // Internal access — three.js exposes compute-shader retrieval via `renderer._nodes.getForCompute`,
  // the same hook it uses itself to look up cached WGSL. Still works today, version-gated to 0.184.
  const nodes = (
    renderer as unknown as {
      _nodes?: { getForCompute: (n: ComputeNode) => { computeShader?: string } };
    }
  )._nodes;

  const kernelShader = (kernel: ComputeNode | undefined): string | null => {
    if (!kernel || !nodes) return null;
    try {
      return nodes.getForCompute(kernel).computeShader ?? null;
    } catch {
      return null;
    }
  };

  const internals = em as unknown as {
    _spawnKernel: ComputeNode;
    _updateKernel: ComputeNode;
    _sortKeyKernel?: ComputeNode;
    _resetEventKernel?: ComputeNode;
  };

  const spawn = kernelShader(internals._spawnKernel);
  const update = kernelShader(internals._updateKernel);
  const sort = kernelShader(internals._sortKeyKernel);
  const resetEvents = kernelShader(internals._resetEventKernel);

  // Render shaders: need a scene + camera + object. Find the first actual Mesh in the render
  // module's object3D tree (the InstancedMesh instance; our renderers wrap it in a Group).
  let render: EmitterShaderDump["render"] = null;
  if (options.camera) {
    let mesh: THREE.Object3D | null = null;
    em.render.object3D.traverse((child) => {
      if (!mesh && (child as THREE.Mesh).isMesh) mesh = child;
    });
    if (mesh) {
      const scene = options.scene ?? makeTempScene(em.render.object3D);
      try {
        const result = await renderer.debug.getShaderAsync(scene, options.camera, mesh);
        render = { vertex: result.vertexShader, fragment: result.fragmentShader };
      } catch (err) {
        render = { vertex: null, fragment: null };
        console.warn(`plume: getShaderAsync failed for "${name}":`, err);
      }
    }
  }

  return { name, spawn, update, sort, resetEvents, render };
}

function makeTempScene(obj: THREE.Object3D): THREE.Scene {
  // The object may already be parented — we DON'T reparent it (that would yank it from the
  // live scene). Instead, we walk up to find the scene it's in, or fall back to a one-off.
  let cursor: THREE.Object3D | null = obj;
  while (cursor) {
    if ((cursor as THREE.Scene).isScene) return cursor as THREE.Scene;
    cursor = cursor.parent;
  }
  // No scene found — object isn't attached. Build a throwaway one so getShaderAsync has something.
  const scene = new THREE.Scene();
  scene.add(obj);
  return scene;
}

function formatMarkdown(emitters: EmitterShaderDump[]): string {
  const lines: string[] = [];
  lines.push(`# Plume shader dump — ${emitters.length} emitter${emitters.length === 1 ? "" : "s"}`);
  lines.push("");
  for (const e of emitters) {
    lines.push(`## Emitter: \`${e.name}\``);
    lines.push("");
    section(lines, "Spawn kernel (WGSL)", e.spawn);
    section(lines, "Update kernel (WGSL)", e.update);
    section(lines, "Sort-key kernel (WGSL)", e.sort);
    section(lines, "Reset-events kernel (WGSL)", e.resetEvents);
    if (e.render) {
      section(lines, "Render — vertex shader", e.render.vertex);
      section(lines, "Render — fragment shader", e.render.fragment);
    } else {
      lines.push("_No render shader available (pass `camera` to `dumpShaders` to include it)._");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function section(lines: string[], heading: string, body: string | null): void {
  if (body === null) return;
  lines.push(`### ${heading}`);
  lines.push("");
  lines.push("```wgsl");
  lines.push(body.trim());
  lines.push("```");
  lines.push("");
}
