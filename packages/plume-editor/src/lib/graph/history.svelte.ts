/**
 * Undo / redo for graph mutations.
 *
 * On every change to `graphStore.nodes` or `graphStore.edges` we push a snapshot
 * of `(nodes, edges)` onto an undo stack (debounced so a single drag doesn't
 * fill the stack). Cmd/Ctrl-Z pops a snapshot and restores it; Cmd/Ctrl-Shift-Z
 * (or Ctrl-Y) replays a popped snapshot.
 *
 * Snapshots are shallow-array copies of the same node / edge objects already in
 * the store — those are themselves replaced on mutation (we never mutate in
 * place), so there's no risk of a snapshot leaking later edits.
 */

import type { Edge } from "@xyflow/svelte";
import { graphStore, type PlumeNode } from "./graphStore.svelte.js";

interface Snapshot {
  nodes: PlumeNode[];
  edges: Edge[];
}

const past: Snapshot[] = [];
const future: Snapshot[] = [];
const MAX_DEPTH = 80;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let suspended = false;

/** Take a synchronous snapshot of the current graph and push it into the
 *  history. Future stack is cleared (a fresh edit invalidates redo). */
function snapshot(): void {
  past.push({ nodes: graphStore.nodes, edges: graphStore.edges });
  if (past.length > MAX_DEPTH) past.shift();
  future.length = 0;
}

/** Debounced snapshot — multiple rapid edits (e.g. dragging a slider) collapse
 *  into a single undo step. */
function scheduleSnapshot(): void {
  if (suspended) return;
  if (pushTimer !== undefined) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    snapshot();
    pushTimer = undefined;
  }, 200);
}

export function undo(): void {
  if (past.length === 0) return;
  // Flush any pending debounced snapshot first so we don't lose recent edits.
  if (pushTimer !== undefined) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
    snapshot();
  }
  const restoreTarget = past.pop();
  if (!restoreTarget) return;
  // Save current as redo target.
  future.push({ nodes: graphStore.nodes, edges: graphStore.edges });
  applySnapshot(restoreTarget);
}

export function redo(): void {
  if (future.length === 0) return;
  const restoreTarget = future.pop()!;
  past.push({ nodes: graphStore.nodes, edges: graphStore.edges });
  applySnapshot(restoreTarget);
}

function applySnapshot(snap: Snapshot): void {
  // Suspend tracking so the resulting reactivity doesn't push an extra entry.
  suspended = true;
  graphStore.nodes = snap.nodes;
  graphStore.edges = snap.edges;
  graphStore.selectedId = undefined;
  // One microtask later, re-enable tracking. Effects ran synchronously above but
  // some Svelte 5 micro-batches schedule async — give one tick of cushion.
  queueMicrotask(() => {
    suspended = false;
  });
}

// Module-level effect.root that watches graph mutations and schedules snapshots.
// Initial state is captured exactly once on startup so the first user edit can
// undo back to the loaded graph.
$effect.root(() => {
  // Prime: capture the initial state so the very first edit has somewhere to
  // undo back to. Runs once because we read both signals here, then sub-effects
  // re-fire only when those change.
  past.push({ nodes: graphStore.nodes, edges: graphStore.edges });

  $effect(() => {
    void graphStore.nodes;
    void graphStore.edges;
    scheduleSnapshot();
  });
});
