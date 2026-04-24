import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

/** Procedurally generated soft circle texture (radial gradient). Cached. */
export function softCircleTexture(size = 64): THREE.Texture {
  const key = `soft_circle_${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const data = new Uint8Array(size * size * 4);
  const half = size * 0.5;
  const inv = 1 / half;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) * inv;
      const dy = (y + 0.5 - half) * inv;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - r);
      const s = a * a * (3 - 2 * a); // smoothstep
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(s * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Sharp circle (hard disc). */
export function circleTexture(size = 64): THREE.Texture {
  const key = `circle_${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(size * size * 4);
  const half = size * 0.5;
  const rr = (half - 1) * (half - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const inside = dx * dx + dy * dy <= rr;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = inside ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Directional streak (useful for sparks/tracers). 4:1 aspect ratio. */
export function streakTexture(width = 128, height = 32): THREE.Texture {
  const key = `streak_${width}_${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / width; // 0..1 along length
      const fy = (y + 0.5) / height - 0.5; // -0.5..0.5 across
      const lengthFalloff = 1 - Math.abs(fx * 2 - 1);
      const widthFalloff = Math.max(0, 1 - Math.abs(fy) * 2);
      const a = lengthFalloff * widthFalloff;
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function disposeTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
