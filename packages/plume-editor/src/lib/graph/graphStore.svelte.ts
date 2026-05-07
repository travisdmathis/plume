/**
 * Shared graph state — nodes, edges, and the currently-selected node id.
 *
 * Lives outside any single component so the palette (which adds nodes), the canvas
 * (which renders / mutates them via xyflow), the inspector (which edits the selected
 * node's params), and the preview pane (which compiles them) can all touch the same
 * source of truth. Backed by Svelte 5 runes.
 */

import type { Node, Edge } from "@xyflow/svelte";
import { getSpec, type Params, type Category } from "../builder/nodes.js";
import { loadFromStorage, saveToStorage, clearStorage } from "../persistence.js";

// `unreachableIds` is computed once on each access by walking every emitter via
// BFS. We export it as a function (not a rune) so callers explicitly track only
// what they consume — the set rebuilds whenever the underlying nodes/edges
// signals fire because the function reads them.
export function unreachableIds(): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const reachable = new Set<string>();
  for (const n of nodes) {
    if (getSpec(n.data.type).category !== "emitter") continue;
    const stack = [n.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const nxt of adj.get(id) ?? []) if (!reachable.has(nxt)) stack.push(nxt);
    }
  }
  const out = new Set<string>();
  for (const n of nodes) if (!reachable.has(n.id)) out.add(n.id);
  return out;
}

/** Concrete `data` payload xyflow carries for each plume node. */
export interface PlumeNodeData extends Record<string, unknown> {
  /** Node spec id, e.g. `"init.position"`. */
  type: string;
  /** Editable per-instance parameters (deep-cloned from spec defaults at create time). */
  params: Params;
}

export type PlumeNode = Node<PlumeNodeData>;

/**
 * `nodes` / `edges` are held in `$state.raw` to silence xyflow's
 * "warnIfDeeplyReactive" warning: with deep proxies, every internal xyflow nudge
 * (drag tick, resize) routes through Svelte's reactivity layer and slows things
 * down. We always replace the array (filter / map / spread) on mutation, so
 * reassignment-only tracking is enough.
 */

let nextId = 1;
function makeId(type: string): string {
  return `${type.replace(/\./g, "_")}_${nextId++}`;
}

/** Deep clone of the spec defaults so each node mutates its own copy. */
function cloneDefaults(defaults: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (Array.isArray(v)) {
      out[k] = [...v] as Params[string];
    } else if (v && typeof v === "object") {
      out[k] = { ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Each category gets its own X column so the canvas auto-organizes left→right
// as a pipeline. New nodes find the next free Y slot inside their column rather
// than stacking on top of existing nodes.
const COLUMN_X: Record<Category, number> = {
  emitter: 80,
  spawn: 320,
  init: 560,
  update: 800,
  render: 1040,
};
const ROW_STEP = 110;
const ROW_BASE = 40;

function nextSlotForCategory(category: Category, existing: PlumeNode[]): { x: number; y: number } {
  const x = COLUMN_X[category];
  const taken = new Set(
    existing.filter((n) => Math.abs(n.position.x - x) < 80).map((n) => n.position.y),
  );
  for (let row = 0; row < 32; row++) {
    const y = ROW_BASE + row * ROW_STEP;
    if (![...taken].some((ty) => Math.abs(ty - y) < 60)) return { x, y };
  }
  return { x, y: ROW_BASE + existing.length * ROW_STEP };
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: `e_${source}__${target}`,
    source,
    target,
    // `interactionWidth` is xyflow's invisible click-target — wider than the
    // visible 1.5px stroke so users can actually grab the edge. (Default is
    // 20px but the cascading style override sometimes overrides it; setting
    // explicitly here keeps every editor edge consistent.)
    interactionWidth: 18,
    style: "stroke:#3a72ad;stroke-width:1.5;",
  };
}

function buildStarterGraph(): { nodes: PlumeNode[]; edges: Edge[] } {
  const nodes: PlumeNode[] = [
    makeNodeAt("emitter", { x: COLUMN_X.emitter, y: 280 }),
    makeNodeAt("spawn.rate", { x: COLUMN_X.spawn, y: 280 }),
    makeNodeAt("init.lifetime", { x: COLUMN_X.init, y: 40 }),
    makeNodeAt("init.position", { x: COLUMN_X.init, y: 150 }),
    makeNodeAt("init.velocity", { x: COLUMN_X.init, y: 260 }),
    makeNodeAt("init.size", { x: COLUMN_X.init, y: 370 }),
    makeNodeAt("init.color", { x: COLUMN_X.init, y: 480 }),
    makeNodeAt("update.integrate", { x: COLUMN_X.update, y: 220 }),
    makeNodeAt("update.alpha_over_life", { x: COLUMN_X.update, y: 330 }),
    makeNodeAt("render.sprite", { x: COLUMN_X.render, y: 280 }),
  ];

  // Linear pipeline chain — emitter feeds the first spawn, which feeds the first
  // init, etc. The compiler walks edges via BFS so this chain orders the modules.
  const edges: Edge[] = [
    makeEdge(nodes[0]!.id, nodes[1]!.id), // emitter → spawn.rate
    makeEdge(nodes[1]!.id, nodes[2]!.id), // spawn.rate → init.lifetime
    makeEdge(nodes[2]!.id, nodes[3]!.id),
    makeEdge(nodes[3]!.id, nodes[4]!.id),
    makeEdge(nodes[4]!.id, nodes[5]!.id),
    makeEdge(nodes[5]!.id, nodes[6]!.id),
    makeEdge(nodes[6]!.id, nodes[7]!.id), // init.color → update.integrate
    makeEdge(nodes[7]!.id, nodes[8]!.id),
    makeEdge(nodes[8]!.id, nodes[9]!.id), // update.alpha_over_life → render.sprite
  ];
  return { nodes, edges };
}

function makeNodeAt(type: string, position: { x: number; y: number }): PlumeNode {
  const spec = getSpec(type);
  return {
    id: makeId(type),
    type: "plume",
    position,
    data: { type: spec.type, params: cloneDefaults(spec.defaults) },
  };
}

/** Construct a fresh node from a spec id, dropping it into the next free slot
 *  in its category column. */
export function makeNode(type: string, position?: { x: number; y: number }): PlumeNode {
  const spec = getSpec(type);
  return {
    id: makeId(type),
    type: "plume",
    position: position ?? nextSlotForCategory(spec.category, graphStore.nodes),
    data: { type: spec.type, params: cloneDefaults(spec.defaults) },
  };
}

// Restore from localStorage if present, otherwise drop in the canonical starter
// graph.
const restored = loadFromStorage();
const starter = restored ?? buildStarterGraph();

// Bump nextId past any restored ids so newly-created nodes don't collide with
// loaded ones. Ids look like "init_position_3" — pull the trailing number.
for (const n of starter.nodes) {
  const m = /_(\d+)$/.exec(n.id);
  if (m) nextId = Math.max(nextId, parseInt(m[1]!, 10) + 1);
}

let nodes: PlumeNode[] = $state.raw(starter.nodes);
let edges: Edge[] = $state.raw(starter.edges);
let selectedId: string | undefined = $state(undefined);

export const graphStore = {
  get nodes(): PlumeNode[] {
    return nodes;
  },
  set nodes(v: PlumeNode[]) {
    nodes = v;
  },
  get edges(): Edge[] {
    return edges;
  },
  set edges(v: Edge[]) {
    edges = v;
  },
  get selectedId(): string | undefined {
    return selectedId;
  },
  set selectedId(v: string | undefined) {
    selectedId = v;
  },
};

export function addNode(type: string): void {
  const node = makeNode(type);
  graphStore.nodes = [...graphStore.nodes, node];
  graphStore.selectedId = node.id;
}

export function removeNode(id: string): void {
  graphStore.nodes = graphStore.nodes.filter((n) => n.id !== id);
  // Drop any edge that referenced the removed node, otherwise the compiler walks
  // into a phantom id.
  graphStore.edges = graphStore.edges.filter((e) => e.source !== id && e.target !== id);
  if (graphStore.selectedId === id) graphStore.selectedId = undefined;
}

export function addEdge(source: string, target: string): void {
  if (source === target) return;
  // De-dupe by (source, target) — xyflow may fire duplicate `onConnect` events.
  if (graphStore.edges.some((e) => e.source === source && e.target === target)) return;
  graphStore.edges = [...graphStore.edges, makeEdge(source, target)];
}

export function removeEdge(id: string): void {
  graphStore.edges = graphStore.edges.filter((e) => e.id !== id);
}

/** Remove every edge touching a node, but keep the node itself. Used by the
 *  Inspector's "Disconnect" button so users can quickly isolate a module. */
export function disconnectNode(id: string): void {
  graphStore.edges = graphStore.edges.filter((e) => e.source !== id && e.target !== id);
}

/** Remove only the edges flowing out of (or into) a specific handle.
 *  Right-click on a handle dot uses this to detach a single side. */
export function disconnectHandle(id: string, side: "source" | "target"): void {
  graphStore.edges = graphStore.edges.filter((e) =>
    side === "source" ? e.source !== id : e.target !== id,
  );
}

export function updateNodeParam(id: string, key: string, value: Params[string]): void {
  graphStore.nodes = graphStore.nodes.map((n) =>
    n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n,
  );
}

export function selectNode(id: string | undefined): void {
  graphStore.selectedId = id;
}

/** Wholesale replace the graph (used by Load From File). Bumps `nextId` so newly
 *  created nodes after a load can't collide with restored ids. */
export function replaceGraph(newNodes: PlumeNode[], newEdges: Edge[]): void {
  graphStore.nodes = newNodes;
  graphStore.edges = newEdges;
  graphStore.selectedId = undefined;
  for (const n of newNodes) {
    const m = /_(\d+)$/.exec(n.id);
    if (m) nextId = Math.max(nextId, parseInt(m[1]!, 10) + 1);
  }
}

/** Throw away the current graph and the saved autosave, dropping the user back
 *  to the canonical starter. */
export function resetToStarter(): void {
  clearStorage();
  const fresh = buildStarterGraph();
  graphStore.nodes = fresh.nodes;
  graphStore.edges = fresh.edges;
  graphStore.selectedId = undefined;
}

// ─ Autosave ─────────────────────────────────────────────────────────────────
// Module-level `$effect.root` so we don't depend on a component being mounted.
// Debounced 400ms — well under the 5s mark where users would expect a save.

let saveTimer: ReturnType<typeof setTimeout> | undefined;
$effect.root(() => {
  $effect(() => {
    // Track both arrays.
    const ns = graphStore.nodes;
    const es = graphStore.edges;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToStorage(ns, es), 400);
  });
});
