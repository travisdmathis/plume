import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";
import type Node from "three/src/nodes/core/Node.js";
import { instancedArray, vec4 } from "three/tsl";

/**
 * GPU-owned particle storage, aggressively packed into 6 vec4 storage buffers so we can
 * afford additional bindings (e.g. event buffers) without exceeding WebGPU's 8-storage-buffer
 * per-stage limit. Layout:
 *
 *   posAlive.xyzw     = (position.x, position.y, position.z, alive)
 *   velAge.xyzw       = (velocity.x, velocity.y, velocity.z, age)
 *   color.rgba
 *   initialColor.rgba
 *   initVelSize.xyzw  = (initialVelocity.x, initialVelocity.y, initialVelocity.z, initialSize)
 *   traits.xyzw       = (size, rotation, angularVelocity, lifetime)
 *
 * Use the `attr` helpers below — they hide the packing so modules read/write via logical
 * attribute names. Per-component writes do read-modify-write on the owning vec4; per-vec3
 * writes (position/velocity/initialVelocity) rewrite xyz while preserving the packed w.
 */
export interface ParticleStorage {
  posAlive: StorageBufferNode<"vec4">;
  velAge: StorageBufferNode<"vec4">;
  color: StorageBufferNode<"vec4">;
  initialColor: StorageBufferNode<"vec4">;
  initVelSize: StorageBufferNode<"vec4">;
  traits: StorageBufferNode<"vec4">;
}

export class ParticleBuffer {
  readonly capacity: number;
  readonly storage: ParticleStorage;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.storage = {
      posAlive: instancedArray(capacity, "vec4"),
      velAge: instancedArray(capacity, "vec4"),
      color: instancedArray(capacity, "vec4"),
      initialColor: instancedArray(capacity, "vec4"),
      initVelSize: instancedArray(capacity, "vec4"),
      traits: instancedArray(capacity, "vec4"),
    };
  }
}

type V4Buf = StorageBufferNode<"vec4">;
type V4Index = Node<"int"> | Node<"uint">;

// ─ rmw helpers ──────────────────────────────────────────────────────────
// TSL's `setX/setY/setZ/setW` returns a fresh vec4 node with the named component replaced.
// We read the current vec4 into a local var, apply the setter, then write the result back.

function rmwX(buf: V4Buf, i: V4Index, value: Node<"float">): void {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setX(value));
}
function rmwY(buf: V4Buf, i: V4Index, value: Node<"float">): void {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setY(value));
}
function rmwZ(buf: V4Buf, i: V4Index, value: Node<"float">): void {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setZ(value));
}
function rmwW(buf: V4Buf, i: V4Index, value: Node<"float">): void {
  const current = buf.element(i).toVar();
  buf.element(i).assign(current.setW(value));
}
function rmwXYZ(buf: V4Buf, i: V4Index, value: Node<"vec3">): void {
  const current = buf.element(i).toVar();
  buf.element(i).assign(vec4(value, current.w));
}

// ─ logical attribute accessors ─────────────────────────────────────────
export const attr = {
  // Vec3 attributes packed with a scalar in .w
  position: {
    read: (s: ParticleStorage, i: V4Index): Node<"vec3"> => s.posAlive.element(i).xyz,
    write: (s: ParticleStorage, i: V4Index, v: Node<"vec3">): void => rmwXYZ(s.posAlive, i, v),
  },
  velocity: {
    read: (s: ParticleStorage, i: V4Index): Node<"vec3"> => s.velAge.element(i).xyz,
    write: (s: ParticleStorage, i: V4Index, v: Node<"vec3">): void => rmwXYZ(s.velAge, i, v),
  },
  initialVelocity: {
    read: (s: ParticleStorage, i: V4Index): Node<"vec3"> => s.initVelSize.element(i).xyz,
    write: (s: ParticleStorage, i: V4Index, v: Node<"vec3">): void => rmwXYZ(s.initVelSize, i, v),
  },

  // Scalars packed as the w of a vec3+1
  alive: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.posAlive.element(i).w,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwW(s.posAlive, i, v),
  },
  age: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.velAge.element(i).w,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwW(s.velAge, i, v),
  },
  initialSize: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.initVelSize.element(i).w,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwW(s.initVelSize, i, v),
  },

  // Scalars packed into the `traits` vec4
  size: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.traits.element(i).x,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwX(s.traits, i, v),
  },
  rotation: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.traits.element(i).y,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwY(s.traits, i, v),
  },
  angularVelocity: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.traits.element(i).z,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwZ(s.traits, i, v),
  },
  lifetime: {
    read: (s: ParticleStorage, i: V4Index): Node<"float"> => s.traits.element(i).w,
    write: (s: ParticleStorage, i: V4Index, v: Node<"float">): void => rmwW(s.traits, i, v),
  },

  // Vec4 attributes — direct storage access, no packing
  color: {
    read: (s: ParticleStorage, i: V4Index): Node<"vec4"> => s.color.element(i),
    write: (s: ParticleStorage, i: V4Index, v: Node<"vec4">): void => {
      s.color.element(i).assign(v);
    },
  },
  initialColor: {
    read: (s: ParticleStorage, i: V4Index): Node<"vec4"> => s.initialColor.element(i),
    write: (s: ParticleStorage, i: V4Index, v: Node<"vec4">): void => {
      s.initialColor.element(i).assign(v);
    },
  },
};
