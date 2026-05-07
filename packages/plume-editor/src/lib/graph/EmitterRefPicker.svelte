<script lang="ts">
  /**
   * Picks an emitter from the current graph by node id. The compiler resolves
   * the id to a generated emitter name when building the SystemDef.
   */
  import type { EmitterRef } from "../builder/nodes.js";
  import { graphStore } from "./graphStore.svelte.js";
  import { getSpec } from "../builder/nodes.js";

  let {
    value,
    selfId,
    onUpdate,
  }: {
    value: EmitterRef;
    /** id of the node holding this picker — excluded from the choices to
     *  prevent self-references. */
    selfId: string;
    onUpdate: (next: EmitterRef) => void;
  } = $props();

  // The list rebuilds whenever the graph's node list changes (live-tracked).
  const choices = $derived(
    graphStore.nodes
      .filter((n) => n.id !== selfId && getSpec(n.data.type).category === "emitter")
      .map((n) => ({ id: n.id, label: n.id })),
  );
</script>

<div class="emitter-picker">
  <select
    value={value.nodeId ?? ""}
    onchange={(e) => {
      const id = (e.currentTarget as HTMLSelectElement).value;
      onUpdate({ kind: "emitter-ref", nodeId: id || undefined });
    }}
  >
    <option value="">— pick an emitter —</option>
    {#each choices as c (c.id)}
      <option value={c.id}>{c.label}</option>
    {/each}
  </select>
  {#if !value.nodeId}
    <p class="warn">No source emitter selected — module is inert until set.</p>
  {/if}
</div>

<style>
  .emitter-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select {
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 4px 6px;
    font: inherit;
  }
  .warn {
    margin: 0;
    color: #d4a64a;
    font-size: 11px;
  }
</style>
