/**
 * Global editor state, exposed as a Svelte 5 rune-backed object.
 *
 * Kept tiny on purpose for session 1: just a counter the preview pane watches to know when
 * to rebuild from the graph, plus a status string for the header. Real graph state will
 * live in the GraphCanvas for now and pass through here as we wire compilation.
 */

interface EditorStore {
  /** Bumped each time the user clicks "Apply" in the header — preview pane reacts to it. */
  applyTick: number;
  /** Short message shown in the header. */
  statusText: string;
}

export const editorStore: EditorStore = $state({
  applyTick: 0,
  statusText: "drag nodes onto the canvas, then Apply to spawn in the preview",
});
