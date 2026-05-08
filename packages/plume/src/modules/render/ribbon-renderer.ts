import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type ComputeNode from "three/src/nodes/gpgpu/ComputeNode.js";
import type Node from "three/src/nodes/core/Node.js";
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
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import type { ParticleStorage } from "../../particle-buffer.js";
import { attr } from "../../particle-buffer.js";
import { Curve1D } from "../../math/curve.js";
import { Gradient } from "../../math/gradient.js";
import type { ColorTuple } from "../../types.js";
import type { ModuleJSON, RenderContext, RenderModule } from "../module.js";
import {
  buildTextureNodes,
  normalizeTextures,
  type ColorNodeContext,
  type ColorNodeFn,
  type TextureInput,
} from "../render-shading.js";
import { registerModule } from "../registry.js";

export type RibbonBlendMode = "additive" | "alpha" | "normal";

export interface RibbonLayerParams {
  /** Full strip width in world units. Defaults to the renderer `width`. */
  width?: number;
  /** Alpha multiplier for this layer. Defaults to the renderer `opacity`. */
  opacity?: number;
  /** HDR RGB multiplier for this layer. Defaults to white. */
  color?: ColorTuple;
}

export interface RibbonRendererParams {
  /** Number of history points retained per particle (ribbon length). Default 32. */
  historyLength?: number;
  /** Ribbon full width at the head (world units). Tapers to 0 at the tail by default. */
  width?: number;
  /** Blend mode. Default "additive". */
  blending?: RibbonBlendMode;
  /** Global opacity multiplier. */
  opacity?: number;
  /** Explicit three.js renderOrder for sorting. */
  renderOrder?: number;
  /** Whether ribbons depth-test against scene geometry. Default true. */
  depthTest?: boolean;
  /** Whether ribbons write depth. Default false. */
  depthWrite?: boolean;
  /** Camera-facing billboard strip. Default true. */
  faceCamera?: boolean;
  /** Maximum history writes per second. `0` or undefined records every tick. */
  sampleRate?: number;
  /** Minimum followed-target movement before recording another sample. Default 0. */
  minDistance?: number;
  /** Seconds a captured history point remains visible. Undefined = history-index based. */
  sampleLifetime?: number;
  /** Stop recording new samples after this emitter time. Useful for authored swing windows. */
  sampleUntil?: number;
  /** Full-width multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
  widthOverLife?: Curve1D;
  /** Alpha multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
  alphaOverLife?: Curve1D;
  /** Color multiplier over trail age, where 0 = newest/head and 1 = oldest/tail. */
  colorOverLife?: Gradient;
  /** Additive glow layers sharing the same trail history but using separate widths/colors. */
  layers?: RibbonLayerParams[];
  /**
   * Texture inputs. Pass a single `Texture` (gets the key `"base"`) or a multi-texture map
   * for layered shading. The first one supplied becomes the default-shader base sample.
   *
   * UV semantics in the fragment: `uv.x` runs 0..1 along the ribbon length (0 = newest /
   * head, 1 = oldest / tail), `uv.y` runs 0..1 across the strip width (0 = -side, 1 = +side).
   * Combine with `time` in `colorNode` to scroll texture along the trail (lightning bolts,
   * energy beams, glowing magic).
   */
  textures?: TextureInput;
  /**
   * Custom fragment shader — replaces the default `vColor.rgb, vColor.a` computation before
   * ribbon masks, trail curves, and layer colors are applied.
   */
  colorNode?: ColorNodeFn;
  id?: string;
}

interface RibbonLayerState {
  width: number;
  opacity: number;
  color: ColorTuple;
  uWidth: UniformNode<"float", number>;
  uOpacity: UniformNode<"float", number>;
  uColor: UniformNode<"vec3", THREE.Vector3>;
  material?: MeshBasicNodeMaterial;
  mesh?: THREE.InstancedMesh;
}

/**
 * Per-particle trail/ribbon renderer. Each particle leaves a history of positions over the
 * last N samples; the ribbon is drawn as a camera-facing triangle strip through those points.
 *
 * Socket-following trails use a single live particle pinned by `FollowPosition`, while this
 * renderer records that particle into a fixed-size GPU history buffer with optional sample
 * rate, minimum-distance gating, lifetime-based fades, and multi-layer additive glow.
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
  sampleRate: number;
  minDistance: number;
  sampleLifetime?: number;
  sampleUntil?: number;

  private _blending: RibbonBlendMode;
  private _renderOrder: number;
  private _depthTest: boolean;
  private _depthWrite: boolean;
  private _faceCamera: boolean;
  private _textures: Record<string, THREE.Texture>;
  private _colorNode?: ColorNodeFn;
  private _widthOverLife?: Curve1D;
  private _alphaOverLife?: Curve1D;
  private _colorOverLife?: Gradient;
  private _hasCustomLayers: boolean;
  private _layers: RibbonLayerState[];

  private _capacity = 0;
  private _history?: StorageBufferNode<"vec4">;
  private _writeKernel?: ComputeNode;

  private _uHead: UniformNode<"float", number>;
  private _uSampleLifetime: UniformNode<"float", number>;
  private _uTime: UniformNode<"float", number>;

  private _head = 0;
  private _sampleAccum = Number.POSITIVE_INFINITY;
  private _geometry?: THREE.BufferGeometry;
  private _lastSamplePosition = new THREE.Vector3();
  private _pendingFollowPosition = new THREE.Vector3();
  private _hasLastSamplePosition = false;
  private _hasPendingFollowPosition = false;

  constructor(params: RibbonRendererParams = {}) {
    this.historyLength = Math.max(2, params.historyLength ?? 32);
    this.width = params.width ?? 0.1;
    this._blending = params.blending ?? "additive";
    this.opacity = params.opacity ?? 1;
    this._renderOrder = params.renderOrder ?? 0;
    this._depthTest = params.depthTest ?? true;
    this._depthWrite = params.depthWrite ?? false;
    this._faceCamera = params.faceCamera ?? true;
    this.sampleRate = Math.max(0, params.sampleRate ?? 0);
    this.minDistance = Math.max(0, params.minDistance ?? 0);
    this.sampleLifetime =
      params.sampleLifetime !== undefined ? Math.max(0, params.sampleLifetime) : undefined;
    this.sampleUntil = params.sampleUntil;
    this._textures = normalizeTextures(params.textures);
    this._colorNode = params.colorNode;
    this._widthOverLife = params.widthOverLife;
    this._alphaOverLife = params.alphaOverLife;
    this._colorOverLife = params.colorOverLife;
    this.id = params.id;

    this._hasCustomLayers = !!params.layers?.length;
    const sourceLayers = this._hasCustomLayers
      ? params.layers!
      : [{ width: this.width, opacity: this.opacity, color: [1, 1, 1] as ColorTuple }];
    this._layers = sourceLayers.map((layer) => {
      const width = layer.width ?? this.width;
      const opacity = layer.opacity ?? this.opacity;
      const color = layer.color ?? [1, 1, 1];
      return {
        width,
        opacity,
        color,
        uWidth: uniform(width) as UniformNode<"float", number>,
        uOpacity: uniform(opacity) as UniformNode<"float", number>,
        uColor: uniform(new THREE.Vector3(color[0], color[1], color[2])) as UniformNode<
          "vec3",
          THREE.Vector3
        >,
      };
    });

    this._uHead = uniform(0) as UniformNode<"float", number>;
    this._uSampleLifetime = uniform(this.sampleLifetime ?? 0) as UniformNode<"float", number>;
    this._uTime = uniform(0) as UniformNode<"float", number>;

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

    for (const layer of this._layers) {
      layer.material = this._buildMaterial(storage, layer);
      const mesh = new THREE.InstancedMesh(this._geometry, layer.material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = this._renderOrder;
      layer.mesh = mesh;
      this.object3D.add(mesh);
    }
  }

  reset(): void {
    this._head = 0;
    this._sampleAccum = Number.POSITIVE_INFINITY;
    this._hasLastSamplePosition = false;
    this._hasPendingFollowPosition = false;
    for (const layer of this._layers) {
      if (layer.mesh) layer.mesh.count = 0;
    }
    this.object3D.visible = false;
  }

  setFollowPosition(position: THREE.Vector3): void {
    this._pendingFollowPosition.copy(position);
    this._hasPendingFollowPosition = true;
  }

  postUpdate(
    renderer: WebGPURenderer,
    liveCount: number,
    deltaTime: number,
    emitterTime: number,
  ): void {
    if (!this._writeKernel) return;
    if (this.sampleUntil !== undefined && emitterTime > this.sampleUntil) return;
    if (!this._shouldRecordThisTick(deltaTime)) return;
    if (!this._passesMinDistance()) return;

    this._uHead.value = this._head;
    this._uSampleLifetime.value = this.sampleLifetime ?? 0;
    this._writeKernel.count = liveCount;
    void renderer.computeAsync(this._writeKernel);
    this._head = (this._head + 1) % this.historyLength;

    if (this._hasPendingFollowPosition) {
      this._lastSamplePosition.copy(this._pendingFollowPosition);
      this._hasLastSamplePosition = true;
    }
  }

  updateRender(liveCount: number, ctx: RenderContext): void {
    this._uTime.value = performance.now() / 1000;
    this._uSampleLifetime.value = this.sampleLifetime ?? 0;

    if (!this._hasCustomLayers && this._layers[0]) {
      this._layers[0].width = this.width;
      this._layers[0].opacity = this.opacity;
    }

    for (const layer of this._layers) {
      if (!layer.mesh) continue;
      layer.mesh.count = liveCount;
      layer.uWidth.value = layer.width;
      layer.uOpacity.value = layer.opacity * ctx.intensity;
      layer.uColor.value.set(layer.color[0], layer.color[1], layer.color[2]);
    }
    this.object3D.visible = liveCount > 0;
  }

  dispose(): void {
    this._geometry?.dispose();
    for (const layer of this._layers) layer.material?.dispose();
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
      depthTest: this._depthTest,
      depthWrite: this._depthWrite,
      faceCamera: this._faceCamera,
      sampleRate: this.sampleRate,
      minDistance: this.minDistance,
      sampleLifetime: this.sampleLifetime,
      sampleUntil: this.sampleUntil,
      widthOverLife: this._widthOverLife?.toJSON(),
      alphaOverLife: this._alphaOverLife?.toJSON(),
      colorOverLife: this._colorOverLife?.toJSON(),
      layers: this._hasCustomLayers
        ? this._layers.map((layer) => ({
            width: layer.width,
            opacity: layer.opacity,
            color: layer.color,
          }))
        : undefined,
      // textures + colorNode aren't serializable — caller must re-supply on fromJSON.
    };
  }

  static fromJSON(data: ModuleJSON): RibbonRenderer {
    return new RibbonRenderer({
      historyLength: data["historyLength"] as number | undefined,
      width: data["width"] as number | undefined,
      blending: data["blending"] as RibbonBlendMode | undefined,
      opacity: data["opacity"] as number | undefined,
      renderOrder: data["renderOrder"] as number | undefined,
      depthTest: data["depthTest"] as boolean | undefined,
      depthWrite: data["depthWrite"] as boolean | undefined,
      faceCamera: data["faceCamera"] as boolean | undefined,
      sampleRate: data["sampleRate"] as number | undefined,
      minDistance: data["minDistance"] as number | undefined,
      sampleLifetime: data["sampleLifetime"] as number | undefined,
      sampleUntil: data["sampleUntil"] as number | undefined,
      widthOverLife: data["widthOverLife"]
        ? Curve1D.fromJSON(data["widthOverLife"] as { keyframes: Curve1D["keyframes"] })
        : undefined,
      alphaOverLife: data["alphaOverLife"]
        ? Curve1D.fromJSON(data["alphaOverLife"] as { keyframes: Curve1D["keyframes"] })
        : undefined,
      colorOverLife: data["colorOverLife"]
        ? Gradient.fromJSON(data["colorOverLife"] as { stops: Gradient["stops"] })
        : undefined,
      layers: data["layers"] as RibbonLayerParams[] | undefined,
      id: data.id,
    });
  }

  // ────────────────────────────────────────────────────────────────────────

  private _shouldRecordThisTick(deltaTime: number): boolean {
    if (this.sampleRate <= 0) return true;
    if (!Number.isFinite(this._sampleAccum)) {
      this._sampleAccum = 0;
      return true;
    }
    const interval = 1 / this.sampleRate;
    this._sampleAccum += deltaTime;
    if (this._sampleAccum + 0.000001 < interval) return false;
    this._sampleAccum %= interval;
    return true;
  }

  private _passesMinDistance(): boolean {
    if (this.minDistance <= 0 || !this._hasPendingFollowPosition) return true;
    if (!this._hasLastSamplePosition) return true;
    return (
      this._pendingFollowPosition.distanceToSquared(this._lastSamplePosition) >=
      this.minDistance * this.minDistance
    );
  }

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

  private _buildMaterial(storage: ParticleStorage, layer: RibbonLayerState): MeshBasicNodeMaterial {
    const history = this._history!;
    const N = this.historyLength;
    const uHead = this._uHead;
    const uSampleLifetime = this._uSampleLifetime;
    const uTime = this._uTime;
    const textureNodes = buildTextureNodes(this._textures);
    const userColorNode = this._colorNode;
    const widthTex = this._widthOverLife ? texture(this._widthOverLife.getTexture()) : undefined;
    const alphaTex = this._alphaOverLife ? texture(this._alphaOverLife.getTexture()) : undefined;
    const colorTex = this._colorOverLife ? texture(this._colorOverLife.getTexture()) : undefined;
    const faceCamera = this._faceCamera;

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: this._depthWrite,
      depthTest: this._depthTest,
      blending: this._resolveBlending(),
    });
    mat.toneMapped = false;

    // Varyings: per-vertex values interpolated to the fragment.
    const vTaper = varying(float(0), "vRibbonTaper");
    const vStale = varying(float(0), "vRibbonStale");
    const vColor = varying(vec4(1, 1, 1, 1), "vRibbonColor");
    const vUv = varying(vec2(0, 0), "vRibbonUv");
    const vLifetimeT = varying(float(0), "vRibbonLifetimeT");
    const vTrailT = varying(float(0), "vRibbonTrailT");
    const vWorldPos = varying(vec3(0, 0, 0), "vRibbonWorldPos");
    const vSize = varying(float(0), "vRibbonSize");
    const vAlive = varying(float(0), "vRibbonAlive");
    const vAge = varying(float(0), "vRibbonAge");
    const vLifetime = varying(float(0), "vRibbonLifetime");

    mat.vertexNode = Fn(() => {
      const pIdx = instanceIndex;
      const kLocal = attribute<"float">("ribbonSlot", "float").toVar();
      const side = attribute<"float">("ribbonSide", "float").toVar();

      // Map kLocal (0 = newest, N-1 = oldest) -> actual ring-buffer slot.
      const headF = uHead;
      const actualSlotF = headF
        .sub(kLocal)
        .add(float(N * 2))
        .mod(float(N));
      const pIdxF = float(pIdx);
      const slotIdx = pIdxF.mul(N).add(actualSlotF).toInt();

      const entry = history.element(slotIdx).toVar();
      const hPos = entry.xyz;
      const hAge = entry.w;

      // Adjacent (one step older) for tangent — clamp to last to avoid out-of-range at tail.
      const kNext = kLocal.add(1).min(float(N - 1));
      const nextSlotF = headF
        .sub(kNext)
        .add(float(N * 2))
        .mod(float(N));
      const nextSlotIdx = pIdxF.mul(N).add(nextSlotF).toInt();
      const nextEntry = history.element(nextSlotIdx).toVar();
      const nextPos = nextEntry.xyz;

      const pI = pIdx.toInt();
      const currentPos = attr.position.read(storage, pI);
      const currentAge = attr.age.read(storage, pI);
      const lifetime = attr.lifetime.read(storage, pI);
      const alive = attr.alive.read(storage, pI);
      const sizeAttr = attr.size.read(storage, pI);

      const ageBack = currentAge.sub(hAge);
      const useLifetime = uSampleLifetime.greaterThan(0.0001);
      const indexT = kLocal.div(float(N - 1));
      const ageT = ageBack.div(uSampleLifetime.max(0.0001)).clamp(0, 1);
      const trailT = useLifetime.select(ageT, indexT).toVar();
      vTrailT.assign(trailT);

      const lifetimeLimit = useLifetime.select(uSampleLifetime.add(0.001), currentAge.add(0.001));
      const valid = alive
        .greaterThanEqual(0.5)
        .and(hAge.greaterThan(-0.5))
        .and(ageBack.greaterThanEqual(0))
        .and(ageBack.lessThan(lifetimeLimit));
      const validF = valid.select(float(1), float(0));

      let widthScale: Node<"float"> = float(1).sub(trailT);
      if (widthTex) widthScale = widthTex.sample(vec2(trailT, 0.5)).r;
      let alphaScale: Node<"float"> = float(1).sub(trailT);
      if (alphaTex) alphaScale = alphaTex.sample(vec2(trailT, 0.5)).r;

      const alphaMask = alphaScale.mul(validF).mul(alive);
      vTaper.assign(alphaMask);
      vStale.assign(float(1).sub(validF));

      vColor.assign(attr.color.read(storage, pI));
      vUv.assign(vec2(trailT, side.add(1).mul(0.5)));
      vLifetimeT.assign(currentAge.div(lifetime.max(0.0001)).clamp(0, 1));
      vAge.assign(currentAge);
      vLifetime.assign(lifetime);
      vSize.assign(sizeAttr);
      vAlive.assign(alive);

      const effectivePos = hPos.mul(validF).add(currentPos.mul(float(1).sub(validF)));
      vWorldPos.assign(effectivePos);

      const dir = nextPos.sub(hPos);
      const tangent = normalize(dir.add(vec3(0.00001, 0, 0.00001)));
      const viewDir = faceCamera ? normalize(cameraPosition.sub(effectivePos)) : vec3(0, 1, 0);
      const perp = normalize(cross(tangent, viewDir));

      const halfWidth = layer.uWidth.mul(widthScale).mul(validF).mul(alive).mul(side).mul(0.5);
      const offsetPos = effectivePos.add(perp.mul(halfWidth));

      return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(offsetPos, 1.0)));
    })();

    mat.colorNode = Fn(() => {
      const validMask = float(1).sub(vStale);
      const tailMask = vTaper.mul(validMask).mul(layer.uOpacity);

      const ctx: ColorNodeContext = {
        particle: {
          color: vColor,
          age: vAge,
          lifetime: vLifetime,
          lifetimeT: vLifetimeT,
          size: vSize,
          position: vWorldPos,
          alive: vAlive,
        },
        uv: vUv,
        textures: textureNodes,
        time: uTime,
      };

      let userOut: Node<"vec4">;
      if (userColorNode) {
        userOut = userColorNode(ctx);
      } else {
        const base = textureNodes.base;
        if (base) {
          const sampled = base.sample(vUv);
          userOut = vec4(sampled.rgb.mul(vColor.rgb), sampled.a.mul(vColor.a));
        } else {
          userOut = vColor;
        }
      }

      if (colorTex) {
        const gradient = colorTex.sample(vec2(vTrailT, 0.5));
        userOut = vec4(userOut.rgb.mul(gradient.rgb), userOut.a.mul(gradient.a));
      }

      return vec4(userOut.rgb.mul(layer.uColor), userOut.a.mul(tailMask));
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
