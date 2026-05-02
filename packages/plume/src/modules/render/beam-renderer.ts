import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cross,
  float,
  instanceIndex,
  modelViewMatrix,
  normalize,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";

import type { ParticleStorage } from "../../particle-buffer.js";
import type { ModuleJSON, RenderContext, RenderModule } from "../module.js";
import { registerModule } from "../registry.js";

export type BeamBlendMode = "additive" | "alpha" | "normal";

export interface BeamRendererParams {
  /** Beam half-width at its thickest. World units. Default 0.05. */
  width?: number;
  /** Blend mode. Default "additive". */
  blending?: BeamBlendMode;
  /** Global opacity. Default 1. */
  opacity?: number;
  /** three.js render order. Default 0. */
  renderOrder?: number;
  /**
   * If true, beam tapers from full width at the head (current position) to 0 at the tail
   * (spawn position). If false, uniform width. Default true.
   */
  taperToTail?: boolean;
  id?: string;
}

/**
 * Per-particle beam renderer — draws a camera-facing quad between each particle's spawn
 * position and its current position. Width tapers from head to tail by default.
 *
 * Uses `initialVelocity` + `age` to reconstruct the spawn position: `spawn = pos - vel * age`
 * — works cleanly for ballistic particles (just gravity/drag). For particles with strong
 * non-ballistic forces (turbulence, curl noise) the tail lags the actual path; for those,
 * use `RibbonRenderer` which traces the real path via a history buffer.
 *
 * This matches Unity's "Line" particle render mode — great for lasers, bullet trails, sparks.
 */
export class BeamRenderer implements RenderModule {
  static readonly type = "render.beam";
  readonly kind = "render" as const;
  readonly type = BeamRenderer.type;
  readonly id?: string;

  readonly object3D: THREE.Group;
  width: number;
  opacity: number;

  private _blending: BeamBlendMode;
  private _renderOrder: number;
  private _taper: boolean;

  private _uWidth = uniform(0.05, "float");
  private _uOpacity = uniform(1, "float");

  private _geometry?: THREE.BufferGeometry;
  private _material?: MeshBasicNodeMaterial;
  private _mesh?: THREE.InstancedMesh;

  constructor(params: BeamRendererParams = {}) {
    this.width = params.width ?? 0.05;
    this.opacity = params.opacity ?? 1;
    this._blending = params.blending ?? "additive";
    this._renderOrder = params.renderOrder ?? 0;
    this._taper = params.taperToTail ?? true;
    this.id = params.id;

    this._uWidth.value = this.width;
    this._uOpacity.value = this.opacity;

    this.object3D = new THREE.Group();
    this.object3D.matrixAutoUpdate = false;
    this.object3D.frustumCulled = false;
    this.object3D.renderOrder = this._renderOrder;
  }

  init(storage: ParticleStorage, capacity: number): void {
    this._geometry = this._buildGeometry();
    this._material = this._buildMaterial(storage);
    const mesh = new THREE.InstancedMesh(this._geometry, this._material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this._renderOrder;
    this._mesh = mesh;
    this.object3D.add(mesh);
  }

  updateRender(liveCount: number, ctx: RenderContext): void {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this._uWidth.value = this.width;
    this._uOpacity.value = this.opacity * ctx.intensity;
    this.object3D.visible = liveCount > 0;
  }

  dispose(): void {
    this._geometry?.dispose();
    this._material?.dispose();
  }

  toJSON(): ModuleJSON {
    return {
      type: BeamRenderer.type,
      id: this.id,
      width: this.width,
      opacity: this.opacity,
      blending: this._blending,
      renderOrder: this._renderOrder,
      taperToTail: this._taper,
    };
  }

  static fromJSON(data: ModuleJSON): BeamRenderer {
    return new BeamRenderer({
      width: data["width"] as number | undefined,
      opacity: data["opacity"] as number | undefined,
      blending: data["blending"] as BeamBlendMode | undefined,
      renderOrder: data["renderOrder"] as number | undefined,
      taperToTail: data["taperToTail"] as boolean | undefined,
      id: data.id,
    });
  }

  // ────────────────────────────────────────────────────────────────────────

  private _buildGeometry(): THREE.BufferGeometry {
    // Four vertices forming a quad: (side=-1, end=0), (+1, 0), (+1, 1), (-1, 1).
    // `end=0` vertices map to tail (spawn position), `end=1` to head (current position).
    const positions = new Float32Array(4 * 3); // unused; shader computes in clip space
    const sides = new Float32Array([-1, 1, 1, -1]);
    const ends = new Float32Array([0, 0, 1, 1]);
    const indices = [0, 1, 2, 0, 2, 3];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("beamSide", new THREE.BufferAttribute(sides, 1));
    geom.setAttribute("beamEnd", new THREE.BufferAttribute(ends, 1));
    geom.setIndex(indices);
    return geom;
  }

  private _buildMaterial(storage: ParticleStorage): MeshBasicNodeMaterial {
    const uWidth = this._uWidth;
    const uOpacity = this._uOpacity;
    const taperEnabled = this._taper;

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: this._resolveBlending(),
    });
    mat.toneMapped = false;

    // Varying from vertex to fragment — taper factor (0 at tail → 1 at head) and instance color.
    const vTaper = varying(float(0), "vBeamTaper");
    const vColor = varying(vec4(1, 1, 1, 1), "vBeamColor");

    mat.vertexNode = Fn(() => {
      const i = instanceIndex.toInt();
      const end = attribute<"float">("beamEnd", "float");
      const side = attribute<"float">("beamSide", "float");

      // Read particle state.
      const posAlive = storage.posAlive.element(i).toVar();
      const velAge = storage.velAge.element(i).toVar();
      const initVelSize = storage.initVelSize.element(i).toVar();
      const traits = storage.traits.element(i).toVar();

      const head = posAlive.xyz;
      const alive = posAlive.w;
      const age = velAge.w;
      const initVel = initVelSize.xyz;
      const rotation = traits.y;

      // Spawn position = current - initialVelocity * age. Approximate for non-ballistic paths.
      const tail = head.sub(initVel.mul(age));

      // end=0 → at tail; end=1 → at head. Interpolate world position.
      const centerPos = tail.add(head.sub(tail).mul(end));

      // Beam direction (normalized) and camera-facing perpendicular for width.
      const axisDir = normalize(head.sub(tail).add(vec3(0.00001, 0, 0.00001)));
      const viewDir = normalize(cameraPosition.sub(centerPos));
      const perp = normalize(cross(axisDir, viewDir));

      // Taper: width at head = full, at tail = 0 (or full if taper disabled).
      const taperFactor: Node<"float"> = taperEnabled ? end : float(1);
      const halfWidth = uWidth.mul(taperFactor).mul(0.5).mul(alive);

      // Optional roll around the beam axis — rotation trait reused as a twist angle.
      // Simple two-axis offset: base perp + small roll using cross product recipe.
      void rotation; // reserved for future twist support

      const finalPos = centerPos.add(perp.mul(side).mul(halfWidth));
      vTaper.assign(taperFactor);
      vColor.assign(storage.color.element(i));

      return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(finalPos, 1.0)));
    })();

    mat.colorNode = Fn(() => {
      const base = vColor;
      const alpha = base.a.mul(vTaper).mul(uOpacity);
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

registerModule(BeamRenderer);
