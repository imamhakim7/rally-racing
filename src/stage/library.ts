/**
 * Stage library — the "no code change" guarantee.
 *
 * Every JSON file under `src/stage/data/` is listed in the generated
 * `data/index.ts` (see `scripts/generate-stage-index.ts`, wired to run before
 * `dev`/`build`), so dropping in a valid file adds a stage and nothing else.
 * A committed static index — rather than Vite's `import.meta.glob` — keeps the
 * library resolvable from the browser bundle, the dev server and plain test
 * runners alike. (Tests inject their own entries, which is why the constructor
 * takes a list.)
 */
import { loadStage } from "./loader";
import { sampleSpline } from "./spline";
import { stageModules } from "./data";
import type { StageCircuit } from "./types";

export interface StageSource {
  /** File name / URL, used in error messages. */
  source: string;
  /** Parsed JSON document. */
  data: unknown;
}

export interface StageCatalogEntry {
  id: string;
  name: string;
  biome: string;
  difficulty: number;
  /** Centreline arc length in metres (sampled) — drives the stage-card preview. */
  lengthM: number;
  source: string;
}

/** The bundled stages, read from the generated index (a new file needs no code edit). */
export function collectBundledStages(): StageSource[] {
  return Object.entries(stageModules)
    .map(([file, module]) => ({
      source: file,
      data: (module as { default?: unknown }).default ?? module,
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export class StageLibrary {
  private readonly circuits = new Map<string, StageCircuit>();

  constructor(sources: readonly StageSource[] = collectBundledStages()) {
    for (const entry of sources) {
      const circuit = loadStage(entry.data, entry.source);
      if (this.circuits.has(circuit.id)) {
        throw new Error(`duplicate stage id '${circuit.id}' (from ${entry.source})`);
      }
      this.circuits.set(circuit.id, circuit);
    }
    if (this.circuits.size === 0) {
      throw new Error("no stages found — add a JSON file under src/stage/data/");
    }
  }

  get size(): number {
    return this.circuits.size;
  }

  has(id: string): boolean {
    return this.circuits.has(id);
  }

  load(id: string): StageCircuit {
    const circuit = this.circuits.get(id);
    if (!circuit) throw new Error(`unknown stage: ${id}`);
    return circuit;
  }

  /** The stage-select catalog, ordered by id for a stable UI. */
  list(): StageCatalogEntry[] {
    return [...this.circuits.values()]
      .map((circuit) => ({
        id: circuit.id,
        name: circuit.name,
        biome: circuit.biome,
        difficulty: circuit.difficulty,
        lengthM: sampleSpline(circuit.spline, circuit.road.sampleStep).length,
        source: circuit.source,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
