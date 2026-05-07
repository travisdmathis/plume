<script lang="ts">
  /**
   * Right-rail inspector for the currently-selected node. Renders one input per spec
   * field, dispatching to per-kind controls (number, range, vec3, color, select, shape).
   * Mutations flow through `updateNodeParam` so the graph store stays the single source
   * of truth for compilation.
   */
  import type { EmissionShape } from "three-plume";
  import {
    getSpec,
    type Field,
    type ParamValue,
    type CurveKey,
    type GradientStopJSON,
    type TextureRef,
    type GeometryRef,
    type SdfRef,
    type EmitterRef,
  } from "../builder/nodes.js";
  import {
    graphStore,
    removeNode,
    updateNodeParam,
    disconnectNode,
  } from "./graphStore.svelte.js";
  import CurveEditor from "./CurveEditor.svelte";
  import GradientEditor from "./GradientEditor.svelte";
  import TextureUpload from "./TextureUpload.svelte";
  import GeometryPicker from "./GeometryPicker.svelte";
  import SdfPicker from "./SdfPicker.svelte";
  import EmitterRefPicker from "./EmitterRefPicker.svelte";

  const node = $derived(graphStore.nodes.find((n) => n.id === graphStore.selectedId));
  const spec = $derived(node ? getSpec(node.data.type) : undefined);

  // ── Param readers (with safe fallback to spec defaults) ──────────────────

  function readNum(field: Field, fallback: number): number {
    const v = node?.data.params[field.key];
    return typeof v === "number" ? v : fallback;
  }
  function readRange(field: Field, fallback: [number, number]): [number, number] {
    const v = node?.data.params[field.key];
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      return [v[0], v[1]];
    }
    return fallback;
  }
  function readVec3(field: Field, fallback: [number, number, number]): [number, number, number] {
    const v = node?.data.params[field.key];
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      typeof v[0] === "number" &&
      typeof v[1] === "number" &&
      typeof v[2] === "number"
    ) {
      return [v[0], v[1], v[2]];
    }
    return fallback;
  }
  function readSelect(field: Field, fallback: string): string {
    const v = node?.data.params[field.key];
    return typeof v === "string" ? v : fallback;
  }
  function readShape(fallback: EmissionShape): EmissionShape {
    const v = node?.data.params["shape"];
    if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v) return v as EmissionShape;
    return fallback;
  }
  function readCurveKeys(field: Field, fallback: CurveKey[]): CurveKey[] {
    const v = node?.data.params[field.key];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "kind" in v &&
      v.kind === "curve1d" &&
      Array.isArray(v.keys)
    ) {
      return v.keys;
    }
    return fallback;
  }
  function readGradientStops(field: Field, fallback: GradientStopJSON[]): GradientStopJSON[] {
    const v = node?.data.params[field.key];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "kind" in v &&
      v.kind === "gradient" &&
      Array.isArray(v.stops)
    ) {
      return v.stops;
    }
    return fallback;
  }
  function readTexture(field: Field): TextureRef | undefined {
    const v = node?.data.params[field.key];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "kind" in v &&
      v.kind === "texture" &&
      typeof v.dataUrl === "string"
    ) {
      return v;
    }
    return undefined;
  }
  function readGeometry(field: Field, fallback: GeometryRef): GeometryRef {
    const v = node?.data.params[field.key];
    if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "geometry") {
      return v;
    }
    return fallback;
  }
  function readSdf(field: Field, fallback: SdfRef): SdfRef {
    const v = node?.data.params[field.key];
    if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "sdf") {
      return v;
    }
    return fallback;
  }
  function readEmitterRef(field: Field): EmitterRef {
    const v = node?.data.params[field.key];
    if (v && typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "emitter-ref") {
      return v;
    }
    return { kind: "emitter-ref", nodeId: undefined };
  }
  function setTexture(key: string, value: TextureRef | undefined): void {
    if (!node) return;
    const params = { ...node.data.params };
    if (value) params[key] = value;
    else delete params[key];
    // updateNodeParam expects a single key/value; replace the whole node here.
    graphStore.nodes = graphStore.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, params } } : n,
    );
  }

  function set(key: string, value: ParamValue): void {
    if (!node) return;
    updateNodeParam(node.id, key, value);
  }

  // ── Color helpers (HTML <input type="color"> uses #rrggbb hex) ───────────

  function toHex(rgb: [number, number, number]): string {
    const c = (n: number): string =>
      Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
  }
  function fromHex(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
  }

  // ── Shape-builder transitions: when the user picks a new kind, fill in the
  // canonical defaults for that kind so the inspector immediately renders the
  // right knobs. (Keeps prior radius/thickness when switching between similar shapes.)
  function shapeOfKind(kind: EmissionShape["kind"], prev: EmissionShape): EmissionShape {
    // `radius` / `thickness` may be optional on some shape kinds (e.g. cone.radius is
    // `number | undefined`). Coerce defensively so the constructed shape never carries
    // an `undefined` where a `number` is required.
    const radius = "radius" in prev && typeof prev.radius === "number" ? prev.radius : 0.3;
    const thickness =
      "thickness" in prev && typeof prev.thickness === "number" ? prev.thickness : 1;
    switch (kind) {
      case "point":
        return { kind: "point" };
      case "sphere":
        return { kind: "sphere", radius, thickness };
      case "box":
        return { kind: "box", size: [0.5, 0.5, 0.5] };
      case "cone":
        return { kind: "cone", angle: 0.3 };
      case "ring":
        return { kind: "ring", radius, thickness: thickness ?? 0 };
      case "disc":
        return { kind: "disc", radius, thickness: thickness ?? 1 };
    }
  }

  function updateShape(patch: Partial<EmissionShape>): void {
    if (!node) return;
    const current = readShape({ kind: "sphere", radius: 0.3, thickness: 1 });
    const next = { ...current, ...patch } as EmissionShape;
    set("shape", next);
  }
</script>

<aside class="inspector">
  {#if !node || !spec}
    <p class="empty">Select a node to edit its parameters.</p>
  {:else}
    <header>
      <span class="badge" style="background:{spec.accent};">{spec.category}</span>
      <h2>{spec.label}</h2>
      <button
        class="disconnect"
        onclick={() => disconnectNode(node.id)}
        title="Remove all wires touching this node"
      >⌀</button>
      <button class="delete" onclick={() => removeNode(node.id)} title="Delete node">×</button>
    </header>

    {#if spec.fields.length === 0}
      <p class="empty">No parameters.</p>
    {:else}
      <div class="fields">
        {#each spec.fields as field (field.key)}
          <label>
            <span class="key">{field.label}</span>

            {#if field.kind === "number"}
              <input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step ?? 0.01}
                value={readNum(field, 0)}
                oninput={(e) => set(field.key, +(e.currentTarget as HTMLInputElement).value)}
              />
            {:else if field.kind === "range"}
              {@const r = readRange(field, [0, 1])}
              <div class="row two">
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 0.01}
                  value={r[0]}
                  oninput={(e) =>
                    set(field.key, [+(e.currentTarget as HTMLInputElement).value, r[1]])}
                />
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 0.01}
                  value={r[1]}
                  oninput={(e) =>
                    set(field.key, [r[0], +(e.currentTarget as HTMLInputElement).value])}
                />
              </div>
            {:else if field.kind === "vec3"}
              {@const v = readVec3(field, [0, 0, 0])}
              <div class="row three">
                <input
                  type="number"
                  step={field.step ?? 0.1}
                  value={v[0]}
                  oninput={(e) =>
                    set(field.key, [+(e.currentTarget as HTMLInputElement).value, v[1], v[2]])}
                />
                <input
                  type="number"
                  step={field.step ?? 0.1}
                  value={v[1]}
                  oninput={(e) =>
                    set(field.key, [v[0], +(e.currentTarget as HTMLInputElement).value, v[2]])}
                />
                <input
                  type="number"
                  step={field.step ?? 0.1}
                  value={v[2]}
                  oninput={(e) =>
                    set(field.key, [v[0], v[1], +(e.currentTarget as HTMLInputElement).value])}
                />
              </div>
            {:else if field.kind === "color"}
              {@const c = readVec3(field, [1, 1, 1])}
              <div class="row color">
                <input
                  type="color"
                  value={toHex(c)}
                  oninput={(e) =>
                    set(field.key, fromHex((e.currentTarget as HTMLInputElement).value))}
                />
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={4}
                  value={c[0]}
                  oninput={(e) =>
                    set(field.key, [+(e.currentTarget as HTMLInputElement).value, c[1], c[2]])}
                />
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={4}
                  value={c[1]}
                  oninput={(e) =>
                    set(field.key, [c[0], +(e.currentTarget as HTMLInputElement).value, c[2]])}
                />
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={4}
                  value={c[2]}
                  oninput={(e) =>
                    set(field.key, [c[0], c[1], +(e.currentTarget as HTMLInputElement).value])}
                />
              </div>
            {:else if field.kind === "select"}
              <select
                value={readSelect(field, field.options[0] ?? "")}
                onchange={(e) => set(field.key, (e.currentTarget as HTMLSelectElement).value)}
              >
                {#each field.options as opt (opt)}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if field.kind === "shape"}
              {@const sh = readShape({ kind: "sphere", radius: 0.3, thickness: 1 })}
              <select
                value={sh.kind}
                onchange={(e) => {
                  const k = (e.currentTarget as HTMLSelectElement).value as EmissionShape["kind"];
                  set(field.key, shapeOfKind(k, sh));
                }}
              >
                <option value="point">point</option>
                <option value="sphere">sphere</option>
                <option value="box">box</option>
                <option value="cone">cone</option>
                <option value="ring">ring</option>
                <option value="disc">disc</option>
              </select>

              {#if sh.kind === "sphere" || sh.kind === "ring" || sh.kind === "disc"}
                <label class="sub">
                  <span class="key">radius</span>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={sh.radius}
                    oninput={(e) =>
                      updateShape({ radius: +(e.currentTarget as HTMLInputElement).value })}
                  />
                </label>
                <label class="sub">
                  <span class="key">thickness (0 surface · 1 solid)</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sh.thickness ?? 1}
                    oninput={(e) =>
                      updateShape({ thickness: +(e.currentTarget as HTMLInputElement).value })}
                  />
                </label>
              {:else if sh.kind === "cone"}
                <label class="sub">
                  <span class="key">angle (rad)</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.PI / 2}
                    step={0.05}
                    value={sh.angle}
                    oninput={(e) =>
                      updateShape({ angle: +(e.currentTarget as HTMLInputElement).value })}
                  />
                </label>
              {:else if sh.kind === "box"}
                <div class="row three sub">
                  <input
                    type="number"
                    step={0.1}
                    value={sh.size[0]}
                    oninput={(e) =>
                      updateShape({
                        size: [
                          +(e.currentTarget as HTMLInputElement).value,
                          sh.size[1],
                          sh.size[2],
                        ],
                      })}
                  />
                  <input
                    type="number"
                    step={0.1}
                    value={sh.size[1]}
                    oninput={(e) =>
                      updateShape({
                        size: [
                          sh.size[0],
                          +(e.currentTarget as HTMLInputElement).value,
                          sh.size[2],
                        ],
                      })}
                  />
                  <input
                    type="number"
                    step={0.1}
                    value={sh.size[2]}
                    oninput={(e) =>
                      updateShape({
                        size: [
                          sh.size[0],
                          sh.size[1],
                          +(e.currentTarget as HTMLInputElement).value,
                        ],
                      })}
                  />
                </div>
              {/if}
            {:else if field.kind === "curve"}
              {@const keys = readCurveKeys(field, [{ t: 0, v: 1 }, { t: 1, v: 0 }])}
              <CurveEditor
                {keys}
                onUpdate={(next: CurveKey[]) => set(field.key, { kind: "curve1d", keys: next })}
              />
            {:else if field.kind === "gradient"}
              {@const stops = readGradientStops(field, [
                { t: 0, color: [1, 1, 1, 1] },
                { t: 1, color: [1, 0.4, 0.1, 0] },
              ])}
              <GradientEditor
                {stops}
                onUpdate={(next: GradientStopJSON[]) =>
                  set(field.key, { kind: "gradient", stops: next })}
              />
            {:else if field.kind === "texture"}
              <TextureUpload
                value={readTexture(field)}
                optional={field.optional}
                onUpdate={(next: TextureRef | undefined) => setTexture(field.key, next)}
              />
            {:else if field.kind === "geometry"}
              {@const g = readGeometry(field, {
                kind: "geometry",
                preset: "sphere",
                radius: 0.5,
                widthSegments: 32,
                heightSegments: 16,
              })}
              <GeometryPicker
                value={g}
                onUpdate={(next: GeometryRef) => set(field.key, next)}
              />
            {:else if field.kind === "sdf"}
              {@const s = readSdf(field, {
                kind: "sdf",
                preset: "sphere",
                center: [0, 0, 0],
                radius: 1,
              })}
              <SdfPicker
                value={s}
                onUpdate={(next: SdfRef) => set(field.key, next)}
              />
            {:else if field.kind === "emitter-ref"}
              <EmitterRefPicker
                value={readEmitterRef(field)}
                selfId={node.id}
                onUpdate={(next: EmitterRef) => set(field.key, next)}
              />
            {:else if field.kind === "boolean"}
              <input
                type="checkbox"
                checked={node.data.params[field.key] === true}
                onchange={(e) => set(field.key, (e.currentTarget as HTMLInputElement).checked)}
              />
            {/if}
          </label>
        {/each}
      </div>
    {/if}
  {/if}
</aside>

<style>
  .inspector {
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    background: #14161b;
    border-left: 1px solid #2a2c33;
    color: #e7e7e9;
    font: 13px/1.3 system-ui, sans-serif;
  }
  .empty {
    color: #888;
    font-style: italic;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2a2c33;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #fff;
    padding: 2px 6px;
    border-radius: 4px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
  }
  .delete,
  .disconnect {
    background: transparent;
    border: 1px solid #2a2c33;
    color: #aaa;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .delete {
    font-size: 16px;
  }
  .delete:hover {
    background: #3a1e1e;
    color: #fff;
    border-color: #6a2e2e;
  }
  .disconnect:hover {
    background: #1e2c3a;
    color: #fff;
    border-color: #2c5b8c;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sub {
    margin-top: 6px;
  }
  .key {
    font-size: 11px;
    color: #a0a4ad;
    letter-spacing: 0.04em;
  }
  input,
  select {
    background: #1c1f26;
    color: #e7e7e9;
    border: 1px solid #2a2c33;
    border-radius: 4px;
    padding: 4px 6px;
    font: inherit;
  }
  input[type="color"] {
    padding: 0;
    width: 32px;
    height: 26px;
  }
  .row {
    display: grid;
    gap: 4px;
  }
  .row.two {
    grid-template-columns: 1fr 1fr;
  }
  .row.three {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .row.color {
    grid-template-columns: 32px 1fr 1fr 1fr;
    align-items: center;
  }
</style>
