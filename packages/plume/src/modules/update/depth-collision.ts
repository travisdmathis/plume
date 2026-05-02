import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, cross, dot, float, normalize, texture, uniform, vec2, vec3, vec4 } from "three/tsl";

import type { ModuleJSON, ParticleUpdateModule, UpdateContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export type DepthCollisionMode = "kill" | "stop" | "bounce";
export type DepthCollisionNormal = "depth-gradient" | "camera";

export interface DepthCollisionParams {
  /**
   * A depth texture containing the current frame's scene depth. Caller is responsible for
   * rendering the scene into a render target whose `depthTexture` is this texture once per
   * frame BEFORE the `Manager.tick()` call. The module reads [0..1] values from it and
   * compares against each particle's projected NDC depth.
   */
  depthTexture: THREE.Texture;
  /** Camera used to render the depth pass. Matrices auto-sync from it in `beforeUpdate`. */
  camera: THREE.Camera;
  /**
   * How to respond when a particle is behind scene geometry.
   * - `"kill"`: set `alive = 0`, particle is immediately retired.
   * - `"stop"`: zero the velocity — particle freezes where it collided.
   * - `"bounce"` (default): reflect velocity using the surface normal, scaled by `restitution`
   *   (normal component) and `friction` (tangential component).
   */
  mode?: DepthCollisionMode;
  /**
   * How to derive the surface normal for `"bounce"`.
   * - `"depth-gradient"` (default): reconstruct per-particle from the depth texture using
   *   two finite-difference samples. Accurate for any surface orientation — rain splashes
   *   upward off the top of boxes, sideways off walls, etc.
   * - `"camera"`: assume the surface faces the camera. Cheap (3 fewer texture samples) but
   *   wrong for surfaces angled away from the camera.
   */
  normal?: DepthCollisionNormal;
  /** Bounce normal-component energy retention (0 = stick, 1 = perfect bounce). Default 0.5. */
  restitution?: number;
  /** Bounce tangential-component retention (1 = frictionless slide). Default 0.9. */
  friction?: number;
  /**
   * Tolerance in NDC-depth units for the behind-surface test. Positive values make the test
   * stricter (particle must be clearly behind). Tune up if Z-fighting causes false positives
   * on coplanar geometry. Default 0.0005.
   */
  thickness?: number;
  id?: string;
}

/**
 * Makes particles collide with rendered scene geometry by reading a depth texture.
 *
 * Flow each frame:
 *  1. Caller renders the scene's depth into `depthTexture` (a separate depth-only render pass).
 *  2. `beforeUpdate(camera)` syncs matrices and viewport size into uniforms.
 *  3. Inside the update kernel, each particle projects its world position to clip space, reads
 *     the depth-texture at the resulting UV, and compares particle-NDC-Z to sample-NDC-Z.
 *     A particle behind the sampled depth has gone into geometry → respond per `mode`.
 *
 * For `"bounce"` mode with `normal: "depth-gradient"` (the default), the module takes two
 * extra samples offset by one pixel in X and Y, unprojects each to world space, and takes
 * the cross product of the deltas — giving a surface normal correct for any orientation
 * (horizontal tops splash UP, walls bounce sideways). The `"camera"` normal mode skips those
 * samples for speed but only looks right on camera-facing surfaces.
 */
export class DepthCollision implements ParticleUpdateModule {
  static readonly type = "update.depth_collision";
  readonly kind = "particle_update" as const;
  readonly type = DepthCollision.type;
  readonly id?: string;

  mode: DepthCollisionMode;
  normal: DepthCollisionNormal;
  restitution: number;
  friction: number;
  thickness: number;
  camera: THREE.Camera;
  depthTexture: THREE.Texture;

  private _uViewProj: UniformNode<"mat4", THREE.Matrix4>;
  private _uInvViewProj: UniformNode<"mat4", THREE.Matrix4>;
  private _uCameraForward: UniformNode<"vec3", THREE.Vector3>;
  private _uTexelSize: UniformNode<"vec2", THREE.Vector2>;
  private _uRestitution: UniformNode<"float", number>;
  private _uFriction: UniformNode<"float", number>;
  private _uThickness: UniformNode<"float", number>;
  private _tmpDir = new THREE.Vector3();
  private _tmpMat = new THREE.Matrix4();

  constructor(params: DepthCollisionParams) {
    this.depthTexture = params.depthTexture;
    this.camera = params.camera;
    this.mode = params.mode ?? "bounce";
    this.normal = params.normal ?? "depth-gradient";
    this.restitution = params.restitution ?? 0.5;
    this.friction = params.friction ?? 0.9;
    this.thickness = params.thickness ?? 0.0005;
    this.id = params.id;

    this._uViewProj = uniform(new THREE.Matrix4()) as UniformNode<"mat4", THREE.Matrix4>;
    this._uInvViewProj = uniform(new THREE.Matrix4()) as UniformNode<"mat4", THREE.Matrix4>;
    this._uCameraForward = uniform(new THREE.Vector3(0, 0, -1)) as UniformNode<
      "vec3",
      THREE.Vector3
    >;
    this._uTexelSize = uniform(new THREE.Vector2(1 / 1920, 1 / 1080)) as UniformNode<
      "vec2",
      THREE.Vector2
    >;
    this._uRestitution = uniform(this.restitution) as UniformNode<"float", number>;
    this._uFriction = uniform(this.friction) as UniformNode<"float", number>;
    this._uThickness = uniform(this.thickness) as UniformNode<"float", number>;
  }

  beforeUpdate(_dt: number, _camera?: THREE.Camera): void {
    // Always use the camera configured on the module, not the Manager's default — depth was
    // rendered from this specific camera, so collision math must match.
    this.camera.updateMatrixWorld();
    this._uViewProj.value.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._tmpMat.copy(this._uViewProj.value).invert();
    this._uInvViewProj.value.copy(this._tmpMat);
    this.camera.getWorldDirection(this._tmpDir);
    this._uCameraForward.value.copy(this._tmpDir);
    // Depth texture's image dims — track in case the caller resized. THREE.DepthTexture stores
    // width/height on `.image.{width,height}`.
    const img = this.depthTexture.image as { width?: number; height?: number } | null;
    const w = img?.width ?? 1920;
    const h = img?.height ?? 1080;
    this._uTexelSize.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  contributeUpdateTSL(ctx: UpdateContext): void {
    const pos = attr.position.read(ctx.storage, ctx.i);
    const depthTex = texture(this.depthTexture);

    // Project world → clip → NDC.
    const clipPos = this._uViewProj.mul(vec4(pos, 1.0));
    const ndcW = clipPos.w.max(0.0001);
    const ndcX = clipPos.x.div(ndcW);
    const ndcY = clipPos.y.div(ndcW);
    const ndcZ = clipPos.z.div(ndcW);

    // NDC xy ∈ [-1, 1] → UV ∈ [0, 1], flipping Y for texture top-left-origin convention.
    const uvX = ndcX.mul(0.5).add(0.5);
    const uvY = ndcY.mul(-0.5).add(0.5);
    const sampleUv = vec2(uvX, uvY);

    const inBounds = uvX
      .greaterThan(0)
      .and(uvX.lessThan(1))
      .and(uvY.greaterThan(0))
      .and(uvY.lessThan(1))
      .and(ndcZ.greaterThan(0))
      .and(ndcZ.lessThan(1));

    const sceneDepth = depthTex.sample(sampleUv).r;
    const collided = inBounds.and(ndcZ.greaterThan(sceneDepth.add(this._uThickness)));

    If(collided, () => {
      if (this.mode === "kill") {
        attr.alive.write(ctx.storage, ctx.i, float(0));
      } else if (this.mode === "stop") {
        attr.velocity.write(ctx.storage, ctx.i, vec3(0, 0, 0));
      } else {
        // "bounce" mode — pick a normal based on `this.normal`. JS-level switch so the
        // kernel only compiles the chosen code path.
        const vel = attr.velocity.read(ctx.storage, ctx.i);
        const n =
          this.normal === "depth-gradient"
            ? this._reconstructNormal(depthTex, sampleUv, sceneDepth)
            : this._uCameraForward.negate();
        const vDotN = dot(vel, n);
        const vNormal = n.mul(vDotN);
        const vTangent = vel.sub(vNormal);
        // Standard reflection with restitution + friction.
        const reflected: Node<"vec3"> = vTangent
          .mul(this._uFriction)
          .sub(vNormal.mul(this._uRestitution));
        attr.velocity.write(ctx.storage, ctx.i, reflected);
      }
    });
  }

  /**
   * Reconstruct world-space surface normal at the sampled depth pixel by unprojecting three
   * points (center + one pixel in X + one pixel in Y) and taking the cross product. Ensures
   * the normal faces the camera (flips if not).
   */
  private _reconstructNormal(
    depthTex: ReturnType<typeof texture>,
    centerUv: Node<"vec2">,
    centerDepth: Node<"float">,
  ): Node<"vec3"> {
    const texel = this._uTexelSize;
    const invVP = this._uInvViewProj;

    // Neighbor UVs — one texel right and one texel down.
    const uvX = centerUv.x.add(texel.x);
    const uvY = centerUv.y.add(texel.y);
    const uvRight = vec2(uvX, centerUv.y);
    const uvDown = vec2(centerUv.x, uvY);

    const depthRight = depthTex.sample(uvRight).r;
    const depthDown = depthTex.sample(uvDown).r;

    // Unproject each (uv, depth) triple back to world space.
    const toWorld = (uv: Node<"vec2">, d: Node<"float">): Node<"vec3"> => {
      // NDC: x = uv.x*2-1, y = uv.y*-2+1 (undo the y-flip), z = depth.
      const ndc = vec4(uv.x.mul(2).sub(1), uv.y.mul(-2).add(1), d, 1.0);
      const world4 = invVP.mul(ndc);
      return world4.xyz.div(world4.w);
    };
    const p0 = toWorld(centerUv, centerDepth);
    const pR = toWorld(uvRight, depthRight);
    const pD = toWorld(uvDown, depthDown);

    // Surface tangents along screen-X and screen-Y, then normal = cross(...). The order
    // (dRight × dDown) gives a normal facing the camera because screen-Y points "down" but
    // we flipped Y in `uvY` → dDown actually moves DOWN the screen → cross yields the
    // camera-facing side.
    const dRight = pR.sub(p0);
    const dDown = pD.sub(p0);
    const n = normalize(cross(dRight, dDown));
    return n;
  }

  toJSON(): ModuleJSON {
    return {
      type: DepthCollision.type,
      id: this.id,
      mode: this.mode,
      normal: this.normal,
      restitution: this.restitution,
      friction: this.friction,
      thickness: this.thickness,
      // depthTexture + camera aren't serializable — caller must re-supply on fromJSON.
    };
  }

  static fromJSON(_data: ModuleJSON): DepthCollision {
    throw new Error(
      "DepthCollision cannot be deserialized without a depthTexture + camera reference.",
    );
  }
}

registerModule(DepthCollision);
