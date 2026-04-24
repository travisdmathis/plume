import type { ColorInput, ScalarInput, Vec3Input, Vec3Tuple, ColorTuple } from "../types.js";
import type { RNG } from "./rng.js";

export function sampleScalar(input: ScalarInput, rng: RNG): number {
  switch (input.kind) {
    case "constant":
      return input.value;
    case "range":
      return rng.range(input.min, input.max);
    case "list":
      return input.values[rng.rangeInt(0, input.values.length)]!;
  }
}

export function sampleVec3(input: Vec3Input, rng: RNG, out: Vec3Tuple): Vec3Tuple {
  switch (input.kind) {
    case "constant":
      out[0] = input.value[0];
      out[1] = input.value[1];
      out[2] = input.value[2];
      return out;
    case "range":
      out[0] = rng.range(input.min[0], input.max[0]);
      out[1] = rng.range(input.min[1], input.max[1]);
      out[2] = rng.range(input.min[2], input.max[2]);
      return out;
  }
}

export function sampleColor(input: ColorInput, rng: RNG, out: ColorTuple): ColorTuple {
  switch (input.kind) {
    case "constant":
      out[0] = input.value[0];
      out[1] = input.value[1];
      out[2] = input.value[2];
      return out;
    case "range":
      out[0] = rng.range(input.min[0], input.max[0]);
      out[1] = rng.range(input.min[1], input.max[1]);
      out[2] = rng.range(input.min[2], input.max[2]);
      return out;
    case "list": {
      const c = input.values[rng.rangeInt(0, input.values.length)]!;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      return out;
    }
  }
}
