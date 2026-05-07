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
   * MeshStandardNodeMaterial, etc.).
   *
   * The renderer needs to override `positionNode` / `normalNode` to apply per-particle
   * world-space transforms. To preserve user-supplied vertex deformation, the renderer
   * COMPOSES with the previous values when present: if you set `material.positionNode`
   * before passing it in, your custom local-space position is read first and then placed +
   * rotated by the particle transform. Same applies for `normalNode`. This means a custom
   * standard material with vertex animation, displacement, etc. works unchanged through the
   * renderer — your shading is intact, plus per-particle motion.
   *
   * If omitted, a default unlit white material is used.
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
    const mat = this._material as NodeMaterial & {
      positionNode?: Node<"vec3"> | null;
      normalNode?: Node<"vec3"> | null;
      colorNode?: Node | null;
    };

    // Capture the user's existing position/normal nodes BEFORE we override. If they set
    // `material.positionNode` to compute custom vertex deformation, our wrapper composes
    // with it: read user's local-space position first, then transform by particle.
    const userPositionNode: Node<"vec3"> | null = mat.positionNode ?? null;
    const userNormalNode: Node<"vec3"> | null = mat.normalNode ?? null;
    const userColorNode: Node | null = mat.colorNode ?? null;

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

      // Source position in object-local space — user's custom nodeMaterial.positionNode if
      // set (e.g. vertex displacement), otherwise the geometry's `position` attribute.
      const localSource: Node<"vec3"> = userPositionNode ?? positionLocal;

      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      const rotated = rotateByAxisAngle(localSource, axis, cosA, sinA);

      const effScale = scale.mul(alive);
      return particlePos.add(rotated.mul(effScale));
    })();

    mat.normalNode = Fn(() => {
      const traits = storage.traits.element(instanceIndex).toVar();
      const rotation = traits.y;
      const axis = axisNode();
      const cosA = cos(rotation);
      const sinA = sin(rotation);
      // Source normal — user's custom normal if set, else geometry's `normal` attribute.
      const localNormal: Node<"vec3"> = userNormalNode ?? normalLocal;
      return rotateByAxisAngle(localNormal, axis, cosA, sinA);
    })();

    if (!userColorNode) {
      mat.colorNode = Fn(() => storage.color.element(instanceIndex).rgb)();
    }

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
