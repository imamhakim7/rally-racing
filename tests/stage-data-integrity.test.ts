import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stageModules } from "../src/stage/data";

/**
 * Guards the generated stage index against drift: adding a JSON without
 * regenerating (or deleting one and leaving a stale entry) fails loudly here
 * instead of silently shipping a stage that never loads.
 */
describe("generated stage index", () => {
  it("lists exactly the stage JSON files on disk (AC1/AC6)", () => {
    const dir = resolve(process.cwd(), "src/stage/data");
    const onDisk = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort();
    expect(Object.keys(stageModules).sort()).toEqual(onDisk);
  });

  it("each entry's id matches its file name", () => {
    for (const [file, module] of Object.entries(stageModules)) {
      const data = (module as { default?: { id?: string } }).default;
      expect(data?.id).toBe(file.replace(/\.json$/, ""));
    }
  });
});
