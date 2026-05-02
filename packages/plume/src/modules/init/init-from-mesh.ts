import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import { If, float, hash, instancedArray, uniform, vec3, vec4 } from "three/tsl";

import type { ModuleJSON, ParticleSpawnModule, SpawnInitContext } from "../module.js";
import { attr } from "../../particle-buffer.js";
import { registerModule } from "../registry.js";

export type InitFromMeshFill = "surface" | "volume";

export interface InitFromMeshParams {
  /** Geometry to sample — indexed or non-indexed. Must have position attribute. */
  geometry: THREE.BufferGeometry;
  /**
   * Local→world transform for the geometry. Applied per spawn so the mesh can move/rotate/scale
   * without re-uploading. Defaults to identity (mesh is at the emitter origin).
   */
  matrix?: THREE.Matrix4;
  /**
   * If true, the sampled point stays local and the emitter's world transform is composed on
   * top (like any other InitPosition). If false, sampled points are emitted in world space
   * (useful when the source mesh is independent of the emitter's own transform). Default true.
   */
  worldSpace?: boolean;
  /**
   * `"surface"` (default): area-weighted sampling of points on the mesh skin. Works for any
   * mesh — open or closed, thin or solid.
   *
   * `"volume"`: uniform sampling of points inside the mesh interior. Requires the mesh to be
   * a closed watertight surface (holes will leak samples). Computed once at construction via
   * rejection sampling — may take ~100ms for dense meshes. Each particle picks a random
   * entry from a pre-generated sample set; `volumeSampleCount` controls the set size.
   */
  fill?: InitFromMeshFill;
  /**
   * Only used when `fill: "volume"`. Number of pre-sampled interior points cached on the GPU.
   * Higher = less visible repetition at high spawn rates, at the cost of construction time
   * and GPU memory. Default 2048 (24 KB of storage). Set lower (256–512) for tiny meshes.
   */
  volumeSampleCount?: number;
  id?: string;
}

/**
 * Spawn-init module: picks a point on or inside a mesh for each new particle. Used for
 * effects that emit from a model — e.g. dust off an armor, sparks from a blade edge, embers
 * along a dragon silhouette (surface), or fog filling a magical containment (volume).
 *
 * **Surface mode** (default): CPU builds a triangle area-weighted cumulative distribution;
 * GPU binary-searches it per spawn, then barycentric-samples within the chosen triangle.
 *
 * **Volume mode**: CPU pre-generates `volumeSampleCount` points via rejection sampling
 * (raycast-based inside test); GPU reads a uniformly-random index each spawn. Fast on GPU
 * because no per-spawn geometry work happens, but construction cost scales with mesh size.
 */
export class InitFromMesh implements ParticleSpawnModule {
  static readonly type = "init.from_mesh";
  readonly kind = "particle_spawn" as const;
  readonly type = InitFromMesh.type;
  readonly id?: string;
  worldSpace: boolean;
  fill: InitFromMeshFill;

  // Surface-mode buffers (null for volume).
  private _triCount = 0;
  private _triVerts?: StorageBufferNode<"float">;
  private _triCdf?: StorageBufferNode<"float">;

  // Volume-mode buffer (null for surface).
  private _volumePointCount = 0;
  private _volumePoints?: StorageBufferNode<"float">;

  private _uMeshMatrix: UniformNode<"mat4", THREE.Matrix4>;

  constructor(params: InitFromMeshParams) {
    this.worldSpace = params.worldSpace ?? true;
    this.fill = params.fill ?? "surface";
    this.id = params.id;
    this._uMeshMatrix = uniform(params.matrix?.clone() ?? new THREE.Matrix4()) as UniformNode<
      "mat4",
      THREE.Matrix4
    >;

    if (this.fill === "surface") {
      const { verts, cdf } = buildTriangleCdf(params.geometry);
      this._triCount = cdf.length;
      this._triVerts = instancedArray(verts, "float") as StorageBufferNode<"float">;
      this._triCdf = instancedArray(cdf, "float") as StorageBufferNode<"float">;
    } else {
      const count = Math.max(16, params.volumeSampleCount ?? 2048);
      const points = getCachedVolumeSamples(params.geometry, count);
      this._volumePointCount = points.length / 3;
      this._volumePoints = instancedArray(points, "float") as StorageBufferNode<"float">;
    }
  }

  contributeSpawnTSL(ctx: SpawnInitContext): void {
    const localPos = this.fill === "surface" ? this._sampleSurface(ctx) : this._sampleVolume(ctx);

    // Transform through mesh's local→world, and optionally through emitter's world matrix.
    const meshWorldPos = this._uMeshMatrix.mul(vec4(localPos, 1.0)).xyz;
    const finalPos = this.worldSpace
      ? ctx.worldMatrix.mul(vec4(meshWorldPos, 1.0)).xyz
      : meshWorldPos;
    attr.position.write(ctx.storage, ctx.slot, finalPos);
  }

  private _sampleSurface(ctx: SpawnInitContext): Node<"vec3"> {
    const cdf = this._triCdf!;
    const verts = this._triVerts!;
    const nTris = this._triCount;

    // Three decorrelated uniform randoms: one to pick a triangle, two for barycentric.
    const r0 = hash(ctx.seed.add(1001));
    const r1 = hash(ctx.seed.add(1002));
    const r2 = hash(ctx.seed.add(1003));

    // Binary search CDF for the smallest i such that cdf[i] ≥ r0.
    const lo = float(0).toVar();
    const hi = float(nTris - 1).toVar();
    const steps = Math.ceil(Math.log2(nTris + 1));
    for (let s = 0; s < steps; s++) {
      const mid = lo.add(hi).mul(0.5).floor().toVar();
      const midVal = cdf.element(mid.toInt());
      If(midVal.lessThan(r0), () => {
        lo.assign(mid.add(1));
      }).Else(() => {
        hi.assign(mid);
      });
    }
    const triIdx = lo.toInt().toVar();

    // Load the chosen triangle's three vertices. Each vertex is 3 consecutive floats.
    const base = triIdx.mul(9).toVar();
    const a = vec3(verts.element(base), verts.element(base.add(1)), verts.element(base.add(2)));
    const b = vec3(
      verts.element(base.add(3)),
      verts.element(base.add(4)),
      verts.element(base.add(5)),
    );
    const c = vec3(
      verts.element(base.add(6)),
      verts.element(base.add(7)),
      verts.element(base.add(8)),
    );

    // Reflect barycentric sample into the lower-triangle region so the distribution is
    // uniform over triangle area. If u+v > 1, flip to (1-u, 1-v).
    const uCoord = r1.toVar();
    const vCoord = r2.toVar();
    If(uCoord.add(vCoord).greaterThan(1), () => {
      uCoord.assign(float(1).sub(uCoord));
      vCoord.assign(float(1).sub(vCoord));
    });
    const wCoord = float(1).sub(uCoord).sub(vCoord);
    return a.mul(wCoord).add(b.mul(uCoord)).add(c.mul(vCoord));
  }

  private _sampleVolume(ctx: SpawnInitContext): Node<"vec3"> {
    const points = this._volumePoints!;
    const count = this._volumePointCount;

    // Random index into the pre-sampled interior point set.
    const r = hash(ctx.seed.add(2001));
    const idx = r.mul(count).floor().toInt().toVar();
    const base = idx.mul(3);
    return vec3(points.element(base), points.element(base.add(1)), points.element(base.add(2)));
  }

  toJSON(): ModuleJSON {
    return {
      type: InitFromMesh.type,
      id: this.id,
      worldSpace: this.worldSpace,
      fill: this.fill,
      // Geometry + matrix aren't serialized — caller must re-supply on fromJSON.
    };
  }

  static fromJSON(_data: ModuleJSON): InitFromMesh {
    throw new Error("InitFromMesh cannot be deserialized without a geometry reference.");
  }
}

registerModule(InitFromMesh);

// ─ Triangle CDF builder (surface mode) ────────────────────────────────────

function buildTriangleCdf(geometry: THREE.BufferGeometry): {
  verts: Float32Array;
  cdf: Float32Array;
} {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || !(posAttr instanceof THREE.BufferAttribute)) {
    throw new Error("plume: InitFromMesh requires a geometry with a 'position' BufferAttribute");
  }
  const indexAttr = geometry.getIndex();

  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
  if (triCount === 0) {
    throw new Error("plume: InitFromMesh geometry has no triangles");
  }

  const verts = new Float32Array(triCount * 9);
  const areas = new Float32Array(triCount);
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const [ia, ib, ic] = indexAttr
      ? [indexAttr.getX(i * 3), indexAttr.getX(i * 3 + 1), indexAttr.getX(i * 3 + 2)]
      : [i * 3, i * 3 + 1, i * 3 + 2];
    pa.fromBufferAttribute(posAttr, ia);
    pb.fromBufferAttribute(posAttr, ib);
    pc.fromBufferAttribute(posAttr, ic);
    verts[i * 9 + 0] = pa.x;
    verts[i * 9 + 1] = pa.y;
    verts[i * 9 + 2] = pa.z;
    verts[i * 9 + 3] = pb.x;
    verts[i * 9 + 4] = pb.y;
    verts[i * 9 + 5] = pb.z;
    verts[i * 9 + 6] = pc.x;
    verts[i * 9 + 7] = pc.y;
    verts[i * 9 + 8] = pc.z;

    ab.subVectors(pb, pa);
    ac.subVectors(pc, pa);
    cross.crossVectors(ab, ac);
    areas[i] = cross.length() * 0.5;
  }

  // Cumulative normalized area distribution.
  let total = 0;
  for (let i = 0; i < triCount; i++) total += areas[i];
  const cdf = new Float32Array(triCount);
  let running = 0;
  const safeTotal = total > 0 ? total : 1;
  for (let i = 0; i < triCount; i++) {
    running += areas[i];
    cdf[i] = running / safeTotal;
  }
  cdf[triCount - 1] = 1;

  return { verts, cdf };
}

// ─ Volume sampling (rejection via raycast) ────────────────────────────────

/**
 * Cache volume samples per-(geometry, count) so repeated `InitFromMesh` constructors on the
 * same geometry — e.g. when a factory-style prefab creates a fresh emitter for every pool
 * miss — don't re-run the ~1-second rejection-sampling pass each time. Keyed weakly by
 * geometry so disposed geometries release their entry.
 */
const volumeSampleCache = new WeakMap<THREE.BufferGeometry, Map<number, Float32Array>>();

function getCachedVolumeSamples(geometry: THREE.BufferGeometry, count: number): Float32Array {
  let byCount = volumeSampleCache.get(geometry);
  if (!byCount) {
    byCount = new Map();
    volumeSampleCache.set(geometry, byCount);
  }
  let points = byCount.get(count);
  if (!points) {
    points = buildVolumeSamplePoints(geometry, count);
    byCount.set(count, points);
  }
  return points;
}

/**
 * Generate `count` points uniformly distributed inside the mesh volume via rejection
 * sampling. Each candidate is tested with an axis-aligned ray from the candidate's position;
 * odd-count triangle hits = inside. If a candidate fails `maxAttempts` rejections in a row,
 * we accept whatever was last tried (keeps construction bounded for thin or degenerate meshes
 * at the cost of slight sample bias).
 */
function buildVolumeSamplePoints(geometry: THREE.BufferGeometry, count: number): Float32Array {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || !(posAttr instanceof THREE.BufferAttribute)) {
    throw new Error("plume: InitFromMesh volume mode requires a 'position' BufferAttribute");
  }

  // Use a THREE.Mesh wrapper so we can use Raycaster — no hand-rolled Möller-Trumbore needed.
  // DoubleSide material ensures the raycaster counts BOTH front- and back-facing hits, which
  // is required for the parity (odd = inside) test to work. Default materials are FrontSide,
  // which back-culls exit faces and inverts the test.
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  tmpMesh.updateMatrixWorld(true);

  // Bounding box in mesh-local space (which is what sampled points will be in).
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) throw new Error("plume: InitFromMesh volume mode — failed to compute bounding box");
  const min = bbox.min;
  const max = bbox.max;

  const out = new Float32Array(count * 3);
  const candidate = new THREE.Vector3();
  // Use +X direction for the parity ray. Pick a slight offset to reduce edge-case
  // hits on axis-aligned triangles.
  const rayDir = new THREE.Vector3(1, 0.0001, 0.0002).normalize();
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = Infinity;

  const maxAttempts = 64;
  let filled = 0;
  let totalAttempts = 0;
  const maxTotal = count * maxAttempts;

  while (filled < count && totalAttempts < maxTotal) {
    totalAttempts++;
    candidate.set(
      min.x + Math.random() * (max.x - min.x),
      min.y + Math.random() * (max.y - min.y),
      min.z + Math.random() * (max.z - min.z),
    );
    raycaster.set(candidate, rayDir);
    const hits = raycaster.intersectObject(tmpMesh, false);
    if (hits.length % 2 === 1) {
      out[filled * 3 + 0] = candidate.x;
      out[filled * 3 + 1] = candidate.y;
      out[filled * 3 + 2] = candidate.z;
      filled++;
    }
  }

  if (filled === 0) {
    // Fallback: mesh is open, degenerate, or our rays missed. Fill with AABB samples so the
    // kernel still has valid data. Warn the caller so they know something's off.
    console.warn(
      "plume: InitFromMesh volume sampling found 0 interior points — mesh may be open/non-manifold. Falling back to bounding-box samples.",
    );
    for (let i = 0; i < count; i++) {
      out[i * 3 + 0] = min.x + Math.random() * (max.x - min.x);
      out[i * 3 + 1] = min.y + Math.random() * (max.y - min.y);
      out[i * 3 + 2] = min.z + Math.random() * (max.z - min.z);
    }
    return out;
  }

  // If we ran out of attempts, repeat the accepted set to pad out `count` slots.
  if (filled < count) {
    for (let i = filled; i < count; i++) {
      const src = i % filled;
      out[i * 3 + 0] = out[src * 3 + 0]!;
      out[i * 3 + 1] = out[src * 3 + 1]!;
      out[i * 3 + 2] = out[src * 3 + 2]!;
    }
  }

  return out;
}
