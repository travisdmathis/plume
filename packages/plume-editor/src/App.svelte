<script lang="ts">
  import GraphCanvas from "./lib/graph/GraphCanvas.svelte";
  import Palette from "./lib/graph/Palette.svelte";
  import Inspector from "./lib/graph/Inspector.svelte";
  import PreviewPane from "./lib/preview/PreviewPane.svelte";
  import CodeExportModal from "./lib/CodeExportModal.svelte";
  import { editorStore } from "./lib/state.svelte.js";
  import { graphStore, replaceGraph, resetToStarter } from "./lib/graph/graphStore.svelte.js";
  import { downloadGraph, pickGraphFile } from "./lib/persistence.js";
  // Importing for the side effect: registers the global history snapshotter.
  import { undo, redo } from "./lib/graph/history.svelte.js";
  import { PRESETS } from "./lib/presets/gallery.js";

  let exportOpen = $state(false);

  function loadPreset(idx: number): void {
    const preset = PRESETS[idx];
    if (!preset) return;
    const built = preset.build();
    replaceGraph(built.nodes, built.edges);
    editorStore.statusText = `Preset: ${preset.name} — ${preset.description}`;
  }

  function onKeydown(event: KeyboardEvent): void {
    // Don't intercept undo/redo while the user is typing into a field.
    const t = event.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key === "y") {
      event.preventDefault();
      redo();
    }
  }

  function applyGraph(): void {
    editorStore.applyTick++;
    editorStore.statusText = `Applying… (tick ${editorStore.applyTick})`;
  }

  function saveGraph(): void {
    downloadGraph(graphStore.nodes, graphStore.edges);
    editorStore.statusText = "Graph downloaded as plume-graph.json";
  }

  async function loadGraph(): Promise<void> {
    try {
      const result = await pickGraphFile();
      if (!result) return;
      replaceGraph(result.nodes, result.edges);
      editorStore.statusText = `Loaded ${result.nodes.length} nodes / ${result.edges.length} edges`;
    } catch (err) {
      editorStore.statusText = `Load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function resetGraph(): void {
    if (!confirm("Reset to the starter graph? This clears the autosave.")) return;
    resetToStarter();
    editorStore.statusText = "Reset to starter graph.";
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <header>
    <span class="logo">plume editor</span>
    <span class="status">{editorStore.statusText}</span>
    <label class="live">
      <input type="checkbox" bind:checked={editorStore.live} />
      Live
    </label>
    <select
      class="presets"
      value=""
      title="Load a preset graph"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        (e.currentTarget as HTMLSelectElement).value = "";
        if (v !== "") loadPreset(+v);
      }}
    >
      <option value="">Presets…</option>
      {#each PRESETS as p, i (p.name)}
        <option value={i}>{p.name}</option>
      {/each}
    </select>
    <button class="ghost" onclick={resetGraph} title="Reset to starter graph">Reset</button>
    <button
      class="ghost"
      onclick={() => (exportOpen = true)}
      title="Export the current graph as TypeScript code">Export</button
    >
    <button class="ghost" onclick={loadGraph} title="Load graph from a JSON file">Load</button>
    <button class="ghost" onclick={saveGraph} title="Download graph as JSON">Save</button>
    <button onclick={applyGraph}>Apply</button>
  </header>

  <main>
    <section class="palette">
      <Palette />
    </section>
    <section class="graph">
      <GraphCanvas />
    </section>
    <section class="inspector">
      <Inspector />
    </section>
    <section class="preview">
      <PreviewPane applyTick={editorStore.applyTick} />
    </section>
  </main>

  <CodeExportModal bind:open={exportOpen} />
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
    width: 100vw;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: #14161b;
    border-bottom: 1px solid #2a2c33;
  }
  .logo {
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9ae6b4;
  }
  .status {
    flex: 1;
    color: #888;
    font-size: 13px;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #cdd2da;
    font-size: 13px;
    user-select: none;
    cursor: pointer;
  }
  .live input {
    accent-color: #9ae6b4;
  }
  button {
    background: #2c5b8c;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  button:hover {
    background: #3a72ad;
  }
  button.ghost {
    background: transparent;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    padding: 5px 12px;
  }
  button.ghost:hover {
    background: #1c1f26;
    border-color: #3a3d44;
  }
  .presets {
    background: #1c1f26;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    cursor: pointer;
  }
  .presets:hover {
    background: #242832;
    border-color: #3a3d44;
  }
  main {
    display: grid;
    grid-template-columns: 200px 1fr 280px 480px;
    overflow: hidden;
  }
  .palette,
  .graph,
  .inspector,
  .preview {
    overflow: hidden;
    position: relative;
  }
  .graph {
    border-right: 1px solid #2a2c33;
  }
</style>
