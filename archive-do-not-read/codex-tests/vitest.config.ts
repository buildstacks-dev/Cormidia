import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  cacheDir: fileURLToPath(new URL("./.artifacts/cache/vite", import.meta.url)),
  test: {
    cache: false,
    environment: "node",
    include: ["specs/**/*.test.ts"],
    exclude: [".artifacts/**", "node_modules/**"],
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true,
  },
});
