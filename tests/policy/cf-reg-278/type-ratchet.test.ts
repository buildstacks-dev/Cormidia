// CF-REG-278 — HB-139 — case-catalog.md §10.3 defect #278; control point T-9.
//
// Type-escape-hatch ratchet (#402): `as T` (excluding `as const`/`as unknown`)
// and non-null `!` may never grow. A file absent from the baseline has ceiling
// zero, so new code is fail-closed; drops must be committed via --write, which
// refuses to raise a ceiling. Same detector discipline as the size ratchet:
// every rejection path lands red against a seeded violation.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const checker = join(repoRoot, "scripts", "check-type-ratchet.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(root: string, baseline: string, extraArgs: string[] = []): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [checker, "--root", root, "--baseline", baseline, ...extraArgs], {
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
  const root = await mkdtemp(join(tmpdir(), "cormidia-type-ratchet-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  return { root, baseline: join(root, "baseline.json") };
}

async function writeBaseline(path: string, files: Record<string, { as: number; nonNull: number }>): Promise<void> {
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`);
}

async function writeSource(root: string, relativePath: string, source: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

// Baseline readback narrows from unknown instead of casting — the same
// parse-don't-cast discipline this detector exists to enforce.
async function baselineFiles(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || !("files" in parsed)) {
    throw new Error(`malformed baseline: ${path}`);
  }
  const files = parsed.files;
  if (files === null || typeof files !== "object" || Array.isArray(files)) {
    throw new Error(`malformed baseline files: ${path}`);
  }
  return Object.fromEntries(Object.entries(files));
}

async function baselineEntry(path: string, file: string): Promise<{ as: number; nonNull: number }> {
  const value = (await baselineFiles(path))[file];
  if (value === null || typeof value !== "object" || !("as" in value) || !("nonNull" in value)) {
    throw new Error(`baseline entry missing or malformed: ${file}`);
  }
  const { as: asCount, nonNull: nonNullCount } = value;
  if (typeof asCount !== "number" || typeof nonNullCount !== "number") {
    throw new Error(`baseline counts must be numbers: ${file}`);
  }
  return { as: asCount, nonNull: nonNullCount };
}

describe("CF-REG-278 — type escape-hatch ratchet", () => {
  it("passes a tree whose counts sit exactly at the committed ceilings", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/debt.ts", 'export const value = JSON.parse("{}") as { field: number };\n');
    await writeSource(root, "tests/debt.test.ts", "export const first = [1][0]!;\n");
    await writeBaseline(baseline, {
      "src/debt.ts": { as: 1, nonNull: 0 },
      "tests/debt.test.ts": { as: 0, nonNull: 1 },
    });

    const result = await run(root, baseline);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("2 files with debt, 1 as-assertions, 1 non-null");
  });

  it("negative control: a NEW file with a seeded `as` fails closed at ceiling zero", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/new-code.ts", 'export const value = JSON.parse("{}") as { field: number };\n');
    await writeBaseline(baseline, {});

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("src/new-code.ts: as-assertions grew from 0 to 1");
    expect(result.stderr).toContain("named justification in the PR body");
  });

  it("negative control: growth beyond a covered file's ceiling fails for both metrics", async () => {
    const { root, baseline } = await fixture();
    await writeSource(
      root,
      "src/grew.ts",
      'export const one = JSON.parse("{}") as { a: number };\n' +
        'export const two = JSON.parse("{}") as { b: number };\n' +
        "export const bang = [1][0]!;\n",
    );
    await writeBaseline(baseline, { "src/grew.ts": { as: 1, nonNull: 0 } });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("src/grew.ts: as-assertions grew from 1 to 2");
    expect(result.stderr).toContain("src/grew.ts: non-null assertions grew from 0 to 1");
  });

  it("`as const` and `as unknown` are not debt (negative control against overcounting)", async () => {
    const { root, baseline } = await fixture();
    await writeSource(
      root,
      "src/clean.ts",
      'export const frozen = { mode: "exact" } as const;\nexport const opaque = JSON.parse("{}") as unknown;\n',
    );
    await writeBaseline(baseline, {});

    const result = await run(root, baseline);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("0 files with debt");
  });

  it("a drop below the ceiling fails until --write tightens the baseline, then passes", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/improved.ts", 'export const value = JSON.parse("{}") as { field: number };\n');
    await writeBaseline(baseline, { "src/improved.ts": { as: 2, nonNull: 1 } });

    const stale = await run(root, baseline);
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toContain("src/improved.ts: as-assertions fell from 2 to 1");
    expect(stale.stderr).toContain("src/improved.ts: non-null assertions fell from 1 to 0");
    expect(stale.stderr).toContain("--write");

    const write = await run(root, baseline, ["--write"]);
    expect(write).toMatchObject({ exitCode: 0, stderr: "" });
    const tightened = await run(root, baseline);
    expect(tightened).toMatchObject({ exitCode: 0, stderr: "" });

    expect(await baselineEntry(baseline, "src/improved.ts")).toEqual({ as: 1, nonNull: 0 });
  });

  it("--write refuses to raise a ceiling: increases stay a human baseline edit", async () => {
    const { root, baseline } = await fixture();
    await writeSource(
      root,
      "src/grew.ts",
      'export const one = JSON.parse("{}") as { a: number };\nexport const two = JSON.parse("{}") as { b: number };\n',
    );
    await writeBaseline(baseline, { "src/grew.ts": { as: 1, nonNull: 0 } });

    const refused = await run(root, baseline, ["--write"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("--write refused");
    expect(refused.stderr).toContain("src/grew.ts: as-assertions grew from 1 to 2");
    expect(await baselineEntry(baseline, "src/grew.ts")).toEqual({ as: 1, nonNull: 0 });
  });

  it("a stale baseline entry for a removed file fails until --write prunes it", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/kept.ts", "export const kept = 1;\n");
    await writeBaseline(baseline, { "src/removed.ts": { as: 3, nonNull: 0 } });

    const stale = await run(root, baseline);
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toContain("src/removed.ts: baseline entry is stale");

    const write = await run(root, baseline, ["--write"]);
    expect(write).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Object.keys(await baselineFiles(baseline))).toEqual([]);
  });

  it("fails closed on a malformed baseline and on a missing baseline", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/any.ts", "export const value = 1;\n");
    await writeFile(baseline, "{not-json\n");
    const malformed = await run(root, baseline);
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain("baseline is unreadable or malformed");

    await rm(baseline);
    const missing = await run(root, baseline);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("baseline is unreadable or malformed");
  });

  it("fails closed when a debt-free entry lingers in the baseline", async () => {
    const { root, baseline } = await fixture();
    await writeSource(root, "src/clean.ts", "export const value = 1;\n");
    await writeBaseline(baseline, { "src/clean.ts": { as: 0, nonNull: 0 } });

    const result = await run(root, baseline);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("debt-free and must be removed");
  });

  it("the committed repository baseline matches the tree exactly (no drift, no slack)", async () => {
    const result = await run(repoRoot, join(repoRoot, "scripts", "type-ratchet-baseline.json"));
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Type ratchet passed");
  });
});
