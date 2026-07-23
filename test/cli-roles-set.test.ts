// ENH-004: `operon roles set` is the journaled write path for a role's
// harness/model/effort/turn-budget. It must preview by default, validate the
// RESULTING tuple against what the harness can actually execute, refuse to
// execute without an attributable identity, preserve the ratified file's
// comments, and record what changed and why.
//
// Everything here is local filesystem + YAML. No network, no provider, no
// installed org, no wall clock in an assertion.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdRoles } from "../src/cli/roles.js";
import { initOrgHome } from "../src/org/home.js";
import {
  applyRoleAssignmentChange,
  formatRoleAssignmentPlan,
  roleAssignmentJournalPath,
} from "../src/org/role-assignment.js";
import {
  describeModelCatalogCheck,
  modelServedByCatalog,
  readRuntimeModelCatalog,
  type RuntimeModelCatalog,
  type RuntimeModelCatalogReader,
} from "../src/runtime/model-catalog.js";
import { loadRoles } from "../src/org/roles.js";


const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ orgHome: string; stateHome: string; rolesPath: string }> {
  const root = mkdtempSync(join(tmpdir(), "operon-roles-set-"));
  roots.push(root);
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  mkdirSync(join(root, "operator-home"), { recursive: true });
  await initOrgHome({
    target: orgHome,
    name: "roles-set-fixture",
    stateHome,
    homeDir: join(root, "operator-home"),
  });
  // The packaged chart is the fixture: its comments carry the org's actual
  // reasoning, which is exactly what a hand-edit or a naive rewrite loses.
  return { orgHome, stateHome, rolesPath: join(orgHome, "roles.yaml") };
}

describe("operon roles set", () => {
  it("previews a validated change and writes nothing", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    const output = await captureRoles(
      ["set", "planner", "--effort", "max", "--turn-budget", "15", "--org-home", orgHome, "--state-home", stateHome],
      0,
    );

    expect(output).toContain(`PREVIEW roles set planner — ${rolesPath}`);
    expect(output).toContain("before: claude/claude-opus-4-8@xhigh turn budget $5 (inherited)");
    expect(output).toContain("after:  claude/claude-opus-4-8@max turn budget $15");
    expect(output).toContain("effort: xhigh -> max");
    expect(output).toContain("max_turn_budget_usd: 5 -> 15");
    expect(output).toContain("claude adapter claude/v1: accepts low | medium | high | xhigh | max");
    expect(output).toContain("Nothing was written.");
    expect(readFileSync(rolesPath, "utf8")).toBe(before);
    expect(existsSync(roleAssignmentJournalPath(stateHome))).toBe(false);
  });

  it("refuses to execute without an attributable identity or a reason", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    const unattributed = await captureRoles(
      ["set", "planner", "--effort", "max", "--execute", "--reason", "agreed in review",
        "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(unattributed).toContain("BLOCKED unratified_execution");
    expect(unattributed).toContain("--execute requires an attributable --by <identity>");

    const unreasoned = await captureRoles(
      ["set", "planner", "--effort", "max", "--execute", "--by", "bikram@example.invalid",
        "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(unreasoned).toContain("BLOCKED missing_reason");

    expect(readFileSync(rolesPath, "utf8")).toBe(before);
    expect(existsSync(roleAssignmentJournalPath(stateHome))).toBe(false);
  });

  it("applies an attributed change, edits only the named scalars' lines, and journals it", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    const output = await captureRoles(
      ["set", "planner", "--effort", "max", "--turn-budget", "15", "--execute",
        "--by", "bikram@example.invalid", "--reason", "planner quality decides everything downstream",
        "--org-home", orgHome, "--state-home", stateHome],
      0,
    );
    expect(output).toContain(`APPLIED roles set planner — ${rolesPath}`);
    expect(output).toContain("journaled:");

    const written = readFileSync(rolesPath, "utf8");
    // The ratified file's reasoning survives the write.
    expect(written).toContain("# One entry per employee.");
    expect(written).toContain("frontier: ticket quality determines everything downstream");
    expect(written).toContain("DELIBERATELY a different provider than reviewer");
    expect(written).toContain("caps bound");

    // The real assertion: a two-scalar edit changes exactly the lines those two
    // scalars occupy. `effort` is rewritten in place; `max_turn_budget_usd` was
    // inherited, so it costs exactly one new line directly under it. Every other
    // byte of the ratified file — comments, blank lines, key order, flow
    // sequences, indentation — is identical. A whole-file re-render passes the
    // substring checks above and fails every assertion below.
    const beforeLines = before.split("\n");
    const afterLines = written.split("\n");
    expect(afterLines).toHaveLength(beforeLines.length + 1);
    const plannerAt = beforeLines.indexOf("  planner:");
    expect(plannerAt).toBeGreaterThan(0);
    const effortAt = beforeLines.indexOf("    effort: xhigh", plannerAt);
    expect(effortAt).toBeGreaterThan(plannerAt);

    expect(afterLines.slice(0, effortAt)).toEqual(beforeLines.slice(0, effortAt));
    expect(afterLines[effortAt]).toBe("    effort: max");
    expect(afterLines[effortAt + 1]).toBe("    max_turn_budget_usd: 15");
    expect(afterLines.slice(effortAt + 2)).toEqual(beforeLines.slice(effortAt + 1));

    const reloaded = await loadRoles(rolesPath);
    const planner = reloaded.roles.find((role) => role.name === "planner")!;
    expect(planner).toMatchObject({
      runtime: "claude",
      model: "claude-opus-4-8",
      effort: "max",
      maxTurnBudgetUsd: 15,
    });
    // Only the named role moved.
    expect(reloaded.roles.find((role) => role.name === "builder")).toMatchObject({
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      maxTurnBudgetUsd: 50,
    });
    expect(reloaded.defaults.maxTurnBudgetUsd).toBe(5);

    const journal = readFileSync(roleAssignmentJournalPath(stateHome), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      schema_version: 1,
      role: "planner",
      by: "bikram@example.invalid",
      reason: "planner quality decides everything downstream",
      before: { effort: "xhigh", maxTurnBudgetUsd: 5, turnBudgetInherited: true },
      after: { effort: "max", maxTurnBudgetUsd: 15, turnBudgetInherited: false },
    });
    expect(journal[0]!["roles_sha256_before"]).not.toBe(journal[0]!["roles_sha256_after"]);
  });

  it("keeps a multi-line trailing comment block attached to the key it documents", async () => {
    // The builder's cap carries eight lines of rationale hanging off its own
    // line, and `delegation:` carries a trailing comment of its own. Both are
    // exactly what a re-render detaches from what they explain.
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    await captureRoles(
      ["set", "builder", "--turn-budget", "100", "--execute", "--by", "bikram@example.invalid",
        "--reason", "one turn of a frontier builder outgrew the $50 cap",
        "--org-home", orgHome, "--state-home", stateHome],
      0,
    );

    const written = readFileSync(rolesPath, "utf8");
    const beforeLines = before.split("\n");
    const afterLines = written.split("\n");
    // A one-scalar edit on an existing key costs exactly one line.
    expect(afterLines).toHaveLength(beforeLines.length);
    const changed = beforeLines
      .map((line, index) => (line === afterLines[index] ? -1 : index))
      .filter((index) => index >= 0);
    expect(changed).toHaveLength(1);

    const capAt = changed[0]!;
    expect(beforeLines[capAt]).toBe(
      "    max_turn_budget_usd: 50     # a frontier builder implementing a real ticket in",
    );
    // The trailing comment stays on the same line AND in the same column, so
    // the seven continuation lines below it still line up under it.
    expect(afterLines[capAt]).toBe(
      "    max_turn_budget_usd: 100    # a frontier builder implementing a real ticket in",
    );
    expect(afterLines[capAt + 1]).toBe(
      "                                # one turn (contract-sized context + tool loop)",
    );
    expect(written).toContain("    delegation:                 # stays as the second line of defense");

    const reloaded = await loadRoles(rolesPath);
    expect(reloaded.roles.find((role) => role.name === "builder")).toMatchObject({
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      maxTurnBudgetUsd: 100,
    });
  });

  it("rejects a tuple the harness cannot execute, before anything is written", async () => {
    // Adversarial near-miss: only the effort is supplied, and it is a valid
    // effort NAME. The combination is what the codex adapter cannot run, so
    // validating the supplied field alone would have let it through — and the
    // failure would surface at dispatch, inside a paid turn.
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    const output = await captureRoles(
      ["set", "builder", "--effort", "max", "--execute", "--by", "bikram@example.invalid",
        "--reason", "try the deepest effort", "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(output).toContain("BLOCKED invalid_assignment");
    expect(output).toContain("effort max is unsupported by codex");
    expect(readFileSync(rolesPath, "utf8")).toBe(before);
    expect(existsSync(roleAssignmentJournalPath(stateHome))).toBe(false);
  });

  it("refuses a model the harness roster does not serve, before anything is written", async () => {
    // ENH-004: "a model string the adapter does not serve" used to be deferred
    // to dispatch, inside a live paid turn. Where the harness publishes a
    // token-free roster it is refused here instead.
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");
    const roster: RuntimeModelCatalogReader = async (runtime) =>
      runtime === "pi"
        ? { runtime, available: true, source: "/fixture/models.json", models: ["openai/gpt-5.6-sol"] }
        : { runtime, available: false, reason: "fixture: no offline roster" };

    const rejected = await applyRoleAssignmentChange({
      orgHome,
      stateHome,
      role: "support",
      edit: { runtime: "pi", model: "openai/gpt-5.7-retired" },
      execute: true,
      by: "bikram@example.invalid",
      reason: "move support to pi",
      readModelCatalog: roster,
    });
    expect(rejected.executed).toBe(false);
    expect(rejected.blockers.map((blocker) => blocker.code)).toEqual(["model_not_served"]);
    expect(rejected.blockers[0]?.detail).toContain('pi does not serve model "openai/gpt-5.7-retired"');
    expect(readFileSync(rolesPath, "utf8")).toBe(before);
    expect(existsSync(roleAssignmentJournalPath(stateHome))).toBe(false);

    // The served id on the same roster goes through, so the check is a real
    // roster comparison and not a blanket refusal of the pi harness.
    const accepted = await applyRoleAssignmentChange({
      orgHome,
      stateHome,
      role: "support",
      edit: { runtime: "pi", model: "openai/gpt-5.6-sol" },
      execute: true,
      by: "bikram@example.invalid",
      reason: "move support to pi",
      readModelCatalog: roster,
    });
    expect(accepted.executed).toBe(true);
    expect(accepted.modelCatalog).toMatchObject({
      runtime: "pi",
      model: "openai/gpt-5.6-sol",
      verified: true,
      source: "/fixture/models.json",
      modelCount: 1,
    });
    expect(rejected.modelCatalog).toMatchObject({ verified: false, modelCount: 1 });
    expect((await loadRoles(rolesPath)).roles.find((role) => role.name === "support")).toMatchObject({
      runtime: "pi",
      model: "openai/gpt-5.6-sol",
    });
  });

  it("says out loud when a harness publishes no token-free roster", async () => {
    // The gap this closes is silence. Claude and Codex expose their rosters
    // only through a credentialed transport, so the id genuinely cannot be
    // proven by a config edit — and the operator is told exactly that instead
    // of being left to assume it was checked.
    const { orgHome, stateHome } = await fixture();

    const output = await captureRoles(
      ["set", "planner", "--model", "claude-opus-4-9-imaginary",
        "--org-home", orgHome, "--state-home", stateHome],
      0,
    );
    expect(output).toContain(
      "model catalog: WARNING claude-opus-4-9-imaginary is NOT VERIFIED against the claude adapter",
    );
    expect(output).toContain("only readable by launching the Claude CLI transport");
    expect(output).toContain(
      "WARNING: claude-opus-4-9-imaginary cannot be checked before it is applied",
    );

    for (const runtime of ["claude", "codex"] as const) {
      const catalog = await readRuntimeModelCatalog(runtime);
      expect(catalog.available).toBe(false);
      expect(catalog.available === false && catalog.reason.length > 0).toBe(true);
    }

    // The unverified state is recorded, not merely printed: the plan an agent
    // hands to a human carries `verified: false` with the reason.
    const plan = await applyRoleAssignmentChange({
      orgHome,
      stateHome,
      role: "planner",
      edit: { model: "claude-opus-4-9-imaginary" },
    });
    expect(plan.modelCatalog).toMatchObject({
      runtime: "claude",
      model: "claude-opus-4-9-imaginary",
      verified: false,
    });
    expect(plan.modelCatalog?.reason).toContain("ships no offline model roster");
    expect(plan.modelCatalog?.source).toBeUndefined();
  });

  it("refuses an unknown role and a no-op change without writing", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    const unknown = await captureRoles(
      ["set", "archivist", "--effort", "low", "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(unknown).toContain("BLOCKED unknown_role");
    expect(unknown).toMatch(/roles\.yaml defines: .*\bplanner\b.*\bbuilder\b/);

    const noop = await captureRoles(
      ["set", "planner", "--effort", "xhigh", "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(noop).toContain("BLOCKED no_effective_change");

    const empty = await captureRoles(
      ["set", "planner", "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(empty).toContain("BLOCKED no_change_requested");

    expect(readFileSync(rolesPath, "utf8")).toBe(before);
  });

  it("rejects a non-positive budget and an unknown effort at the argument boundary", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();
    const before = readFileSync(rolesPath, "utf8");

    await expect(cmdRoles([
      "set", "planner", "--effort", "extreme", "--org-home", orgHome, "--state-home", stateHome,
    ])).rejects.toThrow("roles set: --effort must be one of low | medium | high | xhigh | max");
    await expect(cmdRoles([
      "set", "planner", "--runtime", "gemini", "--org-home", orgHome, "--state-home", stateHome,
    ])).rejects.toThrow("roles set: --runtime must be one of claude | codex | pi");

    const plan = await applyRoleAssignmentChange({
      orgHome,
      stateHome,
      role: "planner",
      edit: { turnBudgetUsd: 0 },
      execute: true,
      by: "bikram@example.invalid",
      reason: "zero it out",
    });
    expect(plan.executed).toBe(false);
    expect(plan.blockers[0]?.code).toBe("invalid_turn_budget");
    expect(readFileSync(rolesPath, "utf8")).toBe(before);
  });

  it("never claims an id is served by a roster that does not list it", async () => {
    // Round-3 defect 5. describeModelCatalogCheck asserted "is served by the
    // <runtime> adapter" whenever the roster was merely AVAILABLE, without
    // ever consulting modelServedByCatalog — so one output block stated both
    // "totally/not-a-real-model-xyz is served by the pi adapter" and
    // "BLOCKED model_not_served". One of those two sentences was false.
    const catalog: RuntimeModelCatalog = {
      runtime: "pi",
      available: true,
      source: "/fixture/models.json",
      models: ["openai/gpt-5.6-sol"],
    };
    expect(modelServedByCatalog(catalog, "totally/not-a-real-model-xyz")).toBe(false);
    const described = describeModelCatalogCheck(catalog, "totally/not-a-real-model-xyz");
    expect(described).toContain(
      "model catalog: totally/not-a-real-model-xyz is NOT served by the pi adapter",
    );
    expect(described).not.toContain("totally/not-a-real-model-xyz is served by");
    expect(describeModelCatalogCheck(catalog, "openai/gpt-5.6-sol")).toContain(
      "model catalog: openai/gpt-5.6-sol is served by the pi adapter",
    );

    // The same two sentences, in the block an operator actually reads.
    const { orgHome, stateHome } = await fixture();
    const plan = await applyRoleAssignmentChange({
      orgHome,
      stateHome,
      role: "support",
      edit: { runtime: "pi", model: "totally/not-a-real-model-xyz" },
      readModelCatalog: async (runtime) =>
        runtime === "pi"
          ? { runtime, available: true, source: "/fixture/models.json", models: ["openai/gpt-5.6-sol"] }
          : { runtime, available: false, reason: "fixture: no offline roster" },
    });
    const rendered = formatRoleAssignmentPlan(plan);
    expect(rendered).toContain("BLOCKED model_not_served");
    expect(rendered).toContain("totally/not-a-real-model-xyz is NOT served by the pi adapter");
    expect(rendered).not.toContain("totally/not-a-real-model-xyz is served by");
  });

  it("records and shouts the unverified case where no token-free roster exists", async () => {
    // Round-3 defect 6. Hard enforcement exists only for pi, because pi is the
    // only harness with a token-free roster. That asymmetry is real, but it
    // must not be silent: the unproven id is warned about on stdout, again on
    // stderr (so a --json consumer cannot miss it), and recorded in the
    // journal so an applied-but-unproven change is as durable as the change.
    const { orgHome, stateHome, rolesPath } = await fixture();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let output: string;
    try {
      output = await captureRoles(
        ["set", "planner", "--model", "claude-opus-3-retired-xyz",
          "--reason", "retire the old tier", "--by", "bikram@example.invalid", "--execute",
          "--org-home", orgHome, "--state-home", stateHome],
        0,
      );
      expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
        "operon roles set: WARNING — planner now runs claude/claude-opus-3-retired-xyz, " +
          "an id no token-free roster could verify",
      );
    } finally {
      error.mockRestore();
    }
    expect(output).toContain("APPLIED roles set planner");
    expect(output).toContain(
      "model catalog: WARNING claude-opus-3-retired-xyz is NOT VERIFIED against the claude adapter",
    );
    expect(output).toContain("WARNING: applied an UNVERIFIED model id");
    expect((await loadRoles(rolesPath)).roles.find((role) => role.name === "planner")).toMatchObject({
      model: "claude-opus-3-retired-xyz",
    });

    const journal = readFileSync(roleAssignmentJournalPath(stateHome), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(journal.length).toBe(1);
    expect(journal[0]!["model_catalog"]).toMatchObject({
      runtime: "claude",
      model: "claude-opus-3-retired-xyz",
      verified: false,
    });
    expect(String((journal[0]!["model_catalog"] as { reason: string }).reason)).toContain(
      "ships no offline model roster",
    );
  });
});

async function captureRoles(args: string[], expectedCode: number): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await cmdRoles(args)).toBe(expectedCode);
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}
