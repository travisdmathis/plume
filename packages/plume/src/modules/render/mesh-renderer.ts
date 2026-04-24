import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type NodeMaterial from "three/src/materials/nodes/NodeMaterial.js";
import type Node from "three/src/nodes/core/Node.js";
import {
  Fn,
  cos,
  float,
  hash,
  instanceIndex,
  normalLocal,
  positionLocal,
  sin,
  vec3,
} from "three/tsl";

import type { ParticleStorage } from "../../particle-buffer.js";
import type { ModuleJSON, RenderContext, RenderModule } from "../module.js";
import { registerModule } from "../registry.js";

export interface MeshRendererParams {
  /** Geometry instanced per particle. */
  geometry: THREE.BufferGeometry;
  /**
   * Material applied to every instance. MUST be a `NodeMaterial` (MeshBasicNodeMaterial,
   * MeshStandardNodeMaterial, etc.) — this renderer overrides its `positionNode` and
   * `normalNode`. If omitted, a default unlit white material is used.
   */
  material?: NodeMaterial;
  renderOrder?: number;
  id?: string;
}

/**
 * Mesh particle renderer — each particle draws an instance of `geometry` with its own
 * 3-axis rotation derived from the slot index (deterministic hash), combined with the
 * per-particle angle (stored) and angular velocity (stored, integrated each frame).
 *
 * The rotation axis is constant per slot — meaning a given ring-buffer slot always tumbles
 * around the same axis regardless of which particle currently occupies it. Across slots, the
 * axis is pseudorandom, giving an organic tumble spread when many particles spawn at once.
 *
 * Normal rotation is applied via `normalNode` override so lighting on `MeshStandardNodeMaterial`
 * etc. is correct under arbitrary rotation. Dead particles collapse to zero scale.
 */
export class MeshRenderer implements RenderModule {
  static readonly type = "render.mesh";
  readonly kind = "render" as const;
  readonly type = MeshRenderer.type;
  readonly id?: string;

  readonly object3D: THREE.Group;

  private _geometry: THREE.BufferGeometry;
  private _material: NodeMaterial;
  private _mesh?: THREE.InstancedMesh;
  private _renderOrder: number;
  private _ownsMaterial: boolean;

  constructor(params: MeshRendererParams) {
    this._geometry = params.geometry;
    this._renderOrder = params.renderOrder ?? 0;
    this.id = params.id;

    if (params.material) {
      this._material = params.material;
      this._ownsMaterial = false;
    } else {
      this._material = new MeshBasicNodeMaterial({ color: 0xffffff });
      this._ownsMaterial = true;
    }

    this.object3D = new THREE.Group();
    this.object3D.frustumCulled = false;
    this.object3D.matrixAutoUpdate = false;
    this.object3D.renderOrder = this._renderOrder;
  }

  init(storage: ParticleStorage, capacity: number): void {
    const mat = this._material;

    // Derive a stable, pseudorandom axis per slot. Using slot index (not seed) keeps the axis
    // constant for a slot across ring-buffer reuses — visually indistinguishable from fully
    // randomized axes when many particles are alive.
    const axisNode = (): Node<"vec3"> => {
      const idxF = float(instanceIndex);
      const s = idxF.mul(7919.11);
      const ax = hash(s).sub(0.5);
      const ay = hash(s.add(1)).sub(0.5);
      const az = hash(s.add(2)).sub(0.5);
      return vec3(ax, ay, az).normalize();
    };

    // Rodrigues' rotation formula: rotate vector `v` around unit-axis `axis` by angle (cosA, sinA).
    //   R(a, θ) v = v·cosθ + (a×v)·sinθ + a·(a·v)·(1-cosθ)
    const rotateByAxisAngle = (
      v: Node<"vec3">,
      axis: Node<"vec3">,
      cosA: Node<"float">,
      sinA: Node<"float">,
    ): Node<"vec3"> => {
      const oneMinusCos = float(1).sub(cosA);
      const term1 = v.mul(cosA);
      const term2 = axis.cross(v).mul(sinA);
      const term3 = axis.mul(axis.dot(v)).mul(oneMinusCos);
      return term1.add(term2).add(term3);
    };

    mat.positionNode = Fn(() => {
      const posAlive = storage.posAlive.element(instanceIndex).toVar();
      const traits = storage.traits.element(instanceIndex).toVar();
      const particlePos = posAlive.xyz;
      const alive = posAlive.w;
      const scale = traits.x;
      const rotation = traits.y;

      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      const rotated = rotateByAxisAngle(positionLocal, axis, cosA, sinA);

      const effScale = scale.mul(alive);
      return particlePos.add(rotated.mul(effScale));
    })();

    mat.normalNode = Fn(() => {
      const traits = storage.traits.element(instanceIndex).toVar();
      const rotation = traits.y;
      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      return rotateByAxisAngle(normalLocal, axis, cosA, sinA);
    })();

    const mesh = new THREE.InstancedMesh(this._geometry, this._material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this._renderOrder;

    this._mesh = mesh;
    this.object3D.add(mesh);
  }

  updateRender(liveCount: number, _ctx: RenderContext): void {
    if (!this._mesh) return;
    this._mesh.count = liveCount;
    this.object3D.visible = liveCount > 0;
  }

  dispose(): void {
    this._mesh?.dispose();
    if (this._ownsMaterial) this._material.dispose();
  }

  toJSON(): ModuleJSON {
    return {
      type: MeshRenderer.type,
      id: this.id,
      renderOrder: this._renderOrder,
    };
  }

  static fromJSON(_data: ModuleJSON): MeshRenderer {
    throw new Error("MeshRenderer cannot be deserialized without geometry + material refs.");
  }
}

registerModule(MeshRenderer);
