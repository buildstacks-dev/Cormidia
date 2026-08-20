// CF-HARNESS-CI — HB-P7 manifest owner; HB-140/#465 authority-drift slice.
//
// The same per-commit command keeps the incumbent legacy regeneration contract
// until cutover, then selects checked-model compilation without fallback. All
// legacy fixtures are inline so this detector remains testable after cutover.

import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const checker = join(repoRoot, "scripts", "check-catalog-drift.mjs");
const architectCli = join(repoRoot, "node_modules", ".bin", "validation-architect");
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
const GENERATED_VIEWS = [
  "case-catalog.md",
  "harness-backlog.md",
  "owner-briefing.md",
  "owner-backlog.md",
  "planned-trace.md",
] as const;
const COMPILER_REPORT = "compiler-report.json";
const GENERATED_ARTIFACTS = [...GENERATED_VIEWS, COMPILER_REPORT];
const FORBIDDEN_MODEL_MODE_FILES = [
  "validation-policy.yaml",
  "case-catalog.yaml",
  "case-catalog-generator.awk",
] as const;
const REGENERATION_COMMAND =
  "awk -f validation-design/case-catalog-generator.awk " +
  "validation-design/case-catalog.md validation-design/harness-backlog.md " +
  "> validation-design/case-catalog.yaml";

const LEGACY_GENERATOR = `
function trim(s) { gsub(/^[ \\t]+/, "", s); gsub(/[ \\t]+$/, "", s); return s }
function clean(s) { gsub(/\\*\\*/, "", s); return trim(s) }
function splitrow(s, out,   i, ch, n, incode) {
  delete out
  n = 1
  out[n] = ""
  incode = 0
  for (i = 1; i <= length(s); i++) {
    ch = substr(s, i, 1)
    if (ch == "\`") incode = !incode
    if (ch == "|" && !incode) {
      n++
      out[n] = ""
    } else {
      out[n] = out[n] ch
    }
  }
  return n
}
function addticket(id, wave) {
  if (!(id in ticketseen)) {
    ticketorder[++nt] = id
    ticketseen[id] = 1
    ticketwave[id] = wave
  }
}
BEGIN { pass = 0; nf = 0; nt = 0 }
FNR == 1 { pass++ }
pass == 1 {
  line = $0
  if (line ~ /^## /) {
    section = line
    sub(/^## /, "", section)
    next
  }
  if (line !~ /^\\| CF/) next
  splitrow(line, cells)
  id = clean(cells[2])
  if (id in familyseen) {
    print "DUPFAM: " id > "/dev/stderr"
    next
  }
  familyorder[++nf] = id
  familyseen[id] = 1
  familysection[id] = section
  familylayer[id] = clean(cells[4])
  familyoracle[id] = clean(cells[5])
  familyrisk[id] = clean(cells[6])
  next
}
pass == 2 {
  line = $0
  if (line ~ /^## /) {
    wave = line
    sub(/^## /, "", wave)
    next
  }
  if (match(line, /\\*\\*HB-[A-Za-z0-9-]+/)) {
    ticket = substr(line, RSTART + 2, RLENGTH - 2)
    addticket(ticket, wave)
  }
  rest = line
  while (match(rest, /CF-[A-Za-z0-9-]+/)) {
    family = substr(rest, RSTART, RLENGTH)
    if (family in familyseen) {
      familyowner[family] = ticket
      if (index("," ticketfamilies[ticket] ",", "," family ",") == 0) {
        ticketfamilies[ticket] = ticketfamilies[ticket] == "" ? family : ticketfamilies[ticket] "," family
      }
    }
    rest = substr(rest, RSTART + RLENGTH)
  }
  next
}
END {
  print "# self-contained legacy catalog fixture"
  print "schema: validation-architect/case-catalog/v1"
  print "families:"
  for (i = 1; i <= nf; i++) {
    id = familyorder[i]
    printf "  - {id: %s, section: \\"%s\\", status: implementable, layers: \\"%s\\", oracle: \\"%s\\", risk: \\"%s\\"", id, familysection[id], familylayer[id], familyoracle[id], familyrisk[id]
    if (id in familyowner) printf ", ticket: %s, wave: \\"%s\\"", familyowner[id], ticketwave[familyowner[id]]
    else print "MISSING-OWNER: " id > "/dev/stderr"
    print "}"
  }
  print "tickets:"
  for (i = 1; i <= nt; i++) {
    id = ticketorder[i]
    printf "  - {id: %s, wave: \\"%s\\", status: pending, families: [%s]}\\n", id, ticketwave[id], ticketfamilies[id]
  }
}
`;

const LEGACY_CATALOG = `# Self-contained catalog fixture

## Harness fixture register

| Cell | Case family | Layer | Oracle | Risk |
|---|---|---|---|---|
| CF-SEED | Executes \`cormidia org|app\` without shifting later cells | 1/2 | refusal+det | REG |
| CF-SECOND | Preserves a second non-empty family | 2 | state | STD |
`;

const LEGACY_BACKLOG = `# Self-contained backlog fixture

## Wave seed

- **HB-001 — fixture detector.** Owns CF-SEED and CF-SECOND.
`;

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
  await Promise.all([
    writeFile(join(designRoot, "case-catalog-generator.awk"), LEGACY_GENERATOR),
    writeFile(join(designRoot, "case-catalog.md"), LEGACY_CATALOG),
    writeFile(join(designRoot, "harness-backlog.md"), LEGACY_BACKLOG),
  ]);
  await regenerateFixtureYaml(root);
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

function initializeRepository(root: string): string {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-q", "-m", "fixture"], {
    cwd: root,
  });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function modelFiles(revision: string): Record<string, string> {
  const versions = {
    package: "0.4.16",
    method: "0.8.9",
    model: "validation-architect/corpus/v1",
    compiler: "validation-architect/compiler/v1",
    policy: "validation-architect/policy/v1",
    result: "validation-architect/result/v1",
    golden_set: "validation-architect/golden-set/v1",
  };
  const policy = {
    schema: "validation-architect/model/policy/v1",
    default: "blocking",
    inheritance: "tighten-only",
    smoke_journey_ids: ["J-1"],
    sourcing: ["acceptance-criteria", "adversarial-derivation", "production-incident", "substrate-drift"].map((id) => ({
      id,
      status: "declared-empty",
      owner: "OWN-1",
      reason: "Focused drift fixture with no standing sourcing decision.",
    })),
    layers: [
      { id: "L1", title: "Contract", status: "declared-empty", reason: "Focused L2 fixture" },
      { id: "L2", title: "Hermetic", status: "active" },
      { id: "L3", title: "Live", status: "declared-empty", reason: "No live target" },
      { id: "L4", title: "Evaluation", status: "declared-empty", reason: "No model site" },
      { id: "L5", title: "Operations", status: "declared-empty", reason: "No operations target" },
      { id: "L6", title: "Outcome", status: "declared-empty", reason: "No outcome lane" },
    ],
    lanes: [
      {
        id: "inner-loop",
        title: "Fast local",
        kind: "test",
        status: "active",
        requirement: "blocking",
        triggers: ["before-push"],
        command: "pnpm test -- tenant",
        max_duration_seconds: 120,
      },
      {
        id: "per-commit",
        title: "Per commit",
        kind: "test",
        status: "active",
        requirement: "blocking",
        triggers: ["per-commit"],
        command: "pnpm test",
        max_duration_seconds: 600,
      },
      {
        id: "triggered",
        title: "Triggered",
        kind: "evidence",
        status: "declared-empty",
        requirement: "blocking",
        triggers: [],
        authorization: "per-run-human",
        reason: "No triggered obligation",
      },
      {
        id: "release",
        title: "Release",
        kind: "evidence",
        status: "declared-empty",
        requirement: "blocking",
        triggers: [],
        reason: "No release obligation",
      },
      {
        id: "scheduled",
        title: "Scheduled",
        kind: "evidence",
        status: "declared-empty",
        requirement: "blocking",
        triggers: [],
        reason: "No scheduled obligation",
      },
    ],
    exceptions: [],
  };
  const files = {
    "project.yaml": {
      schema: "validation-architect/model/project/v1",
      product: {
        id: "transition-fixture",
        name: "Transition fixture",
        revision,
        intended_use: "Prove deterministic checked-model authority selection",
        criticality: "C1",
        criticality_reason: "Disposable offline fixture with no external effects",
      },
      versions,
    },
    "owners.yaml": {
      schema: "validation-architect/model/owners/v1",
      owners: [{ id: "OWN-1", name: "Runtime team", responsibility: "Own the fixture contract" }],
    },
    "sources.yaml": {
      schema: "validation-architect/model/sources/v1",
      sources: [{ id: "SRC-1", kind: "doc", path: "docs/contract.md", locator: "Fixture contract" }],
    },
    "structures.yaml": {
      schema: "validation-architect/model/structures/v1",
      structures: [
        {
          id: "CON-1",
          kind: "contract",
          title: "Tenant boundary",
          meaning: "A lookup never returns another tenant's record",
          owner: "OWN-1",
          source_ids: ["SRC-1"],
          changed_paths: ["src/tenant/**"],
          acceptance_criteria: ["Foreign tenant records are rejected"],
          error_criteria: ["A malformed tenant id refuses with a typed error; retries stay idempotent"],
          failure_modes: ["A foreign tenant record is returned"],
        },
        {
          id: "J-1",
          kind: "journey",
          title: "Tenant smoke journey",
          meaning: "The fixture's first-value path stays green on merge.",
          owner: "OWN-1",
          source_ids: ["SRC-1"],
        },
      ],
    },
    "policy.yaml": policy,
    "controls.yaml": {
      schema: "validation-architect/model/controls/v1",
      controls: [
        {
          id: "NC-1",
          title: "Foreign row seed",
          family_id: "CF-1",
          owner: "OWN-1",
          expected_failure: "The detector fails when a foreign row is returned",
        },
      ],
    },
    "families.yaml": {
      schema: "validation-architect/model/families/v1",
      families: [
        {
          id: "CF-1",
          title: "Tenant detector",
          meaning: "Reject a foreign tenant row",
          structure_ids: ["CON-1", "J-1"],
          owner: "OWN-1",
          source_ids: ["SRC-1"],
          lane: "per-commit",
          status: "implementable",
          layer: "L2",
          oracle: "state",
          risk: "E1",
          control_ids: ["NC-1"],
          ticket: "HB-1",
          planned_tests: ["tests/tenant.test.ts"],
          exclusions: ["No live tenancy"],
        },
      ],
    },
    "backlog.yaml": {
      schema: "validation-architect/model/backlog/v1",
      tickets: [
        {
          id: "HB-1",
          title: "Land tenant detector",
          wave: "0",
          status: "pending",
          owner: "OWN-1",
          executor: "build-agent",
          lane: "per-commit",
          layer: "L2",
          acceptance_criteria: ["The tenant detector and its negative control pass"],
          family_ids: ["CF-1"],
        },
      ],
    },
  };
  return Object.fromEntries(Object.entries(files).map(([name, value]) => [name, stringify(value, { lineWidth: 0 })]));
}

async function checkedModelFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-model-drift-"));
  roots.push(root);
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "README.md"), "# fixture\n");
  await writeFile(join(root, "docs", "contract.md"), "# Tenant contract\n");
  const revision = initializeRepository(root);
  const modelRoot = join(root, "validation-design", "model");
  await mkdir(modelRoot, { recursive: true });
  for (const [name, content] of Object.entries(modelFiles(revision))) await writeFile(join(modelRoot, name), content);
  const generated = await run(architectCli, ["compile", root, "--write"]);
  expect(generated.exitCode, `${generated.stdout}\n${generated.stderr}`).toBe(0);
  return root;
}

describe("CF-HARNESS-CI — HB-140 — case-catalog.yaml regeneration drift gate", () => {
  it("keeps an inline-code pipe inside its Markdown cell during regeneration", async () => {
    const root = await fixtureRoot();
    const designRoot = join(root, "validation-design");
    const result = await run("awk", [
      "-f",
      join(designRoot, "case-catalog-generator.awk"),
      join(designRoot, "case-catalog.md"),
      join(designRoot, "harness-backlog.md"),
    ]);
    expect(result.exitCode).toBe(0);
    const row = result.stdout.split("\n").find((line) => line.includes("{id: CF-SEED,"));
    if (row === undefined) throw new Error("regeneration omitted CF-SEED");
    expect(row).toContain('layers: "1/2", oracle: "refusal+det", risk: "REG"');
  });

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
        '{id: CF-SEED, section: "Harness fixture register", status: implementable',
        '{id: CF-SEED, section: "Harness fixture register", status: landed',
      ),
    );
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not byte-identical to its regeneration");
    expect(result.stderr).toContain("CF-SEED");
    expect(result.stderr).toContain(REGENERATION_COMMAND);
  });

  it("rejects a case-catalog.md edit made without regenerating the YAML", async () => {
    // The exact desync HB-140 exists to catch: the human catalog moves, the
    // machine catalog silently keeps enforcing stale truth.
    const root = await fixtureRoot();
    await mutate(root, "case-catalog.md", (source) =>
      source.replace("| 1/2 | refusal+det | REG |", "| 2 | refusal+det | REG |"),
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
        "| CF-SECOND |",
        "| CF-ORPHANED | seeded ownerless implementable family | 1 | det | FLOOR |\n| CF-SECOND |",
      ),
    );
    await regenerateFixtureYaml(root);
    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("corpus diagnostics");
    expect(result.stderr).toContain("MISSING-OWNER: CF-ORPHANED");
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

describe("CF-HARNESS-CI — #465 — checked-model compiler drift gate", () => {
  it("passes a complete model with eight inputs, five views, and the canonical compiler report", async () => {
    const root = await checkedModelFixture();
    const modelRoot = join(root, "validation-design", "model");
    const designRoot = join(root, "validation-design");

    expect((await readdir(modelRoot)).sort()).toEqual([...MODEL_FILES].sort());
    for (const name of MODEL_FILES) expect((await readFile(join(modelRoot, name), "utf8")).length).toBeGreaterThan(0);
    expect((await readdir(designRoot)).filter((name) => name !== "model").sort()).toEqual(
      [...GENERATED_ARTIFACTS].sort(),
    );
    for (const name of GENERATED_VIEWS) {
      expect((await readFile(join(designRoot, name), "utf8")).length).toBeGreaterThan(0);
    }
    expect(await readFile(join(designRoot, "owner-briefing.md"), "utf8")).toContain(
      "`triggered` Triggered (evidence): blocking, declared-empty; triggers: —; authorization: per-run-human",
    );
    const reportBytes = await readFile(join(designRoot, COMPILER_REPORT), "utf8");
    const report: unknown = JSON.parse(reportBytes);
    expect(report).toMatchObject({
      schema: "validation-architect/compiler/v1",
      accepted: true,
      generated_views: [...GENERATED_VIEWS].sort(),
      diagnostics: [],
    });
    expect(reportBytes.endsWith("\n")).toBe(true);

    const result = await run(process.execPath, [checker, root]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    expect(result.stdout).toMatch(
      new RegExp(`Checked-model drift check passed \\(model [a-f0-9]{64}, revision ${revision};`),
    );
  });

  it("ignores archived legacy authority after model mode is selected", async () => {
    const root = await checkedModelFixture();
    const designRoot = join(root, "validation-design");
    const archiveRoot = join(designRoot, "migration", "legacy");
    await mkdir(archiveRoot, { recursive: true });
    await Promise.all([
      writeFile(join(archiveRoot, "validation-policy.yaml"), "malformed: [\n"),
      writeFile(join(archiveRoot, "case-catalog.yaml"), "malformed: [\n"),
      writeFile(join(archiveRoot, "case-catalog-generator.awk"), "this is historical, not executable authority\n"),
    ]);

    const result = await run(process.execPath, [checker, root]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  });

  it("rejects an extra model-root entry even though the public compiler ignores it", async () => {
    const root = await checkedModelFixture();
    await writeFile(join(root, "validation-design", "model", "extra.yaml"), "seeded: extra-authority\n");

    const publicCompile = await run(architectCli, ["compile", root]);
    expect(publicCompile).toMatchObject({ exitCode: 0, stderr: "" });

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must contain exactly the eight regular model files");
    expect(result.stderr).toContain("unexpected entries: extra.yaml");
  });

  it.each(["validation-design", "validation-design/model"])(
    "rejects a symlinked checked-model authority directory at %s",
    async (relativePath) => {
      const root = await checkedModelFixture();
      const authorityPath = join(root, relativePath);
      const targetPath = join(
        root,
        relativePath === "validation-design" ? "linked-design" : "validation-design/linked-model",
      );
      await rename(authorityPath, targetPath);
      await symlink(targetPath, authorityPath, "dir");

      const result = await run(process.execPath, [checker, root]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`requires ${relativePath} to be a regular directory, not a symlink`);
    },
  );

  it.each(FORBIDDEN_MODEL_MODE_FILES)("rejects legacy root authority or tooling %s", async (name) => {
    const root = await checkedModelFixture();
    await writeFile(join(root, "validation-design", name), "seeded forbidden legacy root file\n");

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("checked-model authority refuses legacy root authority");
    expect(result.stderr).toContain(name);
  });

  it.each(MODEL_FILES)("selects model mode when only the exact %s sentinel exists", async (sentinel) => {
    const root = await fixtureRoot();
    const modelRoot = join(root, "validation-design", "model");
    await mkdir(modelRoot, { recursive: true });
    await writeFile(join(modelRoot, sentinel), "seeded partial model\n");

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`checked-model authority selected by ${sentinel}`);
    expect(result.stderr).toContain("partial state cannot fall back to legacy authority");
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("fails closed with %i of 8 model files", async (count) => {
    const root = await fixtureRoot();
    const modelRoot = join(root, "validation-design", "model");
    await mkdir(modelRoot, { recursive: true });
    await Promise.all(MODEL_FILES.slice(0, count).map((name) => writeFile(join(modelRoot, name), "seed\n")));

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("partial state cannot fall back to legacy authority");
    expect(result.stderr).toContain(`Missing: ${MODEL_FILES.slice(count).join(", ")}.`);
  });

  it("does not select model mode for a non-sentinel file", async () => {
    const root = await fixtureRoot();
    const modelRoot = join(root, "validation-design", "model");
    await mkdir(modelRoot, { recursive: true });
    await writeFile(join(modelRoot, "README.md"), "not a model sentinel\n");

    const result = await run(process.execPath, [checker, root]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Catalog drift check passed");
  });

  it("fails on a compiler-rejected semantic reference", async () => {
    const root = await checkedModelFixture();
    await mutate(root, "model/families.yaml", (source) => source.replace("- CON-1", "- CON-MISSING"));

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("public compiler exited");
    expect(result.stderr).toContain("CON-MISSING");
  });

  it.each(GENERATED_VIEWS)("fails when generated view %s is missing and does not recreate it", async (view) => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", view);
    await rm(path);

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot inspect generated artifact");
    expect(result.stderr).toContain(view);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(GENERATED_VIEWS)("fails when generated view %s is mutated and preserves the seeded bytes", async (view) => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", view);
    const seeded = `${await readFile(path, "utf8")}\nseeded stale projection\n`;
    await writeFile(path, seeded);

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("emitted diagnostics");
    expect(result.stderr).toContain(view);
    expect(await readFile(path, "utf8")).toBe(seeded);
  });

  it.each(GENERATED_VIEWS)("rejects generated view %s when it is an in-repository symlink", async (view) => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", view);
    const targetRoot = join(root, "validation-design", "migration", "symlink-targets");
    const target = join(targetRoot, view);
    await mkdir(targetRoot, { recursive: true });
    await writeFile(target, await readFile(path));
    await rm(path);
    await symlink(target, path);

    const publicCompile = await run(architectCli, ["compile", root]);
    expect(publicCompile).toMatchObject({ exitCode: 0, stderr: "" });
    await mutate(root, "model/families.yaml", (source) => source.replace("- CON-1", "- CON-MISSING"));

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generated artifacts must be regular non-symlink files");
    expect(result.stderr).toContain(view);
    expect(result.stderr).not.toContain("public compiler");
  });

  it("fails on valid model drift when the generated views are stale", async () => {
    const root = await checkedModelFixture();
    await mutate(root, "model/families.yaml", (source) =>
      source.replace("title: Tenant detector", "title: Tenant isolation detector"),
    );

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("emitted diagnostics");
    expect(result.stderr).toContain("case-catalog.md is missing or differs semantically");
  });

  it("fails when compiler-report.json is missing and does not recreate it", async () => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", COMPILER_REPORT);
    await rm(path);

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot inspect generated artifact");
    expect(result.stderr).toContain(COMPILER_REPORT);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails when compiler-report.json is stale and preserves the seeded bytes", async () => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", COMPILER_REPORT);
    const seeded = `${await readFile(path, "utf8")}\nseeded stale report\n`;
    await writeFile(path, seeded);

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("compiler-report.json differs from the canonical public compile report");
    expect(await readFile(path, "utf8")).toBe(seeded);
  });

  it("rejects compiler-report.json when it is an in-repository symlink", async () => {
    const root = await checkedModelFixture();
    const path = join(root, "validation-design", COMPILER_REPORT);
    const targetRoot = join(root, "validation-design", "migration", "symlink-targets");
    const target = join(targetRoot, COMPILER_REPORT);
    await mkdir(targetRoot, { recursive: true });
    await writeFile(target, await readFile(path));
    await rm(path);
    await symlink(target, path);

    const publicCompile = await run(architectCli, ["compile", root]);
    expect(publicCompile).toMatchObject({ exitCode: 0, stderr: "" });

    const result = await run(process.execPath, [checker, root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("generated artifacts must be regular non-symlink files");
    expect(result.stderr).toContain(COMPILER_REPORT);
  });

  it("fails closed when the public installed compiler cannot be spawned", async () => {
    const root = await checkedModelFixture();
    const copiedChecker = join(root, "scripts", "check-catalog-drift.mjs");
    const copiedHelper = join(root, "scripts", "lib", "checked-model-compiler-report.mjs");
    await mkdir(dirname(copiedChecker), { recursive: true });
    await mkdir(dirname(copiedHelper), { recursive: true });
    await Promise.all([
      writeFile(copiedChecker, await readFile(checker)),
      writeFile(copiedHelper, await readFile(join(repoRoot, "scripts", "lib", "checked-model-compiler-report.mjs"))),
    ]);

    const result = await run(process.execPath, [await realpath(copiedChecker), await realpath(root)]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("could not start the public validation-architect CLI");
    expect(result.stderr).toContain("ENOENT");
  });
});
