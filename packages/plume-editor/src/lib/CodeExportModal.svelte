<script lang="ts">
  /**
   * Modal that shows the codegen output for the current graph and lets the user
   * copy it to the clipboard. Visible state is driven by the parent through a
   * bindable `open` prop.
   */
  import { graphStore } from "./graph/graphStore.svelte.js";
  import { generateCode } from "./builder/codegen.js";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let code = $derived(open ? generateCode(graphStore.nodes, graphStore.edges) : "");
  let copyState: "idle" | "copied" | "failed" = $state("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      copyState = "copied";
      setTimeout(() => (copyState = "idle"), 1500);
    } catch {
      copyState = "failed";
      setTimeout(() => (copyState = "idle"), 1500);
    }
  }

  function close(): void {
    open = false;
  }

  function onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) close();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- a11y: backdrop click closes the dialog; Escape is handled in the global keydown
       listener above. The visible role is the dialog itself, so we don't add a key
       handler here. -->
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Exported code"
    tabindex="-1"
    onclick={onBackdrop}
    onkeydown={(e) => {
      if (e.key === "Escape") close();
    }}
  >
    <div class="modal">
      <header>
        <h2>Export — TypeScript</h2>
        <button class="close" type="button" onclick={close} aria-label="Close">×</button>
      </header>
      <pre>{code}</pre>
      <footer>
        <span class="hint">Paste this next to a `Manager`. The graph also persists in localStorage automatically.</span>
        <button type="button" class="primary" onclick={copy}>
          {copyState === "copied" ? "Copied ✓" : copyState === "failed" ? "Copy failed" : "Copy code"}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: 24px;
  }
  .modal {
    width: min(900px, 100%);
    max-height: 80vh;
    background: #14161b;
    border: 1px solid #2a2c33;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  header {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid #2a2c33;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    color: #cdd2da;
    font-weight: 600;
  }
  .close {
    background: transparent;
    border: 1px solid #2a2c33;
    color: #aaa;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  .close:hover {
    background: #1c1f26;
    color: #fff;
  }
  pre {
    flex: 1;
    margin: 0;
    padding: 14px 16px;
    overflow: auto;
    background: #0e1116;
    color: #e7e7e9;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid #2a2c33;
  }
  .hint {
    flex: 1;
    color: #888;
    font-size: 12px;
  }
  .primary {
    background: #2c5b8c;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: 13px/1 system-ui, sans-serif;
  }
  .primary:hover {
    background: #3a72ad;
  }
</style>
