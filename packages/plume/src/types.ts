import type * as THREE from "three";

export type Vec3Tuple = [number, number, number];
export type Vec4Tuple = [number, number, number, number];
export type ColorTuple = [number, number, number];
export type ColorRGBATuple = [number, number, number, number];

/** Numeric input that may be a constant, a uniform range, or a value chosen from a list. */
export type ScalarInput =
  | { kind: "constant"; value: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "list"; values: number[] };

export type Vec3Input =
  | { kind: "constant"; value: Vec3Tuple }
  | { kind: "range"; min: Vec3Tuple; max: Vec3Tuple };

export type ColorInput =
  | { kind: "constant"; value: ColorTuple }
  | { kind: "range"; min: ColorTuple; max: ColorTuple }
  | { kind: "list"; values: ColorTuple[] };

export interface Disposable {
  dispose(): void;
}

export interface WorldTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}
