/**
 * The declarative stage schema (v1).
 *
 * The schema is data, not code: `validate.ts` walks it generically and reports
 * the path of every mismatch. That keeps "what is legal" in one readable place
 * (this file) and "how to check it" in another, so a new field is a one-line
 * change here plus the matching type.
 *
 * Unknown keys are intentionally *ignored* (forward compatibility): a newer
 * author tool may write fields this build does not use yet. A known key with the
 * wrong type is always an error.
 */
import { BIOMES, SURFACE_TYPES } from "./types";

/** A tiny schema algebra — enough for this format, nothing more. */
export type Schema =
  | { kind: "string"; minLength?: number; pattern?: RegExp; patternHint?: string; enum?: readonly string[] }
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  | { kind: "boolean" }
  | { kind: "vec3" }
  | { kind: "vec2array" }
  | { kind: "oneOf"; options: readonly Schema[] }
  | { kind: "array"; minItems?: number; items: Schema }
  | { kind: "object"; fields: Record<string, Schema>; required?: readonly string[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const vec3: Schema = { kind: "vec3" };

const splinePoint: Schema = {
  kind: "object",
  fields: {
    x: { kind: "number" },
    y: { kind: "number" },
    z: { kind: "number" },
  },
  required: ["x", "z"],
};

const gate: Schema = {
  kind: "object",
  fields: {
    width: { kind: "number", min: 0.5 },
    height: { kind: "number", min: 0.5 },
  },
  required: ["width", "height"],
};

const tField: Schema = { kind: "number", min: 0, max: 1 };

export const StageSchema: Schema = {
  kind: "object",
  fields: {
    schemaVersion: { kind: "number", integer: true },
    id: { kind: "string", pattern: SLUG, patternHint: "lowercase-kebab-case" },
    name: { kind: "string", minLength: 1 },
    biome: { kind: "string", enum: BIOMES },
    difficulty: { kind: "number", min: 1, max: 5 },
    start: {
      kind: "object",
      fields: {
        position: vec3,
        headingDeg: { kind: "number" },
      },
      required: ["position"],
    },
    finish: {
      kind: "object",
      fields: {
        t: tField,
        gate,
      },
      required: ["gate"],
    },
    spline: {
      kind: "object",
      fields: {
        closed: { kind: "boolean" },
        tension: { kind: "number", min: 0, max: 1 },
        points: { kind: "array", minItems: 2, items: splinePoint },
      },
      required: ["points"],
    },
    road: {
      kind: "object",
      fields: {
        width: { kind: "number", min: 1 },
        sampleStep: { kind: "number", min: 0.25 },
        surface: { kind: "string", enum: SURFACE_TYPES },
        bankingDeg: { kind: "number", min: -30, max: 30 },
      },
      required: ["width", "surface"],
    },
    checkpoints: {
      kind: "array",
      items: {
        kind: "object",
        fields: {
          id: { kind: "string", pattern: SLUG, patternHint: "lowercase-kebab-case" },
          name: { kind: "string", minLength: 1 },
          t: tField,
          width: { kind: "number", min: 0.5 },
          height: { kind: "number", min: 0.5 },
        },
        required: ["id", "name", "t", "width", "height"],
      },
    },
    surfaces: {
      kind: "array",
      minItems: 1,
      items: {
        kind: "object",
        fields: {
          id: { kind: "string", pattern: SLUG, patternHint: "lowercase-kebab-case" },
          surface: { kind: "string", enum: SURFACE_TYPES },
          from: tField,
          to: tField,
          grip: { kind: "number", min: 0, max: 1.5 },
          depth: { kind: "number", min: 0 },
        },
        required: ["id", "surface", "from", "to", "grip"],
      },
    },
    minimap: {
      kind: "object",
      fields: {
        color: { kind: "string", pattern: HEX_COLOR, patternHint: "hex colour like #e8c547" },
        path: { kind: "oneOf", options: [{ kind: "string", enum: ["auto"] }, { kind: "vec2array" }] },
      },
    },
  },
  required: ["schemaVersion", "id", "name", "biome", "spline", "road", "start", "checkpoints", "surfaces"],
};

export const SUPPORTED_SCHEMA_VERSION = 1;
