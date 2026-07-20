// ISSUE-008 regression coverage for the standalone run-role preview boundary.
// Uses only temporary org/app/state fixtures and an injected live-turn seam:
// no provider, network, GitHub, installed org, or real runtime state is used.

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdRunRole, type RunRoleCommandDependencies } from "../src/cli/run-role.js";
import { initOrgHome } from "../src/org/home.js";

const roots: string[] = [];
const TEMPLATE_TEXT = [
  "# Repair the bounded preview fixture",
  "",
  "Change only the greeting and prove it with the named unit test.",
  "Do not open, close, or infer a GitHub ticket.",
  "",
].join("\n");
const ADAPTIVE_SELECTOR = "pi-openai-gpt-5.6-sol-medium-qualified-20260718@medium";

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run-role preview/live parity", () => {
  it("consumes and reports the bounded template and creator scope with zero provider calls or state writes", async () => {
    const fixture = await makeFixture("fixed");
    const stateBefore = snapshotTree(fixture.stateHome);
    let liveBoundaryCalls = 0;
    const output = await captureLogs(() => cmdRunRole([
      "builder",
      "--app", "alpha",
      "--turn", "manual-preview-008",
      "--template", fixture.templatePath,
      "--allow-network",
      "--dry-run",
      "--org-home", fixture.orgHome,
      "--state-home", fixture.stateHome,
    ], {
      runDispatchedTurn: async () => {
        liveBoundaryCalls += 1;
        return { status: "completed", summary: "unexpected live call" };
      },
    }));

    const hash = createHash("sha256").update(TEMPLATE_TEXT).digest("hex");
    expect(liveBoundaryCalls).toBe(0);
    expect(snapshotTree(fixture.stateHome)).toEqual(stateBefore);
    expect(output).toContain("provider/runtime turns: 0; state writes: 0");
    expect(output).toContain("Template summary: # Repair the bounded preview fixture");
    expect(output).toContain(`Template SHA-256: ${hash}`);
    expect(output).toContain(`template:sha256:${hash}`);
    expect(output).toContain("Provenance: human operon-cli");
    expect(output).toContain("Execution scope: execution_ready standalone-role-turn; 1 bounded step(s)");
    expect(output).toContain("Change only the greeting and prove it with the named unit test.");
    expect(output).toContain("Network access: allowed by explicit --allow-network");
    expect(output).toContain("Live readiness exclusions: provider authentication/readiness");
  });

  it.each([
    { mode: "dry-run", extra: ["--dry-run"] },
    { mode: "live", extra: [] },
  ])("requires the same app and turn identities in $mode mode", async ({ extra }) => {
    await expect(cmdRunRole([
      "builder", "--turn", "identity-008", "--template", "/not-read.md", ...extra,
    ])).rejects.toThrow("run-role: --app <app> is required for both dry-run and live turns");

    await expect(cmdRunRole([
      "builder", "--app", "alpha", "--template", "/not-read.md", ...extra,
    ])).rejects.toThrow(
      "run-role: --turn <invocation-id> is required for both dry-run and live turns",
    );
  });

  it.each([
    { mode: "dry-run", extra: ["--dry-run"] },
    { mode: "live", extra: [] },
  ])("requires the same bounded template in $mode mode before provider entry or state writes", async ({ extra }) => {
    const fixture = await makeFixture("fixed");
    const stateBefore = snapshotTree(fixture.stateHome);
    let liveBoundaryCalls = 0;
    await expect(cmdRunRole([
      "builder",
      "--app", "alpha",
      "--turn", `missing-template-${extra.length}`,
      ...extra,
      "--org-home", fixture.orgHome,
      "--state-home", fixture.stateHome,
    ], noLiveTurn(() => { liveBoundaryCalls += 1; }))).rejects.toThrow(
      "run-role: standalone manual turns require --template <path>",
    );

    expect(liveBoundaryCalls).toBe(0);
    expect(snapshotTree(fixture.stateHome)).toEqual(stateBefore);
  });

  it.each([
    { mode: "dry-run", dryRun: true },
    { mode: "live", dryRun: false },
  ])("rejects missing and empty template files before provider entry in $mode mode", async ({ dryRun }) => {
    const fixture = await makeFixture("fixed");
    const stateBefore = snapshotTree(fixture.stateHome);
    const empty = join(fixture.root, "empty.md");
    writeFileSync(empty, "  \n", "utf8");
    const base = [
      "builder", "--app", "alpha", "--turn", "invalid-template-008",
      ...(dryRun ? ["--dry-run"] : []),
      "--org-home", fixture.orgHome, "--state-home", fixture.stateHome,
    ];
    let liveBoundaryCalls = 0;
    const dependencies = noLiveTurn(() => { liveBoundaryCalls += 1; });

    await expect(cmdRunRole([
      ...base, "--template", join(fixture.root, "absent.md"),
    ], dependencies)).rejects.toThrow(/run-role: cannot read template .*absent\.md/);
    await expect(cmdRunRole([
      ...base, "--template", empty,
    ], dependencies)).rejects.toThrow(/run-role: template .*empty\.md is empty/);
    expect(liveBoundaryCalls).toBe(0);
    expect(snapshotTree(fixture.stateHome)).toEqual(stateBefore);
  });

  it.each([
    { mode: "dry-run", dryRun: true },
    { mode: "live", dryRun: false },
  ])("accepts and validates the same exact adaptive assignment in $mode mode", async ({ dryRun }) => {
    const missingFixture = await makeFixture("adaptive");
    const missingBefore = snapshotTree(missingFixture.stateHome);
    const missingBase = commandArgs(missingFixture, "support", "adaptive-missing-008", dryRun);
    let missingBoundaryCalls = 0;
    await expect(cmdRunRole(missingBase, noLiveTurn(() => { missingBoundaryCalls += 1; }))).rejects.toThrow(
      /adaptive mode requires --assignment <candidate-id>@<effort>/,
    );
    expect(missingBoundaryCalls).toBe(0);
    expect(snapshotTree(missingFixture.stateHome)).toEqual(missingBefore);

    const invalidFixture = await makeFixture("adaptive");
    const invalidBefore = snapshotTree(invalidFixture.stateHome);
    let invalidBoundaryCalls = 0;
    await expect(cmdRunRole([
      ...commandArgs(invalidFixture, "support", "adaptive-invalid-008", dryRun),
      "--assignment", "unknown-candidate@medium",
    ], noLiveTurn(() => { invalidBoundaryCalls += 1; }))).rejects.toThrow(
      /not one exact approved support tuple/,
    );
    expect(invalidBoundaryCalls).toBe(0);
    expect(snapshotTree(invalidFixture.stateHome)).toEqual(invalidBefore);

    const fixture = await makeFixture("adaptive");
    const base = [
      ...commandArgs(fixture, "support", "adaptive-preview-008", dryRun),
      "--assignment", ADAPTIVE_SELECTOR,
    ];
    let liveBoundaryCalls = 0;
    let creatorScope: Parameters<NonNullable<RunRoleCommandDependencies["runDispatchedTurn"]>>[0]["creatorScope"];
    const output = await captureLogs(() => cmdRunRole(base, {
      runDispatchedTurn: async (options) => {
        liveBoundaryCalls += 1;
        creatorScope = options.creatorScope;
        return { status: "completed", summary: "validated adaptive turn" };
      },
    }));

    expect(liveBoundaryCalls).toBe(dryRun ? 0 : 1);
    if (dryRun) {
      expect(output).toContain(
        "Assignment: pi/openai-codex/gpt-5.6-sol@medium (creator-selected approved tuple)",
      );
      expect(output).toContain(`selected approved adaptive assignment ${ADAPTIVE_SELECTOR}`);
    } else {
      expect(creatorScope?.steps).toEqual([
        expect.objectContaining({
          kind: "provider_turn",
          assignment: {
            harness: "pi",
            model: "openai-codex/gpt-5.6-sol",
            effort: "medium",
          },
        }),
      ]);
    }
  });

  it.each([
    { mode: "dry-run", dryRun: true },
    { mode: "live", dryRun: false },
  ])("rejects an assignment override in fixed mode before provider entry in $mode mode", async ({ dryRun }) => {
    const fixture = await makeFixture("fixed");
    const stateBefore = snapshotTree(fixture.stateHome);
    let liveBoundaryCalls = 0;
    await expect(cmdRunRole([
      ...commandArgs(fixture, "builder", "fixed-assignment-008", dryRun),
      "--assignment", "configured@high",
    ], noLiveTurn(() => { liveBoundaryCalls += 1; }))).rejects.toThrow(
      /--assignment is invalid in fixed mode/,
    );
    expect(liveBoundaryCalls).toBe(0);
    expect(snapshotTree(fixture.stateHome)).toEqual(stateBefore);
  });

  it("enters the injected live boundary only after the same template and creator scope inspection", async () => {
    const fixture = await makeFixture("fixed");
    const hash = createHash("sha256").update(TEMPLATE_TEXT).digest("hex");
    let boundaryCalls = 0;
    let sawPersistedJournal = false;
    let receivedObjective = "";
    const code = await cmdRunRole(commandArgs(fixture, "builder", "live-inspected-008", false), {
      runDispatchedTurn: async (options) => {
        boundaryCalls += 1;
        const journal = join(fixture.stateHome, "state", "turns", "live-inspected-008.json");
        sawPersistedJournal = existsSync(journal);
        receivedObjective = options.creatorScope?.objective ?? "";
        expect(options.creatorScope?.provenance.evidenceRefs).toContain(`template:sha256:${hash}`);
        expect(options.creatorScope?.steps).toEqual([
          expect.objectContaining({
            kind: "provider_turn",
            inputRefs: expect.arrayContaining([{ ref: `template:sha256:${hash}`, required: true }]),
          }),
        ]);
        return { status: "completed", summary: "inspected before provider entry" };
      },
    });

    expect(code).toBe(0);
    expect(boundaryCalls).toBe(1);
    expect(sawPersistedJournal).toBe(true);
    expect(receivedObjective).toContain("Change only the greeting and prove it with the named unit test.");
  });

  it("states that turn is invocation identity and never a ticket binding", async () => {
    const fixture = await makeFixture("fixed");
    const output = await captureLogs(() => cmdRunRole([
      "builder",
      "--app", "alpha",
      "--turn", "1",
      "--template", fixture.templatePath,
      "--dry-run",
      "--org-home", fixture.orgHome,
      "--state-home", fixture.stateHome,
    ], noLiveTurn()));

    expect(output).toContain("Turn invocation identity: 1");
    expect(output).toContain(
      "--turn is an invocation/trace identity only; it is not a GitHub ticket number and does not bind this turn to a ticket",
    );
    expect(output).toContain("Ticket binding: none; no ticket is inferred from --turn.");
    expect(output).not.toContain("There is no ticket behind this turn");
  });
});

async function makeFixture(mode: "fixed" | "adaptive") {
  const root = mkdtempSync(join(tmpdir(), "operon-run-role-parity-"));
  roots.push(root);
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  const operatorHome = join(root, "operator-home");
  const appWorkdir = join(root, "alpha");
  const templatePath = join(root, "bounded-task.md");
  await initOrgHome({
    target: orgHome,
    name: "run-role-parity",
    stateHome,
    homeDir: operatorHome,
  });
  mkdirSync(join(stateHome, "sentinel", "nested"), { recursive: true });
  writeFileSync(
    join(stateHome, "sentinel", "nested", "keep.bin"),
    Buffer.from([0, 1, 2, 3, 254, 255]),
  );
  mkdirSync(join(appWorkdir, ".git"), { recursive: true });
  mkdirSync(join(appWorkdir, ".operon"), { recursive: true });
  writeFileSync(join(appWorkdir, ".operon", "TASTE.md"), "# Alpha charter\n", "utf8");
  writeFileSync(templatePath, TEMPLATE_TEXT, "utf8");
  writeFileSync(join(orgHome, "apps.yaml"), [
    "schema_version: 1",
    "org:",
    "  name: run-role-parity",
    "  max_concurrent_turns: 1",
    "defaults:",
    "  budget_usd_month: 100",
    "apps:",
    "  alpha:",
    `    repo: ${JSON.stringify(appWorkdir)}`,
    "    status: live",
    "    budget_usd_month: 100",
    "    cadence: {}",
    ...(mode === "adaptive"
      ? [
          "    execution:",
          "      assignment_mode: adaptive",
          "      allowed_assignments:",
          "        support:",
          "          - pi-openai-gpt-5.6-sol-medium-qualified-20260718",
        ]
      : []),
    "",
  ].join("\n"), "utf8");
  return { root, orgHome, stateHome, appWorkdir, templatePath };
}

function commandArgs(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  role: string,
  turnId: string,
  dryRun: boolean,
): string[] {
  return [
    role,
    "--app", "alpha",
    "--turn", turnId,
    "--template", fixture.templatePath,
    ...(dryRun ? ["--dry-run"] : []),
    "--org-home", fixture.orgHome,
    "--state-home", fixture.stateHome,
  ];
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (dir: string, relativeDir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const relativePath = relativeDir === "" ? name : `${relativeDir}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        snapshot[`${relativePath}/`] = "directory";
        walk(path, relativePath);
      } else if (stat.isSymbolicLink()) {
        snapshot[relativePath] = `symlink:${readlinkSync(path)}`;
      } else {
        snapshot[relativePath] = `file:${readFileSync(path).toString("base64")}`;
      }
    }
  };
  walk(root, "");
  return snapshot;
}

function noLiveTurn(onCall: () => void = () => {}): RunRoleCommandDependencies {
  return {
    runDispatchedTurn: async () => {
      onCall();
      throw new Error("dry-run crossed the live provider-owning boundary");
    },
  };
}

async function captureLogs(run: () => Promise<number>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  try {
    expect(await run()).toBe(0);
    return lines.join("\n");
  } finally {
    spy.mockRestore();
  }
}
