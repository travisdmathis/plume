<script lang="ts">
  import GraphCanvas from "./lib/graph/GraphCanvas.svelte";
  import PreviewPane from "./lib/preview/PreviewPane.svelte";
  import { editorStore } from "./lib/state.svelte";

  function applyGraph(): void {
    editorStore.applyTick++;
  }
</script>

<div class="app">
  <header>
    <span class="logo">plume editor</span>
    <span class="status">{editorStore.statusText}</span>
    <button on:click={applyGraph}>Apply</button>
  </header>

  <main>
    <section class="graph">
      <GraphCanvas />
    </section>
    <section class="preview">
      <PreviewPane applyTick={editorStore.applyTick} />
    </section>
  </main>
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
  main {
    display: grid;
    grid-template-columns: 1fr 480px;
    overflow: hidden;
  }
  .graph {
    border-right: 1px solid #2a2c33;
    overflow: hidden;
  }
  .preview {
    overflow: hidden;
    position: relative;
  }
</style>
