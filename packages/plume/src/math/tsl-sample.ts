/**
 * TSL sampling helpers — emit compute-shader code that draws random samples from a
 * `ScalarInput` / `Vec3Input` / `ColorInput` spec, or from an `EmissionShape`.
 *
 * Each helper takes a `seed` float node (typically derived per-slot in the spawn kernel)
 * and an `offset` integer that shifts the hash input so distinct samples within the same
 * module don't correlate. The returned node is ready to be used in TSL graph construction.
 */

import * as THREE from "three";
import type Node from "three/src/nodes/core/Node.js";
import { cos, float, hash, sin, sqrt, uniformArray, vec3 } from "three/tsl";

import type { ColorInput, ColorTuple, ScalarInput, Vec3Input } from "../types.js";
import type { EmissionShape } from "./shapes.js";

const TWO_PI = Math.PI * 2;

/** Return a TSL float node for a ScalarInput sample. `offset` uncorrelates multiple draws per slot. */
export function scalarInputTSL(input: ScalarInput, seed: Node<"float">, offset = 0): Node<"float"> {
  switch (input.kind) {
    case "constant":
      return float(input.value);
    case "range": {
      const h = hash(seed.add(offset));
      return float(input.min).add(float(input.max - input.min).mul(h));
    }
    case "list": {
      const values = input.values.length > 0 ? input.values : [0];
      const arr = uniformArray<"float">(values, "float");
      const h = hash(seed.add(offset));
      const idx = h.mul(values.length).floor().toInt();
      return arr.element(idx);
    }
  }
}

/** Return a TSL vec3 node for a Vec3Input sample. */
export function vec3InputTSL(input: Vec3Input, seed: Node<"float">, offset = 0): Node<"vec3"> {
  if (input.kind === "constant") {
    return vec3(input.value[0], input.value[1], input.value[2]);
  }
  const hx = hash(seed.add(offset));
  const hy = hash(seed.add(offset + 1));
  const hz = hash(seed.add(offset + 2));
  const min = vec3(input.min[0], input.min[1], input.min[2]);
  const max = vec3(input.max[0], input.max[1], input.max[2]);
  return min.add(max.sub(min).mul(vec3(hx, hy, hz)));
}

/** Return a TSL vec3 node for a ColorInput sample (rgb only; alpha handled separately). */
export function colorInputRgbTSL(input: ColorInput, seed: Node<"float">, offset = 0): Node<"vec3"> {
  switch (input.kind) {
    case "constant":
      return vec3(input.value[0], input.value[1], input.value[2]);
    case "range": {
      const hr = hash(seed.add(offset));
      const hg = hash(seed.add(offset + 1));
      const hb = hash(seed.add(offset + 2));
      const min = vec3(input.min[0], input.min[1], input.min[2]);
      const max = vec3(input.max[0], input.max[1], input.max[2]);
      return min.add(max.sub(min).mul(vec3(hr, hg, hb)));
    }
    case "list": {
      const values = input.values.length > 0 ? input.values : ([[1, 1, 1]] as ColorTuple[]);
      const vecs = values.map((c) => new THREE.Vector3(c[0], c[1], c[2]));
      const arr = uniformArray<"vec3">(vecs, "vec3");
      const h = hash(seed.add(offset));
      const idx = h.mul(values.length).floor().toInt();
      return arr.element(idx);
    }
  }
}

/**
 * Return a TSL vec3 node for a position sampled from an EmissionShape (local space).
 * Caller is responsible for transforming to world space via `worldMatrix.mul(vec4(p, 1))`.
 */
export function samplePositionTSL(
  shape: EmissionShape,
  seed: Node<"float">,
  offset = 0,
): Node<"vec3"> {
  switch (shape.kind) {
    case "point":
      return vec3(0, 0, 0);

    case "sphere": {
      // uniform direction × cubic-rooted radius for even density; thickness defines inner shell
      const rx = hash(seed.add(offset)).sub(0.5);
      const ry = hash(seed.add(offset + 1)).sub(0.5);
      const rz = hash(seed.add(offset + 2)).sub(0.5);
      const dir = vec3(rx, ry, rz).normalize();
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const rCubic = hash(seed.add(offset + 3)).pow(float(1 / 3));
      const r = float(rInner).add(float(shape.radius - rInner).mul(rCubic));
      return dir.mul(r);
    }

    case "box": {
      const hx = hash(seed.add(offset)).sub(0.5);
      const hy = hash(seed.add(offset + 1)).sub(0.5);
      const hz = hash(seed.add(offset + 2)).sub(0.5);
      return vec3(hx.mul(shape.size[0]), hy.mul(shape.size[1]), hz.mul(shape.size[2]));
    }

    case "cone": {
      // flat disk at y=0; y-rise happens via velocity orientation, not position
      const radius = shape.radius ?? 0;
      const rFrac = sqrt(hash(seed.add(offset)));
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      const r = rFrac.mul(radius);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }

    case "ring": {
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = float(rInner).add(float(shape.radius - rInner).mul(hash(seed.add(offset))));
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }

    case "disc": {
      const thickness = shape.thickness ?? 1;
      const rInner = shape.radius * (1 - thickness);
      const t = hash(seed.add(offset));
      const r = sqrt(
        float(rInner * rInner).add(float(shape.radius * shape.radius - rInner * rInner).mul(t)),
      );
      const theta = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(theta).mul(r), 0, sin(theta).mul(r));
    }
  }
}

/**
 * Return a TSL vec3 unit-direction node for an EmissionShape. For "cone" this samples
 * within the cone's half-angle around +Y; for "sphere" it's a uniform unit sphere direction.
 * Other shapes fall back to sphere sampling.
 */
export function sampleDirectionTSL(
  shape: EmissionShape,
  seed: Node<"float">,
  offset = 0,
): Node<"vec3"> {
  switch (shape.kind) {
    case "point":
      return vec3(0, 1, 0);

    case "cone": {
      const cosMin = Math.cos(shape.angle);
      const cosTheta = float(cosMin).add(float(1 - cosMin).mul(hash(seed.add(offset))));
      const sinTheta = sqrt(float(1).sub(cosTheta.mul(cosTheta)));
      const phi = hash(seed.add(offset + 1)).mul(TWO_PI);
      return vec3(cos(phi).mul(sinTheta), cosTheta, sin(phi).mul(sinTheta));
    }

    case "sphere":
    case "box":
    case "ring":
    case "disc":
    default: {
      const rx = hash(seed.add(offset)).sub(0.5);
      const ry = hash(seed.add(offset + 1)).sub(0.5);
      const rz = hash(seed.add(offset + 2)).sub(0.5);
      return vec3(rx, ry, rz).normalize();
    }
  }
}
