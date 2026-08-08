import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { writeFileAtomic } from "../../../src/org/atomic.js";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { AcceptanceCampaignConfig, ScenarioConfig } from "./campaign-config.js";

type YamlMap = Record<string, unknown>;

function configuredRole(assignment: TurnAssignment, prior: unknown): YamlMap {
  const role = typeof prior === "object" && prior !== null && !Array.isArray(prior) ? (prior as YamlMap) : {};
  return { ...role, runtime: assignment.harness, model: assignment.model, effort: assignment.effort };
}

async function updateRoles(orgHome: string, mutate: (roles: YamlMap) => void): Promise<void> {
  const path = join(orgHome, "roles.yaml");
  const root = parse(await readFile(path, "utf8")) as YamlMap;
  if (typeof root !== "object" || root === null || Array.isArray(root)) throw new Error(`${path}: not a YAML mapping`);
  const roles = root["roles"];
  if (typeof roles !== "object" || roles === null || Array.isArray(roles))
    throw new Error(`${path}: roles is not a mapping`);
  mutate(roles as YamlMap);
  await writeFileAtomic(path, stringify(root));
}

/** Prepare the disposable org's grader role before any scenario mutation. */
export async function prepareCampaignOrgRoles(orgHome: string, config: AcceptanceCampaignConfig): Promise<void> {
  const graders = config.graderPlan.flatMap((entry) => (entry.grader === undefined ? [] : [entry.grader]));
  const unique = new Map(graders.map((assignment) => [JSON.stringify(assignment), assignment]));
  const grader = [...unique.values()][0];
  const firstApp = config.scenarios.find((scenario) => scenario.kind === "app");
  if (grader === undefined || firstApp === undefined)
    throw new Error("campaign refused: grader or app matrix is absent");
  await updateRoles(orgHome, (roles) => {
    for (const role of ["planner", "builder", "reviewer"] as const) {
      const assignment = firstApp.matrix[role];
      if (assignment === undefined) throw new Error(`campaign refused: ${firstApp.id}.${role} is absent`);
      roles[role] = configuredRole(assignment, roles[role]);
    }
    roles["acceptance-grader"] = {
      ...configuredRole(grader, roles["acceptance-grader"]),
      max_turn_budget_usd: 50,
      delegation: { allow: [] },
      triggers: [{ manual: true }],
      outputs: ["acceptance-axis-score"],
    };
  });
}

/** Activate the exact admitted grader tuple immediately before construction.
 *  The role remains fixed from the product's point of view; the campaign is
 *  the operator selecting a different ratified tuple between isolated turns. */
export async function activateAcceptanceGrader(orgHome: string, assignment: TurnAssignment): Promise<void> {
  await updateRoles(orgHome, (roles) => {
    roles["acceptance-grader"] = configuredRole(assignment, roles["acceptance-grader"]);
  });
  const root = parse(await readFile(join(orgHome, "roles.yaml"), "utf8")) as { roles?: YamlMap };
  const actual = root.roles?.["acceptance-grader"] as YamlMap | undefined;
  if (
    actual?.["runtime"] !== assignment.harness ||
    actual?.["model"] !== assignment.model ||
    actual?.["effort"] !== assignment.effort
  ) {
    throw new Error("campaign refused: exact acceptance-grader activation drifted");
  }
}

/** Activate and verify an app scenario's exact fixed role tuples immediately before its arm. */
export async function activateScenarioRoleMatrix(orgHome: string, scenario: ScenarioConfig): Promise<void> {
  if (scenario.kind !== "app") return;
  await updateRoles(orgHome, (roles) => {
    for (const role of ["planner", "builder", "reviewer"] as const) {
      const assignment = scenario.matrix[role];
      if (assignment === undefined) throw new Error(`campaign refused: ${scenario.id}.${role} is absent`);
      roles[role] = configuredRole(assignment, roles[role]);
    }
  });
  const root = parse(await readFile(join(orgHome, "roles.yaml"), "utf8")) as { roles?: YamlMap };
  for (const role of ["planner", "builder", "reviewer"] as const) {
    const actual = root.roles?.[role] as YamlMap | undefined;
    const expected = scenario.matrix[role];
    if (expected === undefined) throw new Error(`campaign refused: ${scenario.id}.${role} is absent`);
    if (
      actual?.["runtime"] !== expected.harness ||
      actual?.["model"] !== expected.model ||
      actual?.["effort"] !== expected.effort
    ) {
      throw new Error(`campaign refused: exact role activation drifted for ${scenario.id}.${role}`);
    }
  }
}
