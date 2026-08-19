// CF-HARNESS-CI — HB-140; #480 pre-commit drift-gate wiring.
//
// The checked-model drift gate is revision-bound: the public compiler refuses
// uncommitted product paths, so it can never pass while a product commit is
// being created. The pre-commit hook therefore runs `pnpm check:commit`,
// whose drift step (scripts/precommit-drift-gate.mjs) runs the unchanged
// strict gate against a clean product tree and defers loudly to CI otherwise.
// This detector pins the hook/scripts/CI wiring and the wrapper's
// skip-versus-propagate behavior: a wrapper that always skipped, a hook back
// on bare `pnpm check`, or a `pnpm check` without the strict gate turns red.

import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const wrapper = join(repoRoot, "scripts", "precommit-drift-gate.mjs");
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function packageScripts(): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
    throw new Error("package.json must contain a scripts object");
  }
  return parsed.scripts;
}

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-precommit-gate-"));
  roots.push(root);
  await mkdir(join(root, "validation-design"), { recursive: true });
  await writeFile(join(root, "product.txt"), "product\n");
  await writeFile(join(root, "validation-design", "notes.md"), "design\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-q", "-m", "fixture"], {
    cwd: root,
  });
  return root;
}

describe("CF-HARNESS-CI pre-commit drift-gate wiring (#480)", () => {
  it("routes the pre-commit hook through check:commit, never bare pnpm check", async () => {
    const hook = await readFile(join(repoRoot, ".githooks", "pre-commit"), "utf8");
    expect(hook).toMatch(/^pnpm check:commit$/m);
    expect(hook).not.toMatch(/^pnpm check$/m);
    const hooksPath = execFileSync("git", ["-C", repoRoot, "config", "core.hooksPath"], {
      encoding: "utf8",
    }).trim();
    expect(hooksPath).toBe(".githooks");
  });

  it("keeps the strict drift gate in pnpm check and in Core Checks CI", async () => {
    const scripts = await packageScripts();
    expect(scripts.check).toBe("pnpm check:tree && node scripts/check-catalog-drift.mjs");
    expect(scripts["check:commit"]).toBe("pnpm check:tree && node scripts/precommit-drift-gate.mjs");
    const tree = scripts["check:tree"];
    if (typeof tree !== "string") throw new Error("package.json must define a check:tree script");
    for (const gate of [
      "biome check --error-on-warnings .",
      "pnpm typecheck",
      "scripts/check-pinned-deps.mjs",
      "scripts/check-import-direction.mjs",
      "scripts/check-size-ratchet.mjs",
      "scripts/check-type-ratchet.mjs",
    ]) {
      expect(tree).toContain(gate);
    }
    const workflow = await readFile(join(repoRoot, ".github", "workflows", "core-checks.yml"), "utf8");
    expect(workflow).toMatch(/run: pnpm check$/m);
  });

  it("defers to CI when the product tree has uncommitted paths", async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, "staged-product.txt"), "dirty\n");
    execFileSync("git", ["add", "staged-product.txt"], { cwd: root });
    const result = await run(process.execPath, [wrapper, root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("deferred to CI");
    expect(result.stdout).toContain("staged-product.txt");
  });

  it("runs the strict gate against a clean product tree and propagates its refusal", async () => {
    const root = await fixtureRepo();
    const result = await run(process.execPath, [wrapper, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("fail-closed");
  });

  it("still runs the strict gate under a dirty validation-design/ overlay", async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, "validation-design", "notes.md"), "changed design overlay\n");
    const result = await run(process.execPath, [wrapper, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("fail-closed");
  });
});
