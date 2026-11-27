// CLI: validate a stage JSON file and print a clear error on failure.
//
//   bun scripts/validate-stage.ts src/stage/data/alpine-forest.json
//
// Exits 1 when the stage is malformed, naming every offending field; exits 0
// when it is valid. Handy for authors and for a pre-commit hook once #APEX-6
// lands an asset pipeline.
import { readFileSync } from "node:fs";
import { formatStageError } from "../src/stage/errors";
import { parseStage } from "../src/stage/loader";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/validate-stage.ts <stage.json>");
  process.exit(2);
}

try {
  const source = readFileSync(file, "utf8");
  const circuit = parseStage(source, file);
  console.log(
    `OK ${circuit.id} — ${circuit.name} (${circuit.biome}), ` +
      `${circuit.checkpoints.length} checkpoints, ${circuit.surfaces.length} surface zones, ` +
      `road ${circuit.road.width}m`,
  );
} catch (error) {
  console.error(formatStageError(error));
  process.exit(1);
}
