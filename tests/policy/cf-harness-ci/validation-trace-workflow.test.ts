// CF-HARNESS-CI — HB-P7 — #431 deterministic closure command and fail-closed CI wiring.

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packagePath = join(repoRoot, "package.json");
const coreWorkflowPath = join(repoRoot, ".github", "workflows", "core-checks.yml");
const traceWorkflowPath = join(repoRoot, ".github", "workflows", "validation-trace.yml");
const installGuidePath = join(repoRoot, "validation-design", "enablement", "INSTALL.md");
const manifestPath = join(repoRoot, "validation-design", "case-catalog.yaml");
const EXACT_SCRIPT =
  '"validation:trace": "validation-trace . --manifest validation-design/case-catalog.yaml --tests tests"';
const RUNNER_ROUTE =
  "runs-on: ${{ ((github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository) || (github.event_name == 'workflow_dispatch' && inputs.compute == 'github-hosted')) && 'ubuntu-latest' || 'cormidia-core-linux-arm64' }}";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ClosureSurfaces {
  packageJson: string;
  coreWorkflow: string;
  traceWorkflow: string;
  installGuide: string;
}

async function run(command: string, args: string[], cwd = repoRoot): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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

async function readSurfaces(): Promise<ClosureSurfaces> {
  const [packageJson, coreWorkflow, traceWorkflow, installGuide] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(coreWorkflowPath, "utf8"),
    readFile(traceWorkflowPath, "utf8"),
    readFile(installGuidePath, "utf8"),
  ]);
  return { packageJson, coreWorkflow, traceWorkflow, installGuide };
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function closureSurfaceProblems(surfaces: ClosureSurfaces): string[] {
  const problems: string[] = [];
  const { packageJson, coreWorkflow, traceWorkflow, installGuide } = surfaces;
  if (!packageJson.includes(EXACT_SCRIPT)) problems.push("package script drift");
  if (occurrences(coreWorkflow, "run: pnpm validation:trace") !== 1) problems.push("Core Checks command drift");
  if (occurrences(traceWorkflow, "run: pnpm validation:trace") !== 1) problems.push("dedicated command drift");
  if (!traceWorkflow.includes("on:\n  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:")) {
    problems.push("dedicated trigger drift");
  }
  const workflows: Array<[string, string]> = [
    ["Core Checks", coreWorkflow],
    ["dedicated", traceWorkflow],
  ];
  for (const [name, workflow] of workflows) {
    if (!workflow.includes(RUNNER_ROUTE)) problems.push(`${name} runner drift`);
    if (!workflow.includes("pnpm install --frozen-lockfile")) problems.push(`${name} install drift`);
    if (!workflow.includes("persist-credentials: false")) problems.push(`${name} checkout credentials drift`);
    if (workflow.includes("continue-on-error") || workflow.includes("|| true")) problems.push(`${name} fail-open`);
    if (workflow.includes("secrets.")) problems.push(`${name} secret dependency`);
  }
  if (!traceWorkflow.includes("expected_sha:") || !traceWorkflow.includes('test "${GITHUB_SHA}" = "${EXPECTED_SHA}"')) {
    problems.push("dedicated exact-SHA guard drift");
  }
  if (
    !installGuide.includes("proves deterministic closure only") ||
    !installGuide.includes("Fidelity remains a separate")
  ) {
    problems.push("closure projected as fidelity");
  }
  return problems;
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-validation-trace-"));
  roots.push(root);
  return root;
}

async function invokeTrace(root: string): Promise<CommandResult> {
  return await run("pnpm", [
    "exec",
    "validation-trace",
    root,
    "--manifest",
    join(root, "validation-design", "case-catalog.yaml"),
    "--tests",
    "tests",
  ]);
}

async function writeMinimalManifest(root: string): Promise<void> {
  await mkdir(join(root, "validation-design"), { recursive: true });
  await writeFile(
    join(root, "validation-design", "case-catalog.yaml"),
    [
      "schema: validation-architect/case-catalog/v1",
      "families:",
      "  - {id: CF-SEED, section: Seed, status: implementable, layers: '1', oracle: det, risk: FLOOR, ticket: HB-999, wave: seed}",
      "tickets:",
      "  - {id: HB-999, wave: seed, status: landed, families: [CF-SEED]}",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(join(root, "tests"), { recursive: true });
}

async function writeSeedSpec(root: string, directory: string, header: string): Promise<void> {
  const specRoot = join(root, "tests", directory);
  await mkdir(specRoot, { recursive: true });
  await writeFile(join(specRoot, "seed.test.ts"), `${header}\n\nit("seed", () => {});\n`, "utf8");
}

describe("CF-HARNESS-CI — #431 closure workflow", () => {
  it("pins one exact command across the package and both fail-closed CI lanes", async () => {
    expect(closureSurfaceProblems(await readSurfaces())).toEqual([]);
  });

  it("detects seeded command, trigger, route, fail-open, secret, and SHA-guard drift", async () => {
    const surfaces = await readSurfaces();
    expect(
      closureSurfaceProblems({
        ...surfaces,
        packageJson: surfaces.packageJson.replace(EXACT_SCRIPT, '"validation:trace": "true"'),
      }),
    ).toContain("package script drift");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: surfaces.traceWorkflow.replace(
          "run: pnpm validation:trace",
          "run: pnpm exec validation-trace .",
        ),
      }),
    ).toContain("dedicated command drift");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: surfaces.traceWorkflow.replace("  pull_request:\n", "  pull_request-disabled:\n"),
      }),
    ).toContain("dedicated trigger drift");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: surfaces.traceWorkflow.replace(RUNNER_ROUTE, "runs-on: ubuntu-latest"),
      }),
    ).toContain("dedicated runner drift");
    expect(
      closureSurfaceProblems({ ...surfaces, traceWorkflow: `${surfaces.traceWorkflow}\ncontinue-on-error: true\n` }),
    ).toContain("dedicated fail-open");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: `${surfaces.traceWorkflow}\nenv: \${{ secrets.TRACE_TOKEN }}\n`,
      }),
    ).toContain("dedicated secret dependency");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: surfaces.traceWorkflow.replace("expected_sha:", "candidate_sha:"),
      }),
    ).toContain("dedicated exact-SHA guard drift");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        installGuide: surfaces.installGuide.replace("Fidelity remains a separate", "Fidelity is proven by this"),
      }),
    ).toContain("closure projected as fidelity");
  });

  it("runs the repository-owned closure command green", async () => {
    const result = await run("pnpm", ["validation:trace"]);
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("fails when the validation-architect package is unavailable", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        scripts: {
          "validation:trace": "validation-trace . --manifest validation-design/case-catalog.yaml --tests tests",
        },
      }),
    );
    const result = await run("pnpm", ["--dir", root, "validation:trace"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("propagates a seeded nonzero package command used by both workflow paths", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, scripts: { "validation:trace": 'node -e "process.exit(23)"' } }),
    );
    const result = await run("pnpm", ["--dir", root, "validation:trace"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("fails closed for a missing manifest", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "tests"), { recursive: true });
    const result = await invokeTrace(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("manifest:");
  });

  it("fails closed for a missing tests root", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "validation-design"), { recursive: true });
    await copyFile(manifestPath, join(root, "validation-design", "case-catalog.yaml"));
    const result = await invokeTrace(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("tests root");
  });

  it("fails closed for a manifest schema mismatch", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "validation-design"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "validation-design", "case-catalog.yaml"), "schema: wrong\n", "utf8");
    const result = await invokeTrace(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected");
  });

  it("fails closed when an implementable catalog has no citing specs", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "validation-design"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await copyFile(manifestPath, join(root, "validation-design", "case-catalog.yaml"));
    const result = await invokeTrace(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("forward:");
  });

  it("rejects unknown family/ticket citations and wrong directory/header structure", async () => {
    const unknownFamily = await fixtureRoot();
    await writeMinimalManifest(unknownFamily);
    await writeSeedSpec(unknownFamily, "cf-seed", "// CF-UNKNOWN — HB-999");
    expect((await invokeTrace(unknownFamily)).stderr).toContain('cites unknown family "CF-UNKNOWN"');

    const unknownTicket = await fixtureRoot();
    await writeMinimalManifest(unknownTicket);
    await writeSeedSpec(unknownTicket, "cf-seed", "// CF-SEED — HB-UNKNOWN");
    expect((await invokeTrace(unknownTicket)).stderr).toContain("header cites unknown ticket HB-UNKNOWN");

    const wrongDirectory = await fixtureRoot();
    await writeMinimalManifest(wrongDirectory);
    await writeSeedSpec(wrongDirectory, "wrong-directory", "// CF-SEED — HB-999");
    expect((await invokeTrace(wrongDirectory)).stderr).toContain("is not under a directory named for that family");

    const missingHeader = await fixtureRoot();
    await writeMinimalManifest(missingHeader);
    await writeSeedSpec(missingHeader, "cf-seed", "");
    expect((await invokeTrace(missingHeader)).stderr).toContain("does not begin with a comment header");
  });
});
