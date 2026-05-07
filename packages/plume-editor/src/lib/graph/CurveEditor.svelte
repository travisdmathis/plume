<script lang="ts">
  /**
   * Minimal 1D curve editor: an SVG preview at the top, then a list of stops
   * (`t`, `v`) the user can edit / add / remove. Drag-to-pose on the SVG would
   * be polish for a later session — the list form is enough to author any
   * keyframe configuration.
   */
  import type { CurveKey } from "../builder/nodes.js";

  let {
    keys,
    onUpdate,
  }: {
    keys: CurveKey[];
    onUpdate: (next: CurveKey[]) => void;
  } = $props();

  // Stock curve shapes — load with one click instead of authoring keyframes.
  const PRESETS: { name: string; keys: CurveKey[] }[] = [
    { name: "Linear up", keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
    { name: "Linear down", keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] },
    { name: "Constant 1", keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
    {
      name: "Ease in",
      keys: [
        { t: 0, v: 0 },
        { t: 0.5, v: 0.15 },
        { t: 1, v: 1 },
      ],
    },
    {
      name: "Ease out",
      keys: [
        { t: 0, v: 0 },
        { t: 0.5, v: 0.85 },
        { t: 1, v: 1 },
      ],
    },
    {
      name: "Ease in/out",
      keys: [
        { t: 0, v: 0 },
        { t: 0.25, v: 0.1 },
        { t: 0.75, v: 0.9 },
        { t: 1, v: 1 },
      ],
    },
    {
      name: "Bell",
      keys: [
        { t: 0, v: 0 },
        { t: 0.5, v: 1 },
        { t: 1, v: 0 },
      ],
    },
    {
      name: "Pulse",
      keys: [
        { t: 0, v: 0 },
        { t: 0.05, v: 1 },
        { t: 0.2, v: 1 },
        { t: 0.4, v: 0 },
        { t: 1, v: 0 },
      ],
    },
    {
      name: "Sawtooth",
      keys: [
        { t: 0, v: 0 },
        { t: 0.5, v: 1 },
        { t: 0.500001, v: 0 },
        { t: 1, v: 1 },
      ],
    },
  ];

  const W = 240;
  const H = 70;

  // Sort keys for rendering (don't mutate the source array — the editor keeps
  // the row order the user sees, even mid-edit when t is being typed).
  const sorted = $derived([...keys].sort((a, b) => a.t - b.t));

  // Auto-fit Y axis to the value range with a tiny pad so flat curves are visible.
  const vMin = $derived(Math.min(0, ...sorted.map((k) => k.v)));
  const vMax = $derived(Math.max(1, ...sorted.map((k) => k.v)));
  const vRange = $derived(Math.max(0.0001, vMax - vMin));

  function project(k: CurveKey): { x: number; y: number } {
    const t = Math.max(0, Math.min(1, k.t));
    return {
      x: t * W,
      y: H - ((k.v - vMin) / vRange) * H,
    };
  }
  const path = $derived(
    sorted.length === 0
      ? ""
      : `M ${sorted.map((k) => `${project(k).x.toFixed(1)},${project(k).y.toFixed(1)}`).join(" L ")}`,
  );

  function set(idx: number, field: keyof CurveKey, value: number): void {
    onUpdate(keys.map((k, i) => (i === idx ? { ...k, [field]: value } : k)));
  }

  function addStop(): void {
    if (keys.length === 0) {
      onUpdate([{ t: 0, v: 1 }]);
      return;
    }
    if (keys.length === 1) {
      onUpdate([...keys, { t: 1, v: keys[0]!.v }]);
      return;
    }
    const last = keys[keys.length - 1]!;
    const prev = keys[keys.length - 2]!;
    onUpdate([...keys, { t: (prev.t + last.t) / 2, v: (prev.v + last.v) / 2 }]);
  }

  function removeStop(idx: number): void {
    if (keys.length <= 1) return; // keep at least one stop
    onUpdate(keys.filter((_, i) => i !== idx));
  }
</script>

<div class="curve-editor">
  <select
    class="preset"
    value=""
    onchange={(e) => {
      const idx = +(e.currentTarget as HTMLSelectElement).value;
      const preset = PRESETS[idx];
      if (preset) onUpdate(preset.keys.map((k) => ({ ...k })));
      (e.currentTarget as HTMLSelectElement).value = "";
    }}
  >
    <option value="">— preset…</option>
    {#each PRESETS as p, i (p.name)}
      <option value={i}>{p.name}</option>
    {/each}
  </select>
  <svg viewBox={`0 0 ${W} ${H}`} class="preview" preserveAspectRatio="none">
    <rect x="0" y="0" width={W} height={H} fill="#0e1116" />
    <line x1="0" y1={H - ((1 - vMin) / vRange) * H} x2={W} y2={H - ((1 - vMin) / vRange) * H} stroke="#2a2c33" stroke-dasharray="2,3" />
    <path d={path} stroke="#9ae6b4" stroke-width="1.5" fill="none" />
    {#each sorted as k (k.t + ":" + k.v)}
      {@const p = project(k)}
      <circle cx={p.x} cy={p.y} r="3" fill="#9ae6b4" />
    {/each}
  </svg>

  <div class="rows">
    {#each keys as key, i (i)}
      <div class="row">
        <label class="cell">
          <span>t</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={key.t}
            oninput={(e) => set(i, "t", +(e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="cell">
          <span>v</span>
          <input
            type="number"
            step={0.05}
            value={key.v}
            oninput={(e) => set(i, "v", +(e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          class="del"
          onclick={() => removeStop(i)}
          disabled={keys.length <= 1}
          title="Remove keyframe"
        >×</button>
      </div>
    {/each}
    <button type="button" class="add" onclick={addStop}>+ Add keyframe</button>
  </div>
</div>

<style>
  .curve-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview {
    width: 100%;
    height: 70px;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    display: block;
  }
  .preset {
    background: #1c1f26;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 3px 5px;
    font: 11px/1.2 system-ui, sans-serif;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 24px;
    gap: 4px;
    align-items: end;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cell span {
    font-size: 10px;
    color: #888;
    letter-spacing: 0.04em;
  }
  input {
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 3px 5px;
    font: 12px/1.2 system-ui, sans-serif;
  }
  button {
    background: #1c1f26;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    cursor: pointer;
    font: 12px/1 system-ui, sans-serif;
  }
  button:hover:not(:disabled) {
    background: #242832;
  }
  button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .del {
    height: 22px;
    align-self: end;
  }
  .add {
    margin-top: 4px;
    padding: 5px;
  }
</style>
