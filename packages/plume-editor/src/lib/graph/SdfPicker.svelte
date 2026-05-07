<script lang="ts">
  /**
   * Signed-distance-function preset picker. Stores `SdfRef`; the compiler turns
   * it into the matching `sdfSphere` / `sdfBox` / `sdfPlane` SdfFn.
   */
  import type { SdfRef } from "../builder/nodes.js";

  let {
    value,
    onUpdate,
  }: {
    value: SdfRef;
    onUpdate: (next: SdfRef) => void;
  } = $props();

  const PRESETS: SdfRef["preset"][] = ["sphere", "box", "plane"];

  function presetDefaults(preset: SdfRef["preset"]): SdfRef {
    switch (preset) {
      case "sphere":
        return { kind: "sdf", preset, center: [0, 0, 0], radius: 1 };
      case "box":
        return { kind: "sdf", preset, center: [0, 0, 0], halfSize: [0.5, 0.5, 0.5] };
      case "plane":
        return { kind: "sdf", preset, point: [0, 0, 0], normal: [0, 1, 0] };
    }
  }

  function setPreset(p: SdfRef["preset"]): void {
    if (p === value.preset) return;
    onUpdate(presetDefaults(p));
  }

  function setVec3(key: string, idx: 0 | 1 | 2, val: number): void {
    const cur = (value as unknown as Record<string, [number, number, number]>)[key];
    if (!Array.isArray(cur)) return;
    const next = [cur[0], cur[1], cur[2]] as [number, number, number];
    next[idx] = val;
    onUpdate({ ...value, [key]: next } as SdfRef);
  }
</script>

<div class="sdf-picker">
  <select
    value={value.preset}
    onchange={(e) => setPreset((e.currentTarget as HTMLSelectElement).value as SdfRef["preset"])}
  >
    {#each PRESETS as p (p)}
      <option value={p}>{p}</option>
    {/each}
  </select>

  {#if value.preset === "sphere"}
    <label>
      <span>center</span>
      <div class="row three">
        {#each [0, 1, 2] as i (i)}
          <input
            type="number" step={0.1} value={value.center[i]}
            oninput={(e) => setVec3("center", i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)}
          />
        {/each}
      </div>
    </label>
    <label>
      <span>radius</span>
      <input
        type="number" min={0.001} step={0.05} value={value.radius}
        oninput={(e) => onUpdate({ ...value, radius: +(e.currentTarget as HTMLInputElement).value })}
      />
    </label>
  {:else if value.preset === "box"}
    <label>
      <span>center</span>
      <div class="row three">
        {#each [0, 1, 2] as i (i)}
          <input
            type="number" step={0.1} value={value.center[i]}
            oninput={(e) => setVec3("center", i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)}
          />
        {/each}
      </div>
    </label>
    <label>
      <span>half size</span>
      <div class="row three">
        {#each [0, 1, 2] as i (i)}
          <input
            type="number" min={0.001} step={0.05} value={value.halfSize[i]}
            oninput={(e) => setVec3("halfSize", i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)}
          />
        {/each}
      </div>
    </label>
  {:else if value.preset === "plane"}
    <label>
      <span>point</span>
      <div class="row three">
        {#each [0, 1, 2] as i (i)}
          <input
            type="number" step={0.1} value={value.point[i]}
            oninput={(e) => setVec3("point", i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)}
          />
        {/each}
      </div>
    </label>
    <label>
      <span>normal</span>
      <div class="row three">
        {#each [0, 1, 2] as i (i)}
          <input
            type="number" step={0.1} value={value.normal[i]}
            oninput={(e) => setVec3("normal", i as 0 | 1 | 2, +(e.currentTarget as HTMLInputElement).value)}
          />
        {/each}
      </div>
    </label>
  {/if}
</div>

<style>
  .sdf-picker {
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
  .row {
    display: grid;
    gap: 4px;
  }
  .row.three {
    grid-template-columns: 1fr 1fr 1fr;
  }
</style>
