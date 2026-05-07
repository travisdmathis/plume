<script lang="ts">
  /**
   * Minimal gradient editor: a CSS-driven preview bar at the top, then a row
   * per stop (`t` + RGBA fields + a colour swatch). Stop ordering on render is
   * by `t`, but we don't mutate the source list during editing.
   */
  import type { GradientStopJSON } from "../builder/nodes.js";

  let {
    stops,
    onUpdate,
  }: {
    stops: GradientStopJSON[];
    onUpdate: (next: GradientStopJSON[]) => void;
  } = $props();

  const PRESETS: { name: string; stops: GradientStopJSON[] }[] = [
    {
      name: "Fire",
      stops: [
        { t: 0, color: [3.0, 2.5, 0.6, 0] },
        { t: 0.15, color: [3.0, 2.0, 0.5, 1] },
        { t: 0.5, color: [2.5, 1.0, 0.3, 1] },
        { t: 1, color: [0.6, 0.1, 0.05, 0] },
      ],
    },
    {
      name: "Magic",
      stops: [
        { t: 0, color: [0.6, 0.4, 1.5, 0] },
        { t: 0.25, color: [1.4, 0.6, 2.5, 1] },
        { t: 0.7, color: [2.0, 1.5, 3.0, 1] },
        { t: 1, color: [0.2, 0.1, 0.5, 0] },
      ],
    },
    {
      name: "Ice",
      stops: [
        { t: 0, color: [0.6, 0.9, 1.6, 0] },
        { t: 0.3, color: [1.4, 1.8, 2.4, 1] },
        { t: 0.8, color: [0.8, 1.2, 1.8, 1] },
        { t: 1, color: [0.1, 0.2, 0.4, 0] },
      ],
    },
    {
      name: "Smoke",
      stops: [
        { t: 0, color: [0.5, 0.5, 0.5, 0] },
        { t: 0.2, color: [0.85, 0.85, 0.9, 0.7] },
        { t: 1, color: [0.2, 0.2, 0.25, 0] },
      ],
    },
    {
      name: "Plasma",
      stops: [
        { t: 0, color: [3.0, 0.4, 1.6, 1] },
        { t: 0.5, color: [1.0, 0.4, 3.0, 1] },
        { t: 1, color: [0.2, 1.0, 2.6, 0] },
      ],
    },
    {
      name: "Rainbow",
      stops: [
        { t: 0, color: [1.6, 0.2, 0.2, 1] },
        { t: 0.2, color: [1.6, 0.9, 0.2, 1] },
        { t: 0.4, color: [0.4, 1.6, 0.2, 1] },
        { t: 0.6, color: [0.2, 1.0, 1.6, 1] },
        { t: 0.8, color: [0.6, 0.2, 1.6, 1] },
        { t: 1, color: [1.6, 0.2, 1.4, 1] },
      ],
    },
    {
      name: "Embers",
      stops: [
        { t: 0, color: [3.5, 2.2, 0.6, 1] },
        { t: 0.6, color: [2.2, 0.5, 0.05, 1] },
        { t: 1, color: [0.4, 0.04, 0.02, 0] },
      ],
    },
  ];

  const sorted = $derived([...stops].sort((a, b) => a.t - b.t));

  // CSS linear-gradient string built from the sorted stops. Alpha is multiplied
  // into the channel so transparent areas read as the page background.
  const css = $derived(
    sorted.length === 0
      ? "transparent"
      : `linear-gradient(to right, ${sorted.map((s) => `rgba(${Math.round(s.color[0] * 255)}, ${Math.round(s.color[1] * 255)}, ${Math.round(s.color[2] * 255)}, ${s.color[3]}) ${(s.t * 100).toFixed(1)}%`).join(", ")})`,
  );

  function set(idx: number, patch: Partial<GradientStopJSON>): void {
    onUpdate(stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function setColorChannel(idx: number, channel: 0 | 1 | 2 | 3, value: number): void {
    const c = [...stops[idx]!.color] as [number, number, number, number];
    c[channel] = value;
    set(idx, { color: c });
  }

  function toHex(c: [number, number, number, number]): string {
    const n = (x: number): string =>
      Math.round(Math.max(0, Math.min(1, x)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${n(c[0])}${n(c[1])}${n(c[2])}`;
  }
  function fromHex(hex: string, alpha: number): [number, number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [1, 1, 1, alpha];
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, alpha];
  }

  function addStop(): void {
    if (stops.length === 0) {
      onUpdate([{ t: 0, color: [1, 1, 1, 1] }]);
      return;
    }
    if (stops.length === 1) {
      onUpdate([...stops, { t: 1, color: stops[0]!.color }]);
      return;
    }
    const last = stops[stops.length - 1]!;
    const prev = stops[stops.length - 2]!;
    const t = (prev.t + last.t) / 2;
    const color: [number, number, number, number] = [
      (prev.color[0] + last.color[0]) / 2,
      (prev.color[1] + last.color[1]) / 2,
      (prev.color[2] + last.color[2]) / 2,
      (prev.color[3] + last.color[3]) / 2,
    ];
    onUpdate([...stops, { t, color }]);
  }

  function removeStop(idx: number): void {
    if (stops.length <= 1) return;
    onUpdate(stops.filter((_, i) => i !== idx));
  }
</script>

<div class="gradient-editor">
  <select
    class="preset"
    value=""
    onchange={(e) => {
      const idx = +(e.currentTarget as HTMLSelectElement).value;
      const preset = PRESETS[idx];
      if (preset) onUpdate(preset.stops.map((s) => ({ t: s.t, color: [...s.color] as [number, number, number, number] })));
      (e.currentTarget as HTMLSelectElement).value = "";
    }}
  >
    <option value="">— preset…</option>
    {#each PRESETS as p, i (p.name)}
      <option value={i}>{p.name}</option>
    {/each}
  </select>
  <div class="preview" style="background: {css};"></div>

  <div class="rows">
    {#each stops as stop, i (i)}
      <div class="row">
        <input
          type="color"
          value={toHex(stop.color)}
          oninput={(e) => {
            const rgb = fromHex((e.currentTarget as HTMLInputElement).value, stop.color[3]);
            set(i, { color: rgb });
          }}
        />
        <label class="cell">
          <span>t</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={stop.t}
            oninput={(e) => set(i, { t: +(e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="cell">
          <span>α</span>
          <input
            type="number"
            min={0}
            max={4}
            step={0.05}
            value={stop.color[3]}
            oninput={(e) => setColorChannel(i, 3, +(e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          class="del"
          onclick={() => removeStop(i)}
          disabled={stops.length <= 1}
          title="Remove stop"
        >×</button>
      </div>
    {/each}
    <button type="button" class="add" onclick={addStop}>+ Add stop</button>
  </div>
</div>

<style>
  .gradient-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preset {
    background: #1c1f26;
    color: #cdd2da;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 3px 5px;
    font: 11px/1.2 system-ui, sans-serif;
  }
  .preview {
    width: 100%;
    height: 32px;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    background-color: #0e1116;
    background-image: linear-gradient(45deg, #14161b 25%, transparent 25%),
      linear-gradient(-45deg, #14161b 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #14161b 75%),
      linear-gradient(-45deg, transparent 75%, #14161b 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 32px 1fr 1fr 24px;
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
  input[type="color"] {
    height: 26px;
    padding: 0;
    background: #1c1f26;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    cursor: pointer;
  }
  input[type="number"] {
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
  }
  .add {
    margin-top: 4px;
    padding: 5px;
  }
</style>
