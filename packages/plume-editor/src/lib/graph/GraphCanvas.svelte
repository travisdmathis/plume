<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  // Session-1 placeholder graph. Real node types + a palette + drag-to-create wiring
  // come in the next iteration; this just confirms the @xyflow/svelte mount works and
  // gives us a visible canvas next to the preview pane.
  let nodes = $state<Node[]>([
    {
      id: "emitter",
      type: "default",
      position: { x: 80, y: 200 },
      data: { label: "Emitter" },
      style: "background:#2c5b8c;color:#fff;border:none;",
    },
    {
      id: "spawn",
      type: "default",
      position: { x: 320, y: 80 },
      data: { label: "SpawnRate" },
    },
    {
      id: "init-pos",
      type: "default",
      position: { x: 320, y: 200 },
      data: { label: "InitPosition" },
    },
    {
      id: "render",
      type: "default",
      position: { x: 320, y: 320 },
      data: { label: "SpriteRenderer" },
    },
  ]);

  let edges = $state<Edge[]>([
    { id: "e1", source: "emitter", target: "spawn" },
    { id: "e2", source: "emitter", target: "init-pos" },
    { id: "e3", source: "emitter", target: "render" },
  ]);
</script>

<div class="graph-canvas">
  <SvelteFlow bind:nodes bind:edges fitView proOptions={{ hideAttribution: true }}>
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .graph-canvas {
    width: 100%;
    height: 100%;
  }
  /* xyflow's stylesheet uses light-mode defaults; nudge into dark to match the editor chrome. */
  :global(.svelte-flow__background) {
    background-color: #0e1116;
  }
  :global(.svelte-flow__node-default) {
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
  }
  :global(.svelte-flow__edge-path) {
    stroke: #4a525e;
  }
  :global(.svelte-flow__controls button) {
    background: #1c1f26;
    color: #e7e7e9;
    border-bottom: 1px solid #2a2c33;
  }
</style>
