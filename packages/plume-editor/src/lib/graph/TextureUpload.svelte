<script lang="ts">
  /**
   * Compact file-upload widget for texture params. Shows a thumbnail of the
   * current image (data URL), the filename, and Replace/Clear buttons. We store
   * data URLs directly in the graph so save/load round-trip without an external
   * asset store — fine for an editor at this scale.
   */
  import type { TextureRef } from "../builder/nodes.js";
  import { fileToDataUrl } from "../builder/textures.js";

  let {
    value,
    optional,
    onUpdate,
  }: {
    value: TextureRef | undefined;
    optional?: boolean;
    onUpdate: (next: TextureRef | undefined) => void;
  } = $props();

  let inputEl: HTMLInputElement | undefined = $state();

  async function pick(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    onUpdate({ kind: "texture", dataUrl, name: file.name });
  }

  function trigger(): void {
    inputEl?.click();
  }

  function clear(): void {
    onUpdate(undefined);
    if (inputEl) inputEl.value = "";
  }
</script>

<div class="texture-upload">
  {#if value}
    <div class="thumb-wrap">
      <img class="thumb" src={value.dataUrl} alt={value.name} />
      <div class="meta">
        <span class="name" title={value.name}>{value.name}</span>
        <div class="row">
          <button type="button" onclick={trigger}>Replace</button>
          {#if optional}
            <button type="button" class="ghost" onclick={clear}>Clear</button>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <button type="button" class="empty" onclick={trigger}>
      <span>+ Upload texture</span>
      <small>PNG / JPG / WebP</small>
    </button>
  {/if}
  <input
    bind:this={inputEl}
    type="file"
    accept="image/png,image/jpeg,image/webp"
    onchange={pick}
    hidden
  />
</div>

<style>
  .texture-upload {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .thumb-wrap {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 8px;
    padding: 6px;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    background: #1c1f26;
  }
  .thumb {
    width: 56px;
    height: 56px;
    object-fit: contain;
    background-color: #0e1116;
    background-image: linear-gradient(45deg, #14161b 25%, transparent 25%),
      linear-gradient(-45deg, #14161b 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #14161b 75%),
      linear-gradient(-45deg, transparent 75%, #14161b 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    border-radius: 3px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 0;
  }
  .name {
    color: #cdd2da;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  button {
    background: #2c5b8c;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font: 11px/1 system-ui, sans-serif;
  }
  button:hover {
    background: #3a72ad;
  }
  button.ghost {
    background: transparent;
    color: #aaa;
    border: 1px solid #2a2c33;
  }
  button.ghost:hover {
    background: #1c1f26;
    color: #fff;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 56px;
    background: #1c1f26;
    color: #cdd2da;
    border: 1px dashed #2a3742;
    border-radius: 4px;
    cursor: pointer;
    font: 12px/1 system-ui, sans-serif;
  }
  .empty:hover {
    background: #20232b;
    border-color: #3a72ad;
  }
  .empty small {
    color: #888;
    font-size: 10px;
  }
</style>
