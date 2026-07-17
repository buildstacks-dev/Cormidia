// Guards the whole-repo typecheck surface (ROOT-002 / P1-01).
//
// The build config (tsconfig.json) deliberately compiles only `src/**` into
// `dist/`. Typechecking must be WIDER than that: `scripts/**` (the release
// gate), `test/**`, and `eval/**` must be compiled by the same compiler as the
// product, or type errors — including ones that break documented commands —
// accumulate unseen. This test fails if the check surface silently regresses to
// src-only, or if `pnpm typecheck` stops pointing at the check config.
//
// Reads committed files only; no network, org state, or wall-clock time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, relative), "utf8")) as Record<string, unknown>;
}

describe("whole-repo typecheck configuration (ROOT-002)", () => {
  it("tsconfig.check.json extends the base config, emits nothing, and covers all four source trees", () => {
    const check = readJson("tsconfig.check.json");

    expect(check["extends"]).toBe("./tsconfig.json");

    const compilerOptions = check["compilerOptions"] as Record<string, unknown> | undefined;
    expect(compilerOptions?.["noEmit"]).toBe(true);
    // rootDir must be neutralized ("."), otherwise files outside src/ are
    // "not under rootDir" errors under the inherited build config.
    expect(compilerOptions?.["rootDir"]).toBe(".");

    const include = check["include"];
    expect(Array.isArray(include)).toBe(true);
    const patterns = include as string[];
    for (const tree of ["src", "scripts", "test", "eval"]) {
      expect(
        patterns.some((pattern) => pattern === `${tree}/**/*.ts` || pattern.startsWith(`${tree}/`)),
        `tsconfig.check.json include must cover ${tree}/`,
      ).toBe(true);
    }
  });

  it("the base build config keeps compiling only src/ into dist/", () => {
    const base = readJson("tsconfig.json");
    expect(base["include"]).toEqual(["src/**/*.ts"]);
    const compilerOptions = base["compilerOptions"] as Record<string, unknown>;
    expect(compilerOptions["rootDir"]).toBe("src");
    expect(compilerOptions["outDir"]).toBe("dist");
  });

  it("`pnpm typecheck` runs the wide check config, and `pnpm build` does not", () => {
    const pkg = readJson("package.json");
    const scripts = pkg["scripts"] as Record<string, string>;
    expect(scripts["typecheck"]).toContain("tsconfig.check.json");
    expect(scripts["typecheck"]).toContain("--noEmit");
    // The build must stay on the emitting base config, never the check config.
    expect(scripts["build"]).not.toContain("tsconfig.check.json");
  });
});
