<script lang="ts">
  /**
   * Procedural geometry picker — preset dropdown plus dimension inputs that
   * change shape with the selected preset. Stores `GeometryRef` objects that
   * `compile.ts` reads to instantiate the matching `THREE.BufferGeometry`.
   */
  import type { GeometryRef } from "../builder/nodes.js";

  let {
    value,
    onUpdate,
  }: {
    value: GeometryRef;
    onUpdate: (next: GeometryRef) => void;
  } = $props();

  const PRESETS: GeometryRef["preset"][] = ["sphere", "box", "torus", "cone", "cylinder", "plane"];

  function presetDefaults(preset: GeometryRef["preset"]): GeometryRef {
    switch (preset) {
      case "sphere":
        return { kind: "geometry", preset, radius: 0.5, widthSegments: 32, heightSegments: 16 };
      case "box":
        return { kind: "geometry", preset, width: 0.5, height: 0.5, depth: 0.5 };
      case "torus":
        return { kind: "geometry", preset, radius: 0.4, tube: 0.12, radialSegments: 24, tubularSegments: 48 };
      case "cone":
        return { kind: "geometry", preset, radius: 0.4, height: 0.8, radialSegments: 24 };
      case "cylinder":
        return { kind: "geometry", preset, radiusTop: 0.4, radiusBottom: 0.4, height: 0.8, radialSegments: 24 };
      case "plane":
        return { kind: "geometry", preset, width: 1, height: 1 };
    }
  }

  function setPreset(p: GeometryRef["preset"]): void {
    if (p === value.preset) return;
    onUpdate(presetDefaults(p));
  }

  function patch(updates: Partial<GeometryRef>): void {
    onUpdate({ ...value, ...updates } as GeometryRef);
  }
</script>

<div class="geometry-picker">
  <select
    value={value.preset}
    onchange={(e) => setPreset((e.currentTarget as HTMLSelectElement).value as GeometryRef["preset"])}
  >
    {#each PRESETS as p (p)}
      <option value={p}>{p}</option>
    {/each}
  </select>

  {#if value.preset === "sphere"}
    <label>
      <span>radius</span>
      <input type="number" min={0.001} step={0.05} value={value.radius}
        oninput={(e) => patch({ radius: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>widthSegments</span>
      <input type="number" min={3} step={1} value={value.widthSegments}
        oninput={(e) => patch({ widthSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>heightSegments</span>
      <input type="number" min={2} step={1} value={value.heightSegments}
        oninput={(e) => patch({ heightSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {:else if value.preset === "box"}
    <label>
      <span>width</span>
      <input type="number" min={0.001} step={0.05} value={value.width}
        oninput={(e) => patch({ width: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>height</span>
      <input type="number" min={0.001} step={0.05} value={value.height}
        oninput={(e) => patch({ height: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>depth</span>
      <input type="number" min={0.001} step={0.05} value={value.depth}
        oninput={(e) => patch({ depth: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {:else if value.preset === "torus"}
    <label>
      <span>radius</span>
      <input type="number" min={0.001} step={0.05} value={value.radius}
        oninput={(e) => patch({ radius: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>tube</span>
      <input type="number" min={0.001} step={0.01} value={value.tube}
        oninput={(e) => patch({ tube: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>radialSegments</span>
      <input type="number" min={3} step={1} value={value.radialSegments}
        oninput={(e) => patch({ radialSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>tubularSegments</span>
      <input type="number" min={3} step={1} value={value.tubularSegments}
        oninput={(e) => patch({ tubularSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {:else if value.preset === "cone"}
    <label>
      <span>radius</span>
      <input type="number" min={0.001} step={0.05} value={value.radius}
        oninput={(e) => patch({ radius: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>height</span>
      <input type="number" min={0.001} step={0.05} value={value.height}
        oninput={(e) => patch({ height: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>radialSegments</span>
      <input type="number" min={3} step={1} value={value.radialSegments}
        oninput={(e) => patch({ radialSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {:else if value.preset === "cylinder"}
    <label>
      <span>radiusTop</span>
      <input type="number" min={0} step={0.05} value={value.radiusTop}
        oninput={(e) => patch({ radiusTop: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>radiusBottom</span>
      <input type="number" min={0} step={0.05} value={value.radiusBottom}
        oninput={(e) => patch({ radiusBottom: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>height</span>
      <input type="number" min={0.001} step={0.05} value={value.height}
        oninput={(e) => patch({ height: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>radialSegments</span>
      <input type="number" min={3} step={1} value={value.radialSegments}
        oninput={(e) => patch({ radialSegments: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {:else if value.preset === "plane"}
    <label>
      <span>width</span>
      <input type="number" min={0.001} step={0.05} value={value.width}
        oninput={(e) => patch({ width: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label>
      <span>height</span>
      <input type="number" min={0.001} step={0.05} value={value.height}
        oninput={(e) => patch({ height: +(e.currentTarget as HTMLInputElement).value })} />
    </label>
  {/if}
</div>

<style>
  .geometry-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select,
  input {
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 4px 6px;
    font: inherit;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  label span {
    font-size: 10px;
    color: #888;
    letter-spacing: 0.04em;
  }
</style>
