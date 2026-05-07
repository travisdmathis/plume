<script lang="ts">
  /**
   * Graph canvas — wraps `<SvelteFlow>` and binds it to `graphStore`. Registers our
   * single custom node type ("plume") so every module renders with the right accent
   * and label, and forwards click selection back into the store so the inspector
   * stays in sync.
   *
   * Edges are explicit in v1: users drag wires from a source handle to a target
   * handle, and the compiler walks the resulting DAG via BFS from the emitter.
   */
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    type NodeTypes,
    type Connection,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import PlumeNode from "./PlumeNode.svelte";
  import {
    graphStore,
    selectNode,
    addEdge,
    removeEdge,
    removeNode,
  } from "./graphStore.svelte.js";

  // xyflow's `NodeTypes` map embeds `any` in its component-prop generics — that's their
  // public surface, not ours. Cast through `unknown` so we don't propagate the `any`
  // into our own code; the runtime shape is the same.
  const nodeTypes = { plume: PlumeNode } as unknown as NodeTypes;

  // Local bound copies for SvelteFlow's `bind:` machinery. Held as `$state.raw` so
  // xyflow's internal in-place tweaks don't trigger Svelte reactivity (it warns
  // explicitly about that — `warnIfDeeplyReactive`).
  let boundNodes: Node[] = $state.raw(graphStore.nodes as unknown as Node[]);
  let boundEdges: Edge[] = $state.raw(graphStore.edges);

  // Re-sync xyflow's internal copy when the palette adds/removes a node externally
  // (or when a new edge is drawn / deleted).
  $effect(() => {
    boundNodes = graphStore.nodes as unknown as Node[];
  });
  $effect(() => {
    boundEdges = graphStore.edges;
  });

  // Push xyflow's edits (drag, position changes) back into the store so the compiler
  // and inspector see the same data.
  $effect(() => {
    graphStore.nodes = boundNodes as unknown as typeof graphStore.nodes;
  });
  $effect(() => {
    graphStore.edges = boundEdges;
  });

  function onNodeClick(event: { node: { id: string } }): void {
    selectNode(event.node.id);
  }
  function onPaneClick(): void {
    selectNode(undefined);
  }

  function onConnect(connection: Connection): void {
    if (connection.source && connection.target) addEdge(connection.source, connection.target);
  }

  // Endpoint-drag rerouting: when the user grabs either end of an existing edge
  // and drops it on a different handle, xyflow fires `onreconnect` with the old
  // edge + the new connection. We map that to a remove+add in the store.
  function onReconnect(oldEdge: { id: string }, newConnection: Connection): void {
    if (!newConnection.source || !newConnection.target) return;
    removeEdge(oldEdge.id);
    addEdge(newConnection.source, newConnection.target);
  }

  // Keep the store in sync when xyflow deletes nodes/edges via keyboard (Delete key
  // or rubber-band selection). The event payload reports what was removed; we mirror
  // it back into the store.
  function onDelete(payload: { nodes: { id: string }[]; edges: { id: string }[] }): void {
    for (const e of payload.edges) removeEdge(e.id);
    for (const n of payload.nodes) removeNode(n.id);
  }
</script>

<div class="graph-canvas">
  <SvelteFlow
    bind:nodes={boundNodes}
    bind:edges={boundEdges}
    {nodeTypes}
    fitView
    proOptions={{ hideAttribution: true }}
    onnodeclick={onNodeClick}
    onpaneclick={onPaneClick}
    onconnect={onConnect}
    onreconnect={onReconnect}
    ondelete={onDelete}
  >
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .graph-canvas {
    width: 100%;
    height: 100%;
  }
  :global(.svelte-flow) {
    background-color: #0e1116;
  }
  :global(.svelte-flow__background) {
    background-color: #0e1116;
  }
  :global(.svelte-flow__edge-path) {
    stroke: #3a72ad;
    stroke-width: 1.5;
  }
  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #9ae6b4;
    stroke-width: 2;
  }
  :global(.svelte-flow__connectionline) {
    stroke: #9ae6b4;
    stroke-width: 2;
  }
  :global(.svelte-flow__controls button) {
    background: #1c1f26;
    color: #e7e7e9;
    border-bottom: 1px solid #2a2c33;
  }
  :global(.svelte-flow__node) {
    /* Let our PlumeNode card take over background/border styling. */
    background: transparent;
    border: none;
    padding: 0;
  }
</style>
