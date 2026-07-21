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
import { applyRoleAssignmentChange, roleAssignmentJournalPath } from "../src/org/role-assignment.js";
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
      ["set", "planner", "--effort", "xhigh", "--turn-budget", "15", "--org-home", orgHome, "--state-home", stateHome],
      0,
    );

    expect(output).toContain(`PREVIEW roles set planner — ${rolesPath}`);
    expect(output).toContain("before: claude/claude-opus-4-8@high turn budget $5 (inherited)");
    expect(output).toContain("after:  claude/claude-opus-4-8@xhigh turn budget $15");
    expect(output).toContain("effort: high -> xhigh");
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
      ["set", "planner", "--effort", "xhigh", "--execute", "--reason", "agreed in review",
        "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(unattributed).toContain("BLOCKED unratified_execution");
    expect(unattributed).toContain("--execute requires an attributable --by <identity>");

    const unreasoned = await captureRoles(
      ["set", "planner", "--effort", "xhigh", "--execute", "--by", "bikram@example.invalid",
        "--org-home", orgHome, "--state-home", stateHome],
      1,
    );
    expect(unreasoned).toContain("BLOCKED missing_reason");

    expect(readFileSync(rolesPath, "utf8")).toBe(before);
    expect(existsSync(roleAssignmentJournalPath(stateHome))).toBe(false);
  });

  it("applies an attributed change, preserves comments, and journals it", async () => {
    const { orgHome, stateHome, rolesPath } = await fixture();

    const output = await captureRoles(
      ["set", "planner", "--effort", "xhigh", "--turn-budget", "15", "--execute",
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

    const reloaded = await loadRoles(rolesPath);
    const planner = reloaded.roles.find((role) => role.name === "planner")!;
    expect(planner).toMatchObject({
      runtime: "claude",
      model: "claude-opus-4-8",
      effort: "xhigh",
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
      before: { effort: "high", maxTurnBudgetUsd: 5, turnBudgetInherited: true },
      after: { effort: "xhigh", maxTurnBudgetUsd: 15, turnBudgetInherited: false },
    });
    expect(journal[0]!["roles_sha256_before"]).not.toBe(journal[0]!["roles_sha256_after"]);
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
      ["set", "planner", "--effort", "high", "--org-home", orgHome, "--state-home", stateHome],
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
