/**
 * Global editor state, exposed as a Svelte 5 rune-backed object.
 *
 * Kept tiny on purpose: a counter the preview pane watches (Apply button), a status
 * string for the header, and a "live" toggle that turns on debounced auto-apply.
 */

interface EditorStore {
  /** Bumped each time the user clicks "Apply" in the header — preview pane reacts to it. */
  applyTick: number;
  /** Short message shown in the header. */
  statusText: string;
  /** When true, every graph mutation auto-recompiles + respawns after a short debounce. */
  live: boolean;
}

export const editorStore: EditorStore = $state({
  applyTick: 0,
  statusText: "drag wires between handles, edit params on the right, Apply to preview",
  live: true,
});
