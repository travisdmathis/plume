import type { Vec3Tuple } from "../types.js";
import type { RNG } from "./rng.js";

/** Emission shape — determines how a position or direction is sampled for a new particle. */
export type EmissionShape =
  | { kind: "point" }
  | { kind: "sphere"; radius: number; thickness?: number } // thickness 0 = surface, 1 = solid
  | { kind: "box"; size: Vec3Tuple }
  | { kind: "cone"; angle: number; radius?: number } // angle in radians (half-angle), radius at base
  | { kind: "ring"; radius: number; thickness?: number }
  | { kind: "disc"; radius: number; thickness?: number };

/** Sample a position from a shape into `out`. */
export function samplePosition(shape: EmissionShape, rng: RNG, out: Vec3Tuple): Vec3Tuple {
  switch (shape.kind) {
    case "point":
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;

    case "sphere": {
      rng.unitSphere(out);
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = rInner + (shape.radius - rInner) * Math.cbrt(rng.next());
      out[0] *= r;
      out[1] *= r;
      out[2] *= r;
      return out;
    }

    case "box": {
      out[0] = (rng.next() - 0.5) * shape.size[0];
      out[1] = (rng.next() - 0.5) * shape.size[1];
      out[2] = (rng.next() - 0.5) * shape.size[2];
      return out;
    }

    case "cone": {
      const r = (shape.radius ?? 0) * Math.sqrt(rng.next());
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }

    case "ring": {
      const thickness = shape.thickness ?? 0;
      const rInner = shape.radius * (1 - thickness);
      const r = rInner + (shape.radius - rInner) * rng.next();
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }

    case "disc": {
      const thickness = shape.thickness ?? 1;
      const rInner = shape.radius * (1 - thickness);
      const r = Math.sqrt(
        rInner * rInner + rng.next() * (shape.radius * shape.radius - rInner * rInner),
      );
      const theta = rng.next() * Math.PI * 2;
      out[0] = Math.cos(theta) * r;
      out[1] = 0;
      out[2] = Math.sin(theta) * r;
      return out;
    }
  }
}

/** Sample a unit direction from a shape into `out`. */
export function sampleDirection(shape: EmissionShape, rng: RNG, out: Vec3Tuple): Vec3Tuple {
  switch (shape.kind) {
    case "point":
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;

    case "sphere":
      rng.unitSphere(out);
      return out;

    case "cone": {
      // Sample direction within cone around +Y with half-angle shape.angle
      const cosMin = Math.cos(shape.angle);
      const cosTheta = cosMin + (1 - cosMin) * rng.next();
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const phi = rng.next() * Math.PI * 2;
      out[0] = Math.cos(phi) * sinTheta;
      out[1] = cosTheta;
      out[2] = Math.sin(phi) * sinTheta;
      return out;
    }

    case "box":
    case "ring":
    case "disc": {
      // Fall back to unit sphere for non-directional shapes
      rng.unitSphere(out);
      return out;
    }
  }
}
