import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { gradeLibrary } from "../../eval/graders/index.js";
import { grade as gradeStandard } from "../../eval/graders/standard-slug-options.js";
import { loadYamlFile, type EvalCaseManifest } from "../../scripts/eval/core.js";
import { gradeLiveCase } from "../../scripts/eval/live-executor.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("delivery task contracts state the compatibility boundaries revealed by retained Phase 6 misses", () => {
  expect(readFileSync("eval/tasks/quick-ignore-config.md", "utf8")).toMatch(/exact `.pnpm-store\/`[\s\S]+do not root-anchor/);
  expect(readFileSync("eval/tasks/standard-slug-options.md", "utf8")).toMatch(/`preserveUnderscores`[\s\S]+repeated underscores collapse to one/);
  expect(readFileSync("eval/tasks/deep-auth-migration.md", "utf8")).toMatch(/SHA-256[\s\S]+preserving the existing[\s\S]+`normalizeApiKey` export[\s\S]+script definitions[\s\S]+byte-for-byte unchanged/);
});

it("learning's pristine visible gate stays inside the declared no-network boundary", () => {
  const learning = loadYamlFile("eval/cases/learning/closure-v1.yaml") as EvalCaseManifest;
  expect(learning.side_effect_policy.network).toBe("forbidden");
  expect(learning.oracle.visible_commands).toEqual(["node --test test/auth.test.js"]);
});

it("delivery hidden graders retain the exact root-anchor, repeated-separator, and public-export near misses", async () => {
  const library = mkdtempSync(join(tmpdir(), "operon-eval-task-library-")); roots.push(library); cpSync("eval/apps/library/seed", library, { recursive: true });
  writeFileSync(join(library, ".gitignore"), "dist/\ncoverage/\n/.pnpm-store/\n");
  expect(gradeLibrary(library)).toBe(false);

  writeFileSync(join(library, "src/slug.js"), `export function slug(value, options = {}) {
  if (options.preserveUnderscores) return String(value).trim().toLowerCase().replaceAll(/[^a-z0-9_]+/g, "_").replaceAll(/^_|_$/g, "");
  return String(value).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}\n`);
  expect(await gradeStandard(library)).toBe(false);

  const service = mkdtempSync(join(tmpdir(), "operon-eval-task-service-")); roots.push(service); cpSync("eval/apps/service/seed", service, { recursive: true });
  writeFileSync(join(service, "src/auth.js"), `import { createHash } from "node:crypto";
export function fingerprintApiKey(value) { return createHash("sha256").update(String(value).trim()).digest("hex"); }\n`);
  await expect(gradeLiveCase("deep/auth-migration/v1", service)).resolves.toBe(false);
});
