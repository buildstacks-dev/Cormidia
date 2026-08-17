// CF-HARNESS-CI — HB-P7 — #431 deterministic closure command and fail-closed CI wiring.

import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check, compile, FakeRepositoryPort } from "validation-architect";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packagePath = join(repoRoot, "package.json");
const coreWorkflowPath = join(repoRoot, ".github", "workflows", "core-checks.yml");
const traceWorkflowPath = join(repoRoot, ".github", "workflows", "validation-trace.yml");
const installGuidePath = join(repoRoot, "validation-design", "enablement", "INSTALL.md");
const EXACT_SCRIPT =
  '"validation:trace": "validation-trace . --manifest validation-design/case-catalog.yaml --tests tests"';
const RUNNER_ROUTE =
  "runs-on: ${{ ((github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository) || (github.event_name == 'workflow_dispatch' && inputs.compute == 'github-hosted')) && 'ubuntu-latest' || 'cormidia-core-linux-arm64' }}";
const FULL_HISTORY_CHECKOUT = [
  "- uses: actions/checkout@v6",
  "        with:",
  "          fetch-depth: 0",
  "          persist-credentials: false",
].join("\n");
const MODEL_FILES = [
  "project.yaml",
  "owners.yaml",
  "sources.yaml",
  "structures.yaml",
  "policy.yaml",
  "controls.yaml",
  "families.yaml",
  "backlog.yaml",
] as const;
const CHECKED_MODEL_SELECTED =
  "validation-trace checked-model authority selected: --manifest has no effect and --tests maps to --tests-root.";
const LEGACY_BRIDGE_ACTIVE =
  "validation-trace legacy manifest bridge active: no checked-model files were found; this bridge is removed at 1.0.";

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
  const coreJobWorkflow = coreWorkflow.split("\n  gitleaks:\n", 1)[0] ?? "";
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
  if (!coreJobWorkflow.includes(FULL_HISTORY_CHECKOUT)) problems.push("Core Checks shallow checkout");
  if (!traceWorkflow.includes(FULL_HISTORY_CHECKOUT)) problems.push("dedicated shallow checkout");
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

async function invokeTrace(
  root: string,
  manifest = join(root, "validation-design", "case-catalog.yaml"),
): Promise<CommandResult> {
  return await run("pnpm", ["exec", "validation-trace", root, "--manifest", manifest, "--tests", "tests"]);
}

async function writeMinimalManifest(root: string, includeTestsRoot = true): Promise<void> {
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
  if (includeTestsRoot) await mkdir(join(root, "tests"), { recursive: true });
}

async function writeSeedSpec(root: string, directory: string, header: string): Promise<void> {
  const specRoot = join(root, "tests", directory);
  await mkdir(specRoot, { recursive: true });
  await writeFile(join(specRoot, "seed.test.ts"), `${header}\n\nit("seed", () => {});\n`, "utf8");
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initializeGit(root: string): string {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture: product"]);
  return git(root, ["rev-parse", "HEAD"]);
}

function checkedModelFiles(
  revision: string,
  structureMeaning = "An exact model sentinel selects checked-model authority at E1/E2 (risk-review-gated).",
): Record<string, string> {
  const emptyLayers = ["L2", "L3", "L4", "L5", "L6"].map((id) => ({
    id,
    title: id,
    status: "declared-empty",
    reason: "The alias fixture has no cases at this layer.",
  }));
  const emptyLanes = ["triggered", "release", "scheduled"].map((id) => ({
    id,
    title: id,
    kind: "evidence",
    status: "declared-empty",
    requirement: "blocking",
    triggers: ["fixture"],
    reason: "The alias fixture has no cases in this lane.",
  }));
  const model: Record<string, unknown> = {
    "project.yaml": {
      schema: "validation-architect/model/project/v1",
      product: {
        id: "alias-fixture",
        name: "Alias fixture",
        revision,
        intended_use: "Exercise checked-model selection through the deprecated alias.",
        criticality: "C0",
        criticality_reason: "Offline deterministic fixture.",
      },
      versions: {
        package: "0.4.6",
        method: "0.8.0",
        model: "validation-architect/corpus/v1",
        compiler: "validation-architect/compiler/v1",
        policy: "validation-architect/policy/v1",
        result: "validation-architect/result/v1",
        golden_set: "validation-architect/golden-set/v1",
      },
    },
    "owners.yaml": {
      schema: "validation-architect/model/owners/v1",
      owners: [{ id: "owner", name: "Owner", responsibility: "Own the alias fixture." }],
    },
    "sources.yaml": {
      schema: "validation-architect/model/sources/v1",
      sources: [{ id: "SOURCE", kind: "doc", path: "README.md" }],
    },
    "structures.yaml": {
      schema: "validation-architect/model/structures/v1",
      structures: [
        {
          id: "INV-ALIAS",
          kind: "invariant",
          title: "Alias authority selection",
          meaning: structureMeaning,
          owner: "owner",
          source_ids: ["SOURCE"],
        },
      ],
    },
    "policy.yaml": {
      schema: "validation-architect/model/policy/v1",
      default: "blocking",
      inheritance: "tighten-only",
      layers: [{ id: "L1", title: "L1", status: "active" }, ...emptyLayers],
      lanes: [
        {
          id: "inner-loop",
          title: "Inner loop",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["before-push"],
          command: "pnpm test",
        },
        {
          id: "per-commit",
          title: "Per commit",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["per-commit"],
          command: "pnpm test",
        },
        ...emptyLanes,
      ],
      exceptions: [],
    },
    "controls.yaml": {
      schema: "validation-architect/model/controls/v1",
      controls: [
        {
          id: "NC-ALIAS",
          title: "Alias negative control",
          family_id: "CF-ALIAS",
          owner: "owner",
          expected_failure: "A partial model must fail without legacy fallback.",
        },
      ],
    },
    "families.yaml": {
      schema: "validation-architect/model/families/v1",
      families: [
        {
          id: "CF-ALIAS",
          title: "Alias selection",
          meaning: "The deprecated alias delegates to checked-model authority.",
          structure_ids: ["INV-ALIAS"],
          owner: "owner",
          source_ids: ["SOURCE"],
          lane: "per-commit",
          status: "implementable",
          layer: "L1",
          oracle: "det",
          risk: "FLOOR",
          control_ids: ["NC-ALIAS"],
          ticket: "HB-ALIAS",
          planned_tests: ["tests/cf-alias/seed.test.ts"],
        },
      ],
    },
    "backlog.yaml": {
      schema: "validation-architect/model/backlog/v1",
      tickets: [
        {
          id: "HB-ALIAS",
          title: "Alias contract",
          wave: "transition",
          status: "landed",
          owner: "owner",
          executor: "builder",
          lane: "per-commit",
          layer: "L1",
          acceptance_criteria: ["Checked-model selection is fail closed."],
          family_ids: ["CF-ALIAS"],
        },
      ],
    },
  };
  return Object.fromEntries(
    MODEL_FILES.map((name) => [`validation-design/model/${name}`, `${JSON.stringify(model[name], null, 2)}\n`]),
  );
}

async function writeCompleteCheckedModel(root: string): Promise<string> {
  await writeFile(join(root, "README.md"), "# Alias fixture\n", "utf8");
  await writeSeedSpec(root, "cf-alias", "// CF-ALIAS — HB-ALIAS");
  const revision = initializeGit(root);
  const files = checkedModelFiles(revision);
  const compiled = await compile(new FakeRepositoryPort({ revision, files }));
  if (!compiled.accepted || compiled.identity === undefined)
    throw new Error("alias checked-model fixture did not compile");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  for (const [name, content] of Object.entries(compiled.views)) {
    await writeFile(join(root, "validation-design", name), content, "utf8");
  }
  git(root, ["add", "validation-design"]);
  git(root, ["commit", "-qm", "fixture: checked model"]);
  return revision;
}

describe("CF-HARNESS-CI — #431 closure workflow", () => {
  it("pins one exact command across the package and both fail-closed CI lanes", async () => {
    expect(closureSurfaceProblems(await readSurfaces())).toEqual([]);
  });

  it("detects seeded command, trigger, route, shallow checkout, fail-open, secret, and SHA-guard drift", async () => {
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
      closureSurfaceProblems({
        ...surfaces,
        coreWorkflow: surfaces.coreWorkflow.replace("          fetch-depth: 0\n", "          fetch-depth: 1\n"),
      }),
    ).toContain("Core Checks shallow checkout");
    expect(
      closureSurfaceProblems({
        ...surfaces,
        traceWorkflow: surfaces.traceWorkflow.replace("          fetch-depth: 0\n", "          fetch-depth: 1\n"),
      }),
    ).toContain("dedicated shallow checkout");
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

  it("ignores a nonexistent legacy --manifest once a complete checked model is selected", async () => {
    const root = await fixtureRoot();
    const revision = await writeCompleteCheckedModel(root);
    const result = await invokeTrace(root, join(root, "validation-design", "does-not-exist.yaml"));
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain(CHECKED_MODEL_SELECTED);
    expect(result.stderr).not.toContain(LEGACY_BRIDGE_ACTIVE);
    expect(result.stdout).toContain(`revision: ${revision}`);
  });

  it("keeps reviewed hyphenated prose safe and redacts a standalone credential-shaped token", async () => {
    const revision = "b".repeat(40);
    const supportFiles = {
      "README.md": "# Alias fixture\n",
      "tests/cf-alias/seed.test.ts": '// CF-ALIAS — HB-ALIAS\n\nit("seed", () => {});\n',
    };
    const safe = await check(
      new FakeRepositoryPort({ revision, files: { ...checkedModelFiles(revision), ...supportFiles } }),
      { testsRoot: "tests" },
    );
    const safeBytes = JSON.stringify(safe);
    expect(safeBytes).toContain("risk-review-gated");
    expect(safeBytes).not.toContain("MODEL_SECRET_UNSAFE");

    const token = "sk-abcdefghijklmnop";
    const unsafe = await check(
      new FakeRepositoryPort({
        revision,
        files: {
          ...checkedModelFiles(revision, `A standalone credential ${token} must be refused.`),
          ...supportFiles,
        },
      }),
      { testsRoot: "tests" },
    );
    const unsafeBytes = JSON.stringify(unsafe);
    expect(unsafe.verdict).toBe("fail");
    expect(unsafeBytes).toContain("MODEL_SECRET_UNSAFE");
    expect(unsafeBytes).toContain("[REDACTED]");
    expect(unsafeBytes).not.toContain(token);
  });

  it("fails closed for every partial model sentinel without falling back to a valid legacy manifest", async () => {
    for (const sentinel of MODEL_FILES) {
      const root = await fixtureRoot();
      await writeMinimalManifest(root);
      await writeSeedSpec(root, "cf-seed", "// CF-SEED — HB-999");
      await writeFile(join(root, "README.md"), "# Partial model fixture\n", "utf8");
      initializeGit(root);
      const modelRoot = join(root, "validation-design", "model");
      await mkdir(modelRoot, { recursive: true });
      await writeFile(join(modelRoot, sentinel), "schema: seeded-partial-model\n", "utf8");

      const result = await invokeTrace(root);
      expect(result.exitCode, `${sentinel}\n${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.stderr).toContain(CHECKED_MODEL_SELECTED);
      expect(result.stderr).not.toContain(LEGACY_BRIDGE_ACTIVE);
    }
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
    await writeMinimalManifest(root, false);
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
    await writeMinimalManifest(root);
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
