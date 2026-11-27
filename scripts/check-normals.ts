// Dev diagnostic: asserts every bundled stage's road mesh has unit-length,
// upward-facing normals. Guards the reviewer-R1 regression (a degenerate cross
// product produced zero normals on flat stages).
//
//   bun scripts/check-normals.ts
//
// Exits non-zero if any road vertex normal is zero, non-unit, or not facing up.
import { StageLibrary } from "../src/stage/library";
import { buildStageWorld, disposeStageWorld } from "../src/stage/world";

const library = new StageLibrary();
let failures = 0;
for (const entry of library.list()) {
  const world = buildStageWorld(library.load(entry.id));
  const normal = world.road.geometry.getAttribute("normal");
  let zero = 0;
  let nonUnit = 0;
  let minimumUp = Infinity;
  for (let i = 0; i < normal.count; i += 1) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) zero += 1;
    else if (Math.abs(len - 1) > 1e-3) nonUnit += 1;
    minimumUp = Math.min(minimumUp, y);
  }
  const ok = zero === 0 && nonUnit === 0 && minimumUp > 0.9;
  if (!ok) failures += 1;
  console.log(
    `${entry.id.padEnd(16)} verts ${String(normal.count).padEnd(5)} ` +
      `zeroNormals ${String(zero).padEnd(4)} nonUnit ${nonUnit} ` +
      `minUp ${minimumUp.toFixed(3)} ${ok ? "OK" : "FAIL"}`,
  );
  disposeStageWorld(world);
}
if (failures > 0) {
  console.error(`${failures} stage(s) failed the road-normal check`);
  process.exit(1);
}
console.log(`road normals OK for ${library.size} stage(s)`);
