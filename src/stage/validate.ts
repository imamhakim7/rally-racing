/**
 * Stage validation: a structural walk over `StageSchema` followed by semantic
 * checks (uniqueness, ordering, surface coverage). Collects *all* issues — never
 * stops at the first — and throws a single `StageValidationError` whose message
 * names every field. On success returns a normalised `StageCircuit` with every
 * optional field defaulted, so downstream code never has to test for `undefined`.
 */
import {
  StageValidationError,
  type StageIssue,
  type StageIssueCode,
} from "./errors";
import { StageSchema, SUPPORTED_SCHEMA_VERSION, type Schema } from "./schema";
import {
  BIOMES,
  SURFACE_TYPES,
  type Biome,
  type CheckpointSpec,
  type MinimapSpec,
  type SplinePoint,
  type StageCircuit,
  type SurfaceSpec,
  type SurfaceType,
  type TerrainDef,
  type Vec2,
} from "./types";

/** The shape of an unvalidated stage, after the structural walk has passed. */
interface RawStage {
  schemaVersion: number;
  id: string;
  name: string;
  biome: Biome;
  difficulty?: number;
  start: { position: [number, number, number]; headingDeg?: number };
  finish?: { t?: number; gate: { width: number; height: number } };
  spline: { closed?: boolean; tension?: number; points: SplinePoint[] };
  road: { width: number; sampleStep?: number; surface: SurfaceType; bankingDeg?: number };
  checkpoints?: CheckpointSpec[];
  surfaces: SurfaceSpec[];
  minimap?: { color?: string; path?: "auto" | Vec2[] };
  terrain?: Partial<TerrainDef>;
}

const COVERAGE_EPSILON = 1e-6;

function joinPath(base: string, key: string): string {
  return base === "$" ? key : `${base}.${key}`;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "string") {
    const short = value.length > 48 ? `${value.slice(0, 48)}...` : value;
    return JSON.stringify(short);
  }
  if (typeof value === "object") return "object";
  return String(value);
}

function issue(path: string, code: StageIssueCode, value: unknown, message: string): StageIssue {
  return { path, code, value, message };
}

/** Structural match test, used only to resolve `oneOf`. */
function matches(value: unknown, schema: Schema): boolean {
  const scratch: StageIssue[] = [];
  walk(value, schema, "$", scratch);
  return scratch.length === 0;
}

function walk(value: unknown, schema: Schema, path: string, issues: StageIssue[]): void {
  switch (schema.kind) {
    case "string": {
      if (typeof value !== "string") {
        issues.push(issue(path, "type", value, `expected a string, got ${typeof value}`));
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        issues.push(issue(path, "enum", value, `expected one of ${schema.enum.join(", ")}`));
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push(issue(path, "range", value, `expected at least ${schema.minLength} character(s)`));
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        issues.push(issue(path, "format", value, `expected ${schema.patternHint ?? String(schema.pattern)}`));
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue(path, "type", value, `expected a finite number, got ${describe(value)}`));
        return;
      }
      if (schema.integer && !Number.isInteger(value)) {
        issues.push(issue(path, "type", value, "expected an integer"));
        return;
      }
      if (schema.min !== undefined && value < schema.min) {
        issues.push(issue(path, "range", value, `expected >= ${schema.min}, got ${value}`));
      }
      if (schema.max !== undefined && value > schema.max) {
        issues.push(issue(path, "range", value, `expected <= ${schema.max}, got ${value}`));
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        issues.push(issue(path, "type", value, `expected a boolean, got ${typeof value}`));
      }
      return;
    }
    case "vec3": {
      if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
        issues.push(issue(path, "type", value, "expected [x, y, z] finite numbers"));
      }
      return;
    }
    case "vec2array": {
      if (!Array.isArray(value)) {
        issues.push(issue(path, "type", value, "expected an array of [x, y] points"));
        return;
      }
      value.forEach((entry, i) => {
        if (!Array.isArray(entry) || entry.length !== 2 || !entry.every((n) => typeof n === "number" && Number.isFinite(n))) {
          issues.push(issue(`${path}[${i}]`, "type", entry, "expected [x, y] finite numbers"));
        }
      });
      return;
    }
    case "oneOf": {
      if (!schema.options.some((option) => matches(value, option))) {
        issues.push(issue(path, "type", value, "value did not match any allowed shape"));
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        issues.push(issue(path, "type", value, `expected an array, got ${typeof value}`));
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push(issue(path, "range", value, `expected at least ${schema.minItems} item(s), got ${value.length}`));
      }
      value.forEach((entry, i) => walk(entry, schema.items, `${path}[${i}]`, issues));
      return;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push(issue(path, "type", value, `expected an object, got ${describe(value)}`));
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (record[key] === undefined || record[key] === null) {
          issues.push(issue(joinPath(path, key), "required", undefined, "required field is missing"));
        }
      }
      for (const [key, child] of Object.entries(schema.fields)) {
        if (record[key] === undefined) continue;
        walk(record[key], child, joinPath(path, key), issues);
      }
      return;
    }
  }
}

/** Semantic checks that a field-by-field walk cannot express. */
function semanticIssues(stage: RawStage): StageIssue[] {
  const issues: StageIssue[] = [];

  if (stage.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    issues.push(
      issue(
        "schemaVersion",
        "version",
        stage.schemaVersion,
        `unsupported schema version ${stage.schemaVersion}; this build understands version ${SUPPORTED_SCHEMA_VERSION}`,
      ),
    );
  }

  const checkpointIds = new Set<string>();
  (stage.checkpoints ?? []).forEach((cp, i) => {
    if (checkpointIds.has(cp.id)) {
      issues.push(issue(`checkpoints[${i}].id`, "unique", cp.id, `duplicate checkpoint id '${cp.id}'`));
    }
    checkpointIds.add(cp.id);
  });

  const checkpoints = stage.checkpoints ?? [];
  checkpoints.forEach((cp, i) => {
    const previous = i > 0 ? checkpoints[i - 1] : undefined;
    if (previous && cp.t < previous.t) {
      issues.push(
        issue(`checkpoints[${i}].t`, "ordering", cp.t, `checkpoints must be ordered: t=${cp.t} comes after t=${previous.t}`),
      );
    }
  });

  const finishT = stage.finish?.t ?? 1;
  const lastCheckpoint = checkpoints.at(-1);
  if (lastCheckpoint && finishT < lastCheckpoint.t) {
    issues.push(issue("finish.t", "ordering", finishT, `finish (t=${finishT}) cannot precede the last checkpoint (t=${lastCheckpoint.t})`));
  }

  const surfaceIds = new Set<string>();
  stage.surfaces.forEach((zone, i) => {
    if (surfaceIds.has(zone.id)) {
      issues.push(issue(`surfaces[${i}].id`, "unique", zone.id, `duplicate surface id '${zone.id}'`));
    }
    surfaceIds.add(zone.id);
    if (zone.from >= zone.to) {
      issues.push(issue(`surfaces[${i}].from`, "ordering", zone.from, `surface '${zone.id}' must have from < to (${zone.from} >= ${zone.to})`));
    }
  });

  // Surface zones must tile [0,1] exactly: no gaps, no overlaps.
  const ordered = [...stage.surfaces].sort((a, b) => a.from - b.from);
  ordered.forEach((zone, i) => {
    const previous = i > 0 ? ordered[i - 1] : undefined;
    const expectedFrom = previous ? previous.to : 0;
    if (Math.abs(zone.from - expectedFrom) > COVERAGE_EPSILON) {
      const path = `surfaces[${stage.surfaces.indexOf(zone)}].from`;
      issues.push(
        issue(
          path,
          "coverage",
          zone.from,
          previous
            ? `surface '${zone.id}' must start where '${previous.id}' ends (expected ${previous.to}, got ${zone.from})`
            : `surface zones must start at 0 (surface '${zone.id}' starts at ${zone.from})`,
        ),
      );
    }
  });
  const last = ordered.at(-1);
  if (last && Math.abs(last.to - 1) > COVERAGE_EPSILON) {
    issues.push(
      issue(
        `surfaces[${stage.surfaces.indexOf(last)}].to`,
        "coverage",
        last.to,
        `surface zones must end at 1 (last zone '${last.id}' ends at ${last.to})`,
      ),
    );
  }

  return issues;
}

/** The default minimap when a stage omits it. */
export const DEFAULT_MINIMAP_COLOR = "#e8c547";

/** Stable 32-bit string hash, so a stage without a terrain seed is still deterministic. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fill in the terrain layer, defaulting every omitted field (#APEX-28). */
function normaliseTerrain(stage: RawStage): TerrainDef {
  const terrain = stage.terrain ?? {};
  return {
    seed: terrain.seed ?? hashId(stage.id),
    relief: terrain.relief ?? 6,
    resolution: terrain.resolution ?? 15,
    surface: terrain.surface ?? stage.road.surface,
    corridorWidth: terrain.corridorWidth ?? 34,
  };
}

function normalise(stage: RawStage, source: string): StageCircuit {
  const minimap: MinimapSpec = {
    color: stage.minimap?.color ?? DEFAULT_MINIMAP_COLOR,
    path: stage.minimap?.path ?? "auto",
  };
  return {
    schemaVersion: 1,
    id: stage.id,
    name: stage.name,
    biome: stage.biome,
    difficulty: stage.difficulty ?? 3,
    start: {
      position: stage.start.position,
      headingDeg: stage.start.headingDeg ?? 0,
    },
    finish: {
      t: stage.finish?.t ?? 1,
      gate: stage.finish?.gate ?? { width: stage.road.width + 3, height: 6 },
    },
    spline: {
      closed: stage.spline.closed ?? false,
      tension: stage.spline.tension ?? 0.5,
      points: stage.spline.points,
    },
    road: {
      width: stage.road.width,
      sampleStep: stage.road.sampleStep ?? 2,
      surface: stage.road.surface,
      bankingDeg: stage.road.bankingDeg ?? 0,
    },
    checkpoints: stage.checkpoints ?? [],
    surfaces: [...stage.surfaces].sort((a, b) => a.from - b.from),
    minimap,
    terrain: normaliseTerrain(stage),
    source,
  };
}

/**
 * Validate an already-parsed stage document.
 *
 * @throws {StageValidationError} when any field is missing, wrong-typed,
 *   out of range, duplicated, mis-ordered or leaves a surface gap.
 */
export function validateStage(value: unknown, source = "<stage>"): StageCircuit {
  const issues: StageIssue[] = [];
  walk(value, StageSchema, "$", issues);
  if (issues.length === 0) {
    const raw = value as RawStage;
    issues.push(...semanticIssues(raw));
    if (issues.length === 0) return normalise(raw, source);
  }
  throw new StageValidationError(issues, source);
}

/** Re-exported for tests that want the canonical surface/biome vocabularies. */
export const SURFACE_VOCABULARY = SURFACE_TYPES;
export const BIOME_VOCABULARY = BIOMES;
