// CF-HARNESS-CI — HB-P7 manifest owner; HB-140 catalog-drift slice —
// case-catalog.yaml regeneration drift gate.
//
// Binds traceability convention 5 and case-catalog.md's front matter ("the two
// MUST agree ... disagreement is a corpus bug"): the machine catalog is derived
// from case-catalog.md + harness-backlog.md by case-catalog-generator.awk, and
// `scripts/check-catalog-drift.mjs` enforces byte-identical regeneration in the
// per-commit lane. These tests pin the gate itself (harness self-test standing
// rule): the committed corpus regenerates green; a seeded hand-edit to the
// committed YAML is red; a markdown edit without regeneration — the exact
// desync HB-140 was opened for — is red; and the fail-closed paths (missing
// committed YAML, generator corpus diagnostics, empty extraction walk) can
// never green, even when the bytes agree.

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const checker = join(repoRoot, "scripts", "check-catalog-drift.mjs");
const corpusFiles = ["case-catalog-generator.awk", "case-catalog.md", "harness-backlog.md", "case-catalog.yaml"];
const REGENERATION_COMMAND =
  "awk -f validation-design/case-catalog-generator.awk " +
  "validation-design/case-catalog.md validation-design/harness-backlog.md " +
  "> validation-design/case-catalog.yaml";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-catalog-drift-"));
  roots.push(root);
  const designRoot = join(root, "validation-design");
  await mkdir(designRoot, { recursive: true });
  for (const name of corpusFiles) {
    await copyFile(join(repoRoot, "validation-design", name), join(designRoot, name));
  }
  return root;
}

async function mutate(root: string, name: string, edit: (source: string) => string): Promise<void> {
  const path = join(root, "validation-design", name);
  const source = await readFile(path, "utf8");
  const edited = edit(source);
  expect(edited, `seeded edit to ${name} must change the file`).not.toBe(source);
  await writeFile(path, edited);
}

// Regenerate the fixture YAML from its (possibly mutated) markdown, so the
// fail-closed paths can be proven in isolation from the byte comparison.
async function regenerateFixtureYaml(root: string): Promise<void> {
  const designRoot = join(root, "validation-design");
  const result = await run("awk", [
    "-f",
    join(designRoot, "case-catalog-generator.awk"),
    join(designRoot, "case-catalog.md"),
    join(designRoot, "harness-backlog.md"),
  ]);
  expect(result.exitCode).toBe(0);
  await writeFile(join(designRoot, "case-catalog.yaml"), result.stdout);
}

describe("CF-HARNESS-CI — HB-140 — case-catalog.yaml regeneration drift gate", () => {
  it("passes on the committed corpus (regeneration is byte-identical)", async () => {
    const root = await fixtureRoot();
    const result = await run(process.execPath, [checker, root]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Catalog drift check passed");
  });

  it("rejects a seeded hand-edit to the committed YAML with the exact regeneration command", async () => {
    const root = await fixtureRoot();
    await mutate(root, "case-catalog.yaml", (source) =>
      source.replace(
        '{id: CF-HARNESS-CI, section: "Harness self-test register", status: implementable',
        '{id: CF-HARNESS-CI, section: "Harness self-test register", status: landed',
      ),
    );
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not byte-identical to its regeneration");
    expect(result.stderr).toContain("CF-HARNESS-CI");
    expect(result.stderr).toContain(REGENERATION_COMMAND);
  });

  it("rejects a case-catalog.md edit made without regenerating the YAML", async () => {
    // The exact desync HB-140 exists to catch: the human catalog moves, the
    // machine catalog silently keeps enforcing stale truth.
    const root = await fixtureRoot();
    await mutate(root, "case-catalog.md", (source) =>
      source.replace("| 1/2 | evid+refusal+det | FLOOR |", "| 2 | evid+refusal+det | FLOOR |"),
    );
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not byte-identical to its regeneration");
    expect(result.stderr).toContain(REGENERATION_COMMAND);
  });

  it("rejects a harness-backlog.md edit made without regenerating the YAML", async () => {
    const root = await fixtureRoot();
    // A brand-new ticket bullet always adds a tickets row to the extraction,
    // so this seed can never go vacuous as the real corpus evolves.
    await mutate(
      root,
      "harness-backlog.md",
      (source) => `${source}\n## Seeded drift fixture\n\n- **HB-998 — seeded ticket for the HB-140 spec.**\n`,
    );
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not byte-identical to its regeneration");
    expect(result.stderr).toContain(REGENERATION_COMMAND);
  });

  it("fails closed when the committed YAML is missing", async () => {
    const root = await fixtureRoot();
    await rm(join(root, "validation-design", "case-catalog.yaml"));
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("fail-closed on a missing or unreadable file");
    expect(result.stderr).toContain("case-catalog.yaml");
  });

  it("fails closed on generator corpus diagnostics even when the bytes agree", async () => {
    // An implementable family with no owning backlog ticket makes the
    // generator emit MISSING-OWNER on stderr while still exiting 0. Feeding
    // the diagnostic-carrying regeneration back into the fixture proves the
    // gate refuses on the diagnostics themselves, not only on drift.
    const root = await fixtureRoot();
    await mutate(root, "case-catalog.md", (source) =>
      source.replace(
        "| CF-HARNESS-REPORT |",
        "| CF-HARNESS-ORPHANED | seeded ownerless implementable family | 1 | det | FLOOR |\n| CF-HARNESS-REPORT |",
      ),
    );
    await regenerateFixtureYaml(root);
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("corpus diagnostics");
    expect(result.stderr).toContain("MISSING-OWNER: CF-HARNESS-ORPHANED");
  });

  it("fails closed on an empty extraction walk even when the bytes agree", async () => {
    const root = await fixtureRoot();
    await mutate(root, "case-catalog.md", () => "# emptied catalog\n");
    await mutate(root, "harness-backlog.md", () => "# emptied backlog\n");
    await regenerateFixtureYaml(root);
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("regeneration walk came back empty");
    expect(result.stderr).toContain("0 families");
  });
});
