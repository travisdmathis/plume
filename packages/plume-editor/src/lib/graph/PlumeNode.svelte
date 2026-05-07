<script lang="ts">
  /**
   * Custom xyflow node renderer for plume modules.
   *
   * Card body + connectable source/target handles. Users wire modules together
   * left-to-right; the compiler walks the resulting graph via BFS from each
   * emitter.
   *
   * Nodes that aren't reachable from any emitter are dimmed and outlined as a
   * "won't be compiled" hint.
   */
  import { Handle, Position } from "@xyflow/svelte";
  import { getSpec } from "../builder/nodes.js";
  import { type PlumeNodeData, unreachableIds, disconnectHandle } from "./graphStore.svelte.js";

  let {
    id,
    data,
    selected,
  }: {
    id: string;
    data: PlumeNodeData;
    selected?: boolean;
  } = $props();

  const spec = $derived(getSpec(data.type));
  const unreachable = $derived(unreachableIds().has(id));

  // Right-click on a handle dot detaches just that side's edges. Suppress the
  // browser context menu so the gesture feels native to the editor.
  function onHandleContext(side: "source" | "target") {
    return (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      disconnectHandle(id, side);
    };
  }
</script>

<div
  class="plume-node"
  class:selected
  class:unreachable
  style="--accent: {spec.accent};"
  title={unreachable ? "Not reachable from an emitter — won't be compiled" : undefined}
>
  <Handle
    type="target"
    position={Position.Left}
    oncontextmenu={onHandleContext("target")}
    title="Right-click to detach incoming wires"
  />
  <div class="cat">{spec.category}</div>
  <div class="label">{spec.label}</div>
  <Handle
    type="source"
    position={Position.Right}
    oncontextmenu={onHandleContext("source")}
    title="Right-click to detach outgoing wires"
  />
</div>

<style>
  .plume-node {
    position: relative;
    min-width: 140px;
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    padding: 8px 12px;
    font: 13px/1.2 system-ui, sans-serif;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    user-select: none;
  }
  .plume-node.selected {
    border-color: #9ae6b4;
    border-left-color: var(--accent);
    box-shadow:
      0 0 0 1px #9ae6b4,
      0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .plume-node.unreachable {
    opacity: 0.55;
    border-style: dashed;
  }
  .plume-node.unreachable.selected {
    opacity: 1;
  }
  .cat {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 2px;
  }
  .label {
    font-weight: 600;
  }
  /* Visible-but-restrained handles. Source side is the accent colour so users can
     see at a glance which side outputs into the next stage. */
  :global(.svelte-flow__handle) {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid #14161b;
  }
  :global(.svelte-flow__handle.target) {
    background: #4a525e;
  }
  :global(.svelte-flow__handle.source) {
    background: var(--accent, #9ae6b4);
  }
  :global(.svelte-flow__handle:hover) {
    background: #9ae6b4;
  }
</style>
