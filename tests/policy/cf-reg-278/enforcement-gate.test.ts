// CF-REG-278 — HB-139 — case-catalog.md §10.3 defect #278; control point T-9.
//
// The repository enforcement gate must be executable locally and in CI, and
// each new detector must prove it can reject a seeded violation.

import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writeSource(root: string, relativePath: string, source: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

describe("CF-REG-278 — repository enforcement gate", () => {
  it("pins the final pnpm check lane and committed core.hooksPath pre-commit hook", async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["check"]?.split(" && ")).toEqual([
      "biome check --error-on-warnings .",
      "pnpm typecheck",
      "node scripts/check-pinned-deps.mjs",
      "node scripts/check-import-direction.mjs",
      "node scripts/check-size-ratchet.mjs",
      "node scripts/check-type-ratchet.mjs",
      // HB-140 (CF-HARNESS-CI): case-catalog.yaml regeneration drift gate —
      // spec: tests/policy/cf-harness-ci/catalog-drift.test.ts.
      "node scripts/check-catalog-drift.mjs",
    ]);
    expect(packageJson.scripts["prepare"]).toBe("node scripts/install-git-hooks.mjs");

    const hookPath = join(repoRoot, ".githooks", "pre-commit");
    expect((await stat(hookPath)).mode & 0o111).not.toBe(0);
    expect(await readFile(hookPath, "utf8")).toBe("#!/bin/sh\nset -eu\n\npnpm check\n");
  });

  it("rejects a seeded floating dependency and accepts exact dependency forms", async () => {
    const root = await tempRoot("cormidia-pinned-deps-");
    const manifestPath = join(root, "package.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          dependencies: { exact: "1.2.3", alias: "npm:other-package@4.5.6" },
          devDependencies: { prerelease: "7.8.9-next.1" },
          optionalDependencies: { build: "10.11.12+fixture.1" },
        },
        null,
        2,
      )}\n`,
    );

    const checker = join(repoRoot, "scripts", "check-pinned-deps.mjs");
    const green = await run(process.execPath, [checker, root]);
    expect(green).toMatchObject({ exitCode: 0, stderr: "" });
    expect(green.stdout).toContain("Pinned dependency check passed (4 dependencies)");

    await writeFile(manifestPath, '{"dependencies":{"seeded-floating":"^1.2.3"}}\n');
    const red = await run(process.execPath, [checker, root]);
    expect(red.exitCode).toBe(1);
    expect(red.stderr).toContain("dependencies.seeded-floating must be pinned, found ^1.2.3");

    // Negative control + green: vendored file: tarballs are pins only when the
    // basename embeds an exact version (validation-architect enablement path).
    await writeFile(
      manifestPath,
      `${JSON.stringify({ devDependencies: { local: "file:vendor/tool-0.1.0.tgz" } }, null, 2)}\n`,
    );
    const fileGreen = await run(process.execPath, [checker, root]);
    expect(fileGreen).toMatchObject({ exitCode: 0, stderr: "" });

    await writeFile(
      manifestPath,
      `${JSON.stringify({ devDependencies: { local: "file:vendor/tool.tgz" } }, null, 2)}\n`,
    );
    const fileRed = await run(process.execPath, [checker, root]);
    expect(fileRed.exitCode).toBe(1);
    expect(fileRed.stderr).toContain("devDependencies.local must be pinned, found file:vendor/tool.tgz");
  });

  it("rejects all three forbidden import directions while accepting the allowed graph", async () => {
    const root = await tempRoot("cormidia-import-direction-");
    await writeSource(root, "src/runtime/base.ts", "export interface RuntimeValue { value: string }\n");
    await writeSource(root, "src/runtime/same-layer.ts", 'export type { RuntimeValue } from "./base.js";\n');
    await writeSource(
      root,
      "src/loop/allowed.ts",
      'import type { RuntimeValue } from "../runtime/base.js";\nexport const loop = (value: RuntimeValue) => value;\n',
    );
    await writeSource(
      root,
      "src/org/allowed.ts",
      'export { loop } from "../loop/allowed.js";\nexport type Runtime = import("../runtime/base.js").RuntimeValue;\n',
    );

    const checker = join(repoRoot, "scripts", "check-import-direction.mjs");
    const green = await run(process.execPath, [checker, root]);
    expect(green).toMatchObject({ exitCode: 0, stderr: "" });
    expect(green.stdout).toContain("Import-direction check passed (4 relative imports");

    await writeSource(root, "src/runtime/to-loop.ts", 'import "../loop/allowed.js";\n');
    await writeSource(root, "src/runtime/to-org.ts", 'export * from "../org/allowed.js";\n');
    await writeSource(root, "src/loop/to-org.ts", 'type Forbidden = import("../org/allowed.js").Runtime;\n');
    const red = await run(process.execPath, [checker, root]);
    expect(red.exitCode).toBe(1);
    expect(red.stderr).toContain("src/runtime may not import src/loop");
    expect(red.stderr).toContain("src/runtime may not import src/org");
    expect(red.stderr).toContain("src/loop may not import src/org");
  });

  // The rule the checker exists to enforce covers every source layer, but the
  // rank map used to hold only runtime/loop/org and an unranked directory was
  // silently skipped — so src/cli, src/observe, src/report and src/narrative
  // were exempt with the check still green. These are the negative controls for
  // that fail-open path: each seeds the violation and asserts the check FIRES.
  it("negative control: an unranked top-level src/ directory fails the check instead of being skipped", async () => {
    const root = await tempRoot("cormidia-import-unranked-");
    await writeSource(root, "src/runtime/base.ts", "export interface RuntimeValue { value: string }\n");
    // A brand-new subsystem that reaches upward into org. Under the old skip
    // behavior this exited 0 and reported "check passed".
    await writeSource(root, "src/org/allowed.ts", "export const org = 1;\n");
    await writeSource(root, "src/brandnew/reaches-up.ts", 'export { org } from "../org/allowed.js";\n');

    const checker = join(repoRoot, "scripts", "check-import-direction.mjs");
    const red = await run(process.execPath, [checker, root]);
    expect(red.exitCode).toBe(1);
    expect(red.stderr).toContain("src/brandnew: unranked, so its imports were never checked");
    expect(red.stderr).toContain("layerRank");
  });

  it("negative control: an unexempted top-level src/ entry file fails the check", async () => {
    const root = await tempRoot("cormidia-import-entryfile-");
    await writeSource(root, "src/runtime/base.ts", "export const base = 1;\n");
    await writeSource(root, "src/rogue-entry.ts", 'export { base } from "./runtime/base.js";\n');

    const checker = join(repoRoot, "scripts", "check-import-direction.mjs");
    const red = await run(process.execPath, [checker, root]);
    expect(red.exitCode).toBe(1);
    expect(red.stderr).toContain("rogue-entry.ts");
    expect(red.stderr).toContain("not exempted");
  });

  it("enforces the presentation leaves and jobs, which the rank map previously exempted", async () => {
    const root = await tempRoot("cormidia-import-leaves-");
    await writeSource(root, "src/runtime/base.ts", "export const base = 1;\n");
    await writeSource(root, "src/org/allowed.ts", 'export { base } from "../runtime/base.js";\n');
    // Legal: leaves and jobs consume org; observe consumes report; cli consumes all.
    await writeSource(root, "src/report/ok.ts", 'export { allowed } from "../org/allowed.js";\n');
    await writeSource(root, "src/narrative/ok.ts", 'export { base } from "../runtime/base.js";\n');
    await writeSource(root, "src/jobs/ok.ts", 'export { allowed } from "../org/allowed.js";\n');
    await writeSource(root, "src/observe/ok.ts", 'export { ok } from "../report/ok.js";\n');
    await writeSource(root, "src/cli/ok.ts", 'export { ok } from "../observe/ok.js";\n');

    const checker = join(repoRoot, "scripts", "check-import-direction.mjs");
    const green = await run(process.execPath, [checker, root]);
    expect(green).toMatchObject({ exitCode: 0, stderr: "" });

    // Forbidden: the governed loop must never depend on a leaf or on jobs.
    await writeSource(root, "src/org/to-report.ts", 'export { ok } from "../report/ok.js";\n');
    await writeSource(root, "src/loop/to-jobs.ts", 'export { ok } from "../jobs/ok.js";\n');
    await writeSource(root, "src/report/to-observe.ts", 'export { ok } from "../observe/ok.js";\n');
    const red = await run(process.execPath, [checker, root]);
    expect(red.exitCode).toBe(1);
    expect(red.stderr).toContain("src/org may not import src/report");
    expect(red.stderr).toContain("src/loop may not import src/jobs");
    expect(red.stderr).toContain("src/report may not import src/observe");
  });

  it("scrubs provider credentials, moves HOME, preserves PATH, and fixes UTC", async () => {
    const seededValue = ["generated", "credential", "fixture"].join("-");
    const result = await run("bash", [join(repoRoot, "scripts", "test.sh"), "--probe-environment"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENAI_API_KEY: seededValue,
        ANTHROPIC_API_KEY: seededValue,
        GH_TOKEN: seededValue,
        CORMIDIA_SECRET: seededValue,
      },
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "") as {
      credentialKeys: string[];
      home: string;
      pathPresent: boolean;
      timezone: string;
    };
    expect(report).toMatchObject({ credentialKeys: [], pathPresent: true, timezone: "UTC" });
    expect(report.home).not.toBe(process.env["HOME"]);
  });

  it("installs the committed hook through core.hooksPath in a repository root", async () => {
    const root = await tempRoot("cormidia-hooks-");
    await mkdir(join(root, "scripts"), { recursive: true });
    const installer = join(root, "scripts", "install-git-hooks.mjs");
    await copyFile(join(repoRoot, "scripts", "install-git-hooks.mjs"), installer);
    await mkdir(join(root, ".githooks"), { recursive: true });
    await writeFile(join(root, ".githooks", "pre-commit"), "#!/bin/sh\npnpm check\n");
    await chmod(join(root, ".githooks", "pre-commit"), 0o755);

    expect((await run("git", ["init", "--quiet"], { cwd: root })).exitCode).toBe(0);
    expect((await run(process.execPath, [installer], { cwd: root })).exitCode).toBe(0);
    const configured = await run("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: root });
    expect(configured).toMatchObject({ exitCode: 0, stdout: ".githooks\n", stderr: "" });
  });
});
