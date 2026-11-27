import { defineConfig } from "vitest/config";

// Unit tests are headless: the fixed-timestep loop is pure logic and the scene
// is exercised with real three.js objects + an injected fake RendererHandle.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
