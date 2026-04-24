import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";
import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import type { WebGPURenderer } from "three/webgpu";
import {
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cross,
  float,
  instanceIndex,
  instancedArray,
  modelViewMatrix,
  normalize,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";

import type { ParticleStorage } from "../../particle-buffer.js";
import { attr } from "../../particle-buffer.js";
import type { ModuleJSON, RenderContext, RenderModule } from "../module.js";
import { registerModule } from "../registry.js";

export type RibbonBlendMode = "additive" | "alpha" | "normal";

export interface RibbonRendererParams {
  /** Number of history points retained per particle (ribbon length). Default 32. */
  historyLength?: number;
  /** Ribbon half-width at head (world units). Tapers linearly to 0 at the tail. */
  width?: number;
  /** Blend mode. Default "additive". */
  blending?: RibbonBlendMode;
  /** Global opacity multiplier. */
  opacity?: number;
  /** Explicit three.js renderOrder for sorting. */
  renderOrder?: number;
  id?: string;
}

/**
 * Per-particle trail/ribbon renderer. Each particle leaves a history of positions over the
 * last N frames; the ribbon is drawn as a camera-facing triangle strip through those points,
 * tapering in width and alpha from head to tail.
 *
 * Implementation:
 *  - A `capacity × N` vec4 history buffer stores (pos.xyz, age) per slot.
 *  - A per-frame compute kernel (dispatched via the Emitter's `postUpdate` hook) writes each
 *    alive particle's current position into `history[idx × N + head]` where `head` cycles
 *    through [0, N) each frame.
 *  - The ribbon geometry is a static (2N)-vertex triangle strip per instance. Each vertex
 *    carries `historySlot ∈ [0, N)` and `side ∈ {-1, +1}` as attributes; the vertex shader
 *    maps historySlot → actual ring-buffer slot via the `head` uniform, reads the history
 *    point, computes a camera-facing tangent-perpendicular offset using the adjacent history
 *    point, and scales the offset by a head→tail taper.
 *  - Newly-spawned particles initially see stale history from the previous occupant of their
 *    ring-buffer slot. The shader checks `currentAge - historyAge` — if the delta is out of
 *    range (stale or "future"), the vertex collapses to the current position so no tail is drawn.
 */
export class RibbonRenderer implements RenderModule {
  static readonly type = "render.ribbon";
  readonly kind = "render" as const;
  readonly type = RibbonRenderer.type;
  readonly id?: string;

  readonly object3D: THREE.Group;
  readonly historyLength: number;
  width: number;
  opacity: number;

  private _blending: RibbonBlendMode;
  private _renderOrder: number;

  private _capacity = 0;
  private _history?: StorageBufferNode<"vec4">;
  private _writeKernel?: ComputeNode;

  private _uHead: UniformNode<"float", number>;
  private _uWidth: UniformNode<"float", number>;
  private _uOpacity: UniformNode<"float", number>;

  private _head = 0;
  private _geometry?: THREE.BufferGeometry;
  private _material?: MeshBasicNodeMaterial;
  private _mesh?: THREE.InstancedMesh;

  constructor(params: RibbonRendererParams = {}) {
    this.historyLength = Math.max(2, params.historyLength ?? 32);
    this.width = params.width ?? 0.1;
    this._blending = params.blending ?? "additive";
    this.opacity = params.opacity ?? 1;
    this._renderOrder = params.renderOrder ?? 0;
    this.id = params.id;

    this._uHead = uniform(0) as UniformNode<"float", number>;
    this._uWidth = uniform(this.width) as UniformNode<"float", number>;
    this._uOpacity = uniform(this.opacity) as UniformNode<"float", number>;

    this.object3D = new THREE.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this._renderOrder;
  }

  init(storage: ParticleStorage, capacity: number): void {
    this._capacity = capacity;
    const N = this.historyLength;

    this._history = instancedArray(capacity * N, "vec4");
    this._geometry = this._buildGeometry();
    this._writeKernel = this._buildWriteKernel(storage);
    this._material = this._buildMaterial(storage);

    const mesh = new THREE.InstancedMesh(this._geometry, this._material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this._renderOrder;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }

  postUpdate(renderer: WebGPURenderer, liveCount: number): void {
    if (!this._writeKernel) return;
    this._uHead.value = this._head;
    this._writeKernel.count = liveCount;
    void renderer.computeAsync(this._writeKernel);
    this._head = (this._head + 1) % this.historyLength;
  }

  updateRender(liveCount: number, ctx: RenderContext): void {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this._uOpacity.value = this.opacity * ctx.intensity;
    this._uWidth.value = this.width;
    this.object3D.visible = liveCount > 0;
  }

  dispose(): void {
    this._geometry?.dispose();
    this._material?.dispose();
  }

  toJSON(): ModuleJSON {
    return {
      type: RibbonRenderer.type,
      id: this.id,
      historyLength: this.historyLength,
      width: this.width,
      blending: this._blending,
      opacity: this.opacity,
      renderOrder: this._renderOrder,
    };
  }

  static fromJSON(data: ModuleJSON): RibbonRenderer {
    return new RibbonRenderer({
      historyLength: data["historyLength"] as number | undefined,
      width: data["width"] as number | undefined,
      blending: data["blending"] as RibbonBlendMode | undefined,
      opacity: data["opacity"] as number | undefined,
      renderOrder: data["renderOrder"] as number | undefined,
      id: data.id,
    });
  }

  // ────────────────────────────────────────────────────────────────────────

  private _buildGeometry(): THREE.BufferGeometry {
    const N = this.historyLength;
    const vertexCount = 2 * N;
    const positions = new Float32Array(vertexCount * 3);
    const slots = new Float32Array(vertexCount);
    const sides = new Float32Array(vertexCount);
    for (let k = 0; k < N; k++) {
      slots[2 * k] = k;
      slots[2 * k + 1] = k;
      sides[2 * k] = -1;
      sides[2 * k + 1] = 1;
    }
    const indices: number[] = [];
    for (let k = 0; k < N - 1; k++) {
      const a = 2 * k;
      const b = 2 * k + 1;
      const c = 2 * k + 2;
      const d = 2 * k + 3;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("ribbonSlot", new THREE.BufferAttribute(slots, 1));
    geom.setAttribute("ribbonSide", new THREE.BufferAttribute(sides, 1));
    geom.setIndex(indices);
    return geom;
  }

  private _buildWriteKernel(storage: ParticleStorage): ComputeNode {
    const history = this._history!;
    const N = this.historyLength;
    const uHead = this._uHead;
    return Fn(() => {
      const i = instanceIndex.toInt();
      const alive = attr.alive.read(storage, i);
      const pos = attr.position.read(storage, i);
      const age = attr.age.read(storage, i);
      // For dead particles we still write, but with a sentinel age (negative) so the render
      // shader rejects it.
      const sentinelAge = float(-1000);
      const isAlive = alive.greaterThanEqual(0.5);
      const finalAge = isAlive.select(age, sentinelAge);
      const slotIdx = float(i).mul(N).add(uHead).toInt();
      history.element(slotIdx).assign(vec4(pos, finalAge));
    })().compute(this._capacity);
  }

  private _buildMaterial(storage: ParticleStorage): MeshBasicNodeMaterial {
    const history = this._history!;
    const N = this.historyLength;
    const uHead = this._uHead;
    const uWidth = this._uWidth;
    const uOpacity = this._uOpacity;
    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: this._resolveBlending(),
    });
    mat.toneMapped = false;

    const vTaper = varying(float(0), "vRibbonTaper");
    const vColor = varying(vec4(1, 1, 1, 1), "vRibbonColor");
    const vStale = varying(float(0), "vRibbonStale");

    mat.vertexNode = Fn(() => {
      const pIdx = instanceIndex;
      const kLocal = attribute<"float">("ribbonSlot", "float").toVar();
      const side = attribute<"float">("ribbonSide", "float").toVar();

      // Map kLocal (0 = newest, N-1 = oldest) → actual ring-buffer slot.
      const headF = uHead;
      const actualSlotF = headF.sub(kLocal).add(float(N * 2)).mod(float(N));
      const pIdxF = float(pIdx);
      const slotIdx = pIdxF.mul(N).add(actualSlotF).toInt();

      const entry = history.element(slotIdx).toVar();
      const hPos = entry.xyz;
      const hAge = entry.w;

      // Adjacent (one step older) for tangent — clamp to last to avoid out-of-range at tail.
      const kNext = kLocal.add(1).min(float(N - 1));
      const nextSlotF = headF.sub(kNext).add(float(N * 2)).mod(float(N));
      const nextSlotIdx = pIdxF.mul(N).add(nextSlotF).toInt();
      const nextEntry = history.element(nextSlotIdx).toVar();
      const nextPos = nextEntry.xyz;

      const pI = pIdx.toInt();
      const currentPos = attr.position.read(storage, pI);
      const currentAge = attr.age.read(storage, pI);
      const alive = attr.alive.read(storage, pI);

      // Validity check — allow slots whose captured age is within (0, currentAge).
      // Slots from BEFORE this particle spawned have stale ages from previous occupants.
      const ageBack = currentAge.sub(hAge);
      const valid = alive
        .greaterThanEqual(0.5)
        .and(hAge.greaterThan(-0.5))
        .and(ageBack.greaterThan(0))
        .and(ageBack.lessThan(currentAge.add(0.001)));
      const validF = valid.select(float(1), float(0));

      // Head→tail taper (1 at newest, 0 at oldest), then mask by validity + alive.
      const taper = float(1).sub(kLocal.div(float(N - 1))).mul(validF).mul(alive);
      vTaper.assign(taper);
      vStale.assign(float(1).sub(validF));

      vColor.assign(attr.color.read(storage, pI));

      // Collapse stale slots to the particle's current position — makes stale triangles
      // zero-area degenerate so no fragments rasterize, eliminating the fade-in-from-stale
      // visual where interpolation of a stale-flag varying showed previous-particle trails.
      const effectivePos = hPos.mul(validF).add(currentPos.mul(float(1).sub(validF)));

      // Tangent along the trail.
      const dir = nextPos.sub(hPos);
      const tangent = normalize(dir.add(vec3(0.00001, 0, 0.00001)));
      const viewDir = normalize(cameraPosition.sub(effectivePos));
      const perp = normalize(cross(tangent, viewDir));

      const halfWidth = uWidth.mul(taper).mul(side).mul(0.5);
      const offsetPos = effectivePos.add(perp.mul(halfWidth));

      return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(offsetPos, 1.0)));
    })();

    mat.colorNode = Fn(() => {
      // Fragment alpha = baseColor.a * taper * opacity. Stale vertices contribute nothing.
      const base = vColor;
      const validMask = float(1).sub(vStale);
      const alpha = base.a.mul(vTaper).mul(uOpacity).mul(validMask);
      return vec4(base.rgb, alpha);
    })();

    return mat;
  }

  private _resolveBlending(): THREE.Blending {
    switch (this._blending) {
      case "additive":
        return THREE.AdditiveBlending;
      case "alpha":
      case "normal":
        return THREE.NormalBlending;
    }
  }
}

registerModule(RibbonRenderer);
