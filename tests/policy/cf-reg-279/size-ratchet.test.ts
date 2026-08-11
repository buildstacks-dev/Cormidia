// CF-REG-279 — HB-139 — case-catalog.md §10.3 defect #279; control point T-9.
//
// Public-symbol count is the module-size gate; physical line count is the
// smoke alarm. Every fixture is deterministic and exercises the same command
// wired into `pnpm check`.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const checker = join(repoRoot, "scripts", "check-size-ratchet.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(root: string, baseline: string): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [checker, "--root", root, "--baseline", baseline], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

async function fixture(): Promise<{ root: string; baseline: string }> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-size-ratchet-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  return { root, baseline: join(root, "baseline.json") };
}

function sourceModule(exports: number, lines: number): string {
  if (lines < exports) throw new Error("fixture lines must cover exported declarations");
  return [
    ...Array.from({ length: exports }, (_, index) => `export const symbol${index} = ${index};`),
    ...Array.from({ length: lines - exports }, () => "// deterministic padding"),
  ]
    .join("\n")
    .concat("\n");
}

async function writeBaseline(
  path: string,
  modules: Record<string, { exports: number; lines: number; newModule: boolean }>,
): Promise<void> {
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, modules }, null, 2)}\n`);
}

describe("CF-REG-279 — size/export ratchet", () => {
  it("passes a new module at exactly ten exports and 300 lines", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "compliant.ts"), sourceModule(10, 300));
    await writeBaseline(baseline, {
      "src/compliant.ts": { exports: 10, lines: 300, newModule: true },
    });

    const result = await run(root, baseline);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("1 modules, 10 exports, 300 lines");
  });

  it("negative control: rejects a seeded eleventh export", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "too-many-exports.ts"), sourceModule(11, 11));
    await writeBaseline(baseline, {
      "src/too-many-exports.ts": { exports: 11, lines: 11, newModule: true },
    });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("new-module export baseline 11 exceeds 10");
  });

  it("negative control: rejects a seeded 301st line", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "too-many-lines.ts"), sourceModule(1, 301));
    await writeBaseline(baseline, {
      "src/too-many-lines.ts": { exports: 1, lines: 301, newModule: true },
    });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("new-module line baseline 301 exceeds 300");
  });

  it("rejects growth beyond both committed existing-module ceilings", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "grew.ts"), sourceModule(2, 3));
    await writeBaseline(baseline, {
      "src/grew.ts": { exports: 1, lines: 2, newModule: false },
    });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("exports grew from 1 to 2");
    expect(result.stderr).toContain("lines grew from 2 to 3");
    expect(result.stderr).toContain("explicit baseline edit and a named justification in the PR body");
  });

  it("fails closed on an empty source walk", async () => {
    const { root, baseline } = await fixture();
    await writeBaseline(baseline, {
      "src/missing.ts": { exports: 0, lines: 1, newModule: false },
    });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("source walk is empty");
  });

  it("fails closed on a malformed baseline", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "valid.ts"), sourceModule(1, 1));
    await writeFile(baseline, "{not-json\n");

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("baseline is unreadable or malformed");
  });

  it("fails closed when a walked module has no baseline coverage", async () => {
    const { root, baseline } = await fixture();
    await writeFile(join(root, "src", "uncovered.ts"), sourceModule(1, 1));
    await writeBaseline(baseline, {
      "src/stale.ts": { exports: 1, lines: 1, newModule: false },
    });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing baseline coverage: src/uncovered.ts");
    expect(result.stderr).toContain("baseline covers no current source module: src/stale.ts");
  });
});
