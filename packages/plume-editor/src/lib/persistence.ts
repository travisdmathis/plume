/**
 * Graph serialization + persistence.
 *
 * Round-trips the editor's current graph (nodes + edges) through JSON. Used for
 * `localStorage` autosave/restore and for the manual Save/Load buttons in the
 * header. Format is versioned so we can migrate later without trashing existing
 * user work.
 *
 * Only data essential to rebuilding the graph is preserved: node id / type /
 * position / params, edge id / source / target. Visual styling (accent stripes,
 * edge stroke colour) is re-derived on load from the spec catalog.
 */

import type { Edge } from "@xyflow/svelte";
import { getSpec, type Params } from "./builder/nodes.js";
import type { PlumeNode } from "./graph/graphStore.svelte.js";

export const STORAGE_KEY = "plume-editor:graph-v1";
const FORMAT_VERSION = 1;

export interface SerializedGraph {
  version: number;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    params: Params;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export function serialize(nodes: PlumeNode[], edges: Edge[]): SerializedGraph {
  return {
    version: FORMAT_VERSION,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      position: { x: n.position.x, y: n.position.y },
      params: n.data.params,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** Parse and validate a saved graph. Throws on malformed input — the caller is
 *  expected to surface the message to the user. */
export function deserialize(raw: unknown): { nodes: PlumeNode[]; edges: Edge[] } {
  if (!raw || typeof raw !== "object") throw new Error("Not a graph file.");
  const obj = raw as Partial<SerializedGraph>;
  if (obj.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported graph version ${obj.version} (expected ${FORMAT_VERSION}).`);
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error("Graph missing nodes/edges arrays.");
  }

  const nodes: PlumeNode[] = obj.nodes.map((raw, idx) => {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      typeof raw.type !== "string" ||
      !raw.position ||
      typeof raw.position.x !== "number" ||
      typeof raw.position.y !== "number"
    ) {
      throw new Error(`Node #${idx} is malformed.`);
    }
    // Cross-check with the spec catalog so we fail loudly if a stale graph
    // references a removed module type.
    getSpec(raw.type);
    return {
      id: raw.id,
      type: "plume",
      position: { x: raw.position.x, y: raw.position.y },
      data: {
        type: raw.type,
        params: (raw.params ?? {}) as Params,
      },
    };
  });

  const edges: Edge[] = obj.edges.map((raw, idx) => {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      typeof raw.source !== "string" ||
      typeof raw.target !== "string"
    ) {
      throw new Error(`Edge #${idx} is malformed.`);
    }
    return {
      id: raw.id,
      source: raw.source,
      target: raw.target,
      style: "stroke:#3a72ad;stroke-width:1.5;",
    };
  });

  return { nodes, edges };
}

// ─ localStorage helpers ────────────────────────────────────────────────────

export function loadFromStorage(): { nodes: PlumeNode[]; edges: Edge[] } | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return undefined;
  try {
    return deserialize(JSON.parse(json));
  } catch (err) {
    console.warn("[plume-editor] failed to restore graph from localStorage:", err);
    return undefined;
  }
}

export function saveToStorage(nodes: PlumeNode[], edges: Edge[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(nodes, edges)));
  } catch (err) {
    // Quota errors are the realistic failure; log but don't break the editor.
    console.warn("[plume-editor] autosave failed:", err);
  }
}

export function clearStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ─ File download / upload ──────────────────────────────────────────────────

/** Trigger a download of the serialized graph as a JSON file. */
export function downloadGraph(
  nodes: PlumeNode[],
  edges: Edge[],
  filename = "plume-graph.json",
): void {
  const json = JSON.stringify(serialize(nodes, edges), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Open a file picker and resolve with the parsed graph. Resolves undefined if
 *  the user cancels. */
export function pickGraphFile(): Promise<{ nodes: PlumeNode[]; edges: Edge[] } | undefined> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) {
        resolve(undefined);
        return;
      }
      try {
        const text = await file.text();
        resolve(deserialize(JSON.parse(text)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    input.click();
  });
}
