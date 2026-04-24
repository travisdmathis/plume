import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  cameraProjectionMatrix,
  cos,
  float,
  instanceIndex,
  modelViewMatrix,
  positionLocal,
  sin,
  spritesheetUV,
  texture,
  uint,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";

import type { ParticleStorage } from "../../particle-buffer.js";
import { attr } from "../../particle-buffer.js";
import type { ModuleJSON, RenderContext, RenderInitOptions, RenderModule } from "../module.js";
import { softCircleTexture } from "../../textures/procedural.js";
import { registerModule } from "../registry.js";

// Lower 10 bits of each `sortIndices` entry hold the original storage slot. Upper bits hold
// quantized view-space depth (used for the sort and discarded here). Must match the
// `SLOT_BITS` constant in emitter.ts.
const SLOT_MASK = (1 << 10) - 1;

export type SpriteBlendMode = "additive" | "alpha" | "normal";

/**
 * Sprite-sheet animation config. The provided texture is treated as a `cols × rows` grid of
 * frames. Each particle advances through frames during its lifetime according to `mode`:
 * - `"lifetime"` (default): frame = floor(age/lifetime × totalFrames), clamped to last frame.
 * - `"loop"`: frame = floor(age × fps) mod totalFrames.
 */
export interface SpriteAnimationParams {
  cols: number;
  rows: number;
  /** Playback mode. Default "lifetime". */
  mode?: "lifetime" | "loop";
  /** Frames per second for loop mode. Ignored in lifetime mode. Default 24. */
  fps?: number;
}

export interface SpriteRendererParams {
  blending?: SpriteBlendMode;
  texture?: THREE.Texture;
  opacity?: number;
  depthWrite?: boolean;
  depthTest?: boolean;
  renderOrder?: number;
  id?: string;
  textureRef?: string;
  /** Optional sprite-sheet animation. When set, the texture is treated as a frame grid. */
  animation?: SpriteAnimationParams;
}

/**
 * Instanced billboard sprite renderer on `MeshBasicNodeMaterial` + TSL + `THREE.InstancedMesh`.
 * Per-particle data is read from GPU storage via `storage.X.element(instanceIndex)` inside
 * the TSL vertex/fragment functions. Dead particles zero-scale to a degenerate quad.
 */
export class SpriteRenderer implements RenderModule {
  static readonly type = "render.sprite";
  readonly kind = "render" as const;
  readonly type = SpriteRenderer.type;
  readonly id?: string;

  blending: SpriteBlendMode;
  opacity: number;
  depthWrite: boolean;
  depthTest: boolean;
  renderOrder: number;
  textureRef?: string;
  animation?: SpriteAnimationParams;

  readonly object3D: THREE.Group;

  private _mesh?: THREE.InstancedMesh;
  private _geometry?: THREE.BufferGeometry;
  private _material?: MeshBasicNodeMaterial;
  private _texture: THREE.Texture;
  private _ownsTexture: boolean;
  private _setOpacity: (v: number) => void = () => {};

  constructor(params: SpriteRendererParams = {}) {
    this.blending = params.blending ?? "additive";
    this.opacity = params.opacity ?? 1;
    this.depthWrite = params.depthWrite ?? false;
    this.depthTest = params.depthTest ?? true;
    this.renderOrder = params.renderOrder ?? 0;
    this.id = params.id;
    this.textureRef = params.textureRef;
    this.animation = params.animation;

    if (params.texture) {
      this._texture = params.texture;
      this._ownsTexture = false;
    } else {
      this._texture = softCircleTexture(64);
      this._ownsTexture = false;
    }

    this.object3D = new THREE.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this.renderOrder;
  }

  init(storage: ParticleStorage, capacity: number, opts?: RenderInitOptions): void {
    const geom = new THREE.BufferGeometry();
    const quadPos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    const quadUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    geom.setAttribute("position", new THREE.BufferAttribute(quadPos, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(quadUv, 2));
    geom.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: this.depthWrite,
      depthTest: this.depthTest,
      blending: this._resolveBlending(),
    });
    material.toneMapped = false;

    const texNode = texture(this._texture);
    const opacityUniform = uniform(this.opacity, "float");
    this._setOpacity = (v) => {
      opacityUniform.value = v;
    };

    // Vertex: read per-instance, billboard to camera, zero-scale if dead
    const sortIndices = opts?.sortIndices;

    material.vertexNode = Fn(() => {
      // If the emitter is depth-sorted, indirect through the sort index: draw-order slot
      // `instanceIndex` → actual particle slot is `sortIndices[instanceIndex]`. Otherwise read
      // the storage directly by `instanceIndex`. Both paths produce a vec4 load + swizzle.
      const effectiveIdx: Node<"int"> = sortIndices
        ? sortIndices.element(instanceIndex).bitAnd(uint(SLOT_MASK)).toInt()
        : instanceIndex.toInt();
      const posAlive = storage.posAlive.element(effectiveIdx).toVar();
      const traits = storage.traits.element(effectiveIdx).toVar();
      const pos = posAlive.xyz;
      const aliveFlag = posAlive.w;
      const scale = traits.x;
      const rotation = traits.y;

      const mvCenter = modelViewMatrix.mul(vec4(pos, 1.0));
      const c = cos(rotation);
      const s = sin(rotation);
      const effectiveScale = scale.mul(aliveFlag);
      const scaled = positionLocal.xy.mul(effectiveScale);
      const offsetX = scaled.x.mul(c).sub(scaled.y.mul(s));
      const offsetY = scaled.x.mul(s).add(scaled.y.mul(c));
      const mvFinal = mvCenter.add(vec4(offsetX, offsetY, 0, 0));
      return cameraProjectionMatrix.mul(mvFinal);
    })();

    const animation = this.animation;
    material.colorNode = Fn(() => {
      const effectiveIdx: Node<"int"> = sortIndices
        ? sortIndices.element(instanceIndex).bitAnd(uint(SLOT_MASK)).toInt()
        : instanceIndex.toInt();
      const col = storage.color.element(effectiveIdx).toVar();
      let sampleUv: Node<"vec2"> = uv();
      if (animation) {
        const frameCount = animation.cols * animation.rows;
        const age = storage.velAge.element(effectiveIdx).w;
        const lifetime = storage.traits.element(effectiveIdx).w.max(0.0001);
        const frame =
          animation.mode === "loop"
            ? age.mul(animation.fps ?? 24)
            : age.div(lifetime).mul(frameCount).min(float(frameCount - 1));
        // spritesheetUV is typed as plain Node; at runtime it returns a vec2. Narrowing cast.
        sampleUv = spritesheetUV(vec2(animation.cols, animation.rows), uv(), frame) as unknown as Node<"vec2">;
      }
      const sampled = texNode.sample(sampleUv);
      const rgb = sampled.rgb.mul(col.rgb);
      const alpha = sampled.a.mul(col.a).mul(opacityUniform);
      return vec4(rgb, alpha);
    })();

    const mesh = new THREE.InstancedMesh(geom, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this.renderOrder;

    this._geometry = geom;
    this._material = material;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }

  private _resolveBlending(): THREE.Blending {
    switch (this.blending) {
      case "additive":
        return THREE.AdditiveBlending;
      case "alpha":
      case "normal":
        return THREE.NormalBlending;
    }
  }

  updateRender(liveCount: number, ctx: RenderContext): void {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this._setOpacity(this.opacity * ctx.intensity);
    this.object3D.visible = liveCount > 0;
  }

  dispose(): void {
    this._geometry?.dispose();
    this._material?.dispose();
    if (this._ownsTexture) this._texture?.dispose();
  }

  toJSON(): ModuleJSON {
    return {
      type: SpriteRenderer.type,
      id: this.id,
      blending: this.blending,
      opacity: this.opacity,
      depthWrite: this.depthWrite,
      depthTest: this.depthTest,
      renderOrder: this.renderOrder,
      textureRef: this.textureRef,
      animation: this.animation,
    };
  }

  static fromJSON(data: ModuleJSON): SpriteRenderer {
    return new SpriteRenderer({
      blending: data["blending"] as SpriteBlendMode | undefined,
      opacity: data["opacity"] as number | undefined,
      depthWrite: data["depthWrite"] as boolean | undefined,
      depthTest: data["depthTest"] as boolean | undefined,
      renderOrder: data["renderOrder"] as number | undefined,
      textureRef: data["textureRef"] as string | undefined,
      animation: data["animation"] as SpriteAnimationParams | undefined,
      id: data.id,
    });
  }
}

registerModule(SpriteRenderer);
