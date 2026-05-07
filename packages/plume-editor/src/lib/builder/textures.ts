/**
 * Runtime cache: data-URL → THREE.Texture.
 *
 * The editor stores uploaded images as data URLs inside graph params (so saves
 * and localStorage round-trip cleanly). At compile time we need the materialised
 * `THREE.Texture` to hand into renderer modules — this module keeps that mapping
 * so identical data URLs are re-used between compiles instead of re-decoded.
 */

import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

/**
 * Resolve a data URL (or any HTMLImage-loadable URL) into a THREE.Texture. The
 * texture is created synchronously and starts populating once the image decodes;
 * three.js's renderer will pick up the GPU upload via `texture.needsUpdate` set
 * inside the `onload` callback.
 */
export function getTexture(dataUrl: string): THREE.Texture {
  let tex = cache.get(dataUrl);
  if (tex) return tex;

  const img = new Image();
  tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  img.onload = (): void => {
    if (tex) tex.needsUpdate = true;
  };
  img.src = dataUrl;

  cache.set(dataUrl, tex);
  return tex;
}

/** Convert a File (from a file input) into a data URL. Resolves once the file
 *  is fully read. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
