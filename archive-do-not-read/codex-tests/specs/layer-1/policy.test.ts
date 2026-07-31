import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  loadValidationPolicy,
  validateValidationPolicy,
} from "../../src/policy/load.js";
import { HARNESS_ROOT } from "../../src/fixtures/controlled-world.js";

interface Mutation {
  name: string;
  operation: "add" | "delete" | "replace";
  path: string[];
  value?: unknown;
}

const policyPath = resolve(HARNESS_ROOT, "validation-policy.yaml");
const mutationPath = resolve(HARNESS_ROOT, "fixtures", "policy", "invalid-mutations.yaml");

describe("validation policy enforcement core", () => {
  it("loads the ratified isolated C3 policy", async () => {
    const policy = await loadValidationPolicy(policyPath);

    expect(policy.scope).toBe("product");
    expect(policy.default_tier).toBe("C3");
    expect(policy.coexistence.posture).toBe("parallel-greenfield");
    expect(policy.coexistence.protected_paths).toEqual(
      expect.arrayContaining(["../test/", "../eval/"]),
    );
    expect(policy.authorizations.layer_4_episode_planner).toMatchObject({
      id: "OPERON-L4-001",
      status: "human_authorized",
      assignment: {
        harness: "claude",
        model: "claude-opus-5",
        effort: "xhigh",
      },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
        stop_before_exceeding: true,
      },
    });
    expect(policy.authorizations.layer_4_episode_planner_diagnostic).toMatchObject({
      id: "OPERON-L4-002",
      status: "human_authorized",
      parent_campaign_id: "OPERON-L4-001",
      assignment: {
        harness: "claude",
        model: "claude-opus-5",
        effort: "xhigh",
      },
      corpus: {
        case_id: "OPERON-EP-003",
        runs_per_case: 3,
        total_attempts: 3,
        frozen_read_only: true,
      },
      quality: {
        diagnostic_only: true,
        qualification_claim: "prohibited",
      },
      spend: {
        aggregate_ceiling_usd: 10,
        per_turn_ceiling_usd: 5,
        stop_before_exceeding: true,
      },
      external_effects_authorized: false,
    });
    expect(policy.authorizations.layer_4_episode_planner_qualification).toMatchObject({
      id: "OPERON-L4-002",
      stage: "qualification",
      status: "human_authorized",
      assignment: {
        harness: "claude",
        model: "claude-opus-5",
        effort: "xhigh",
      },
      diagnostic_evidence: {
        required_status: "passed",
      },
      corpus: {
        cases: 10,
        runs_per_case: 3,
        total_attempts: 30,
        frozen_read_only: true,
      },
      quality: {
        overall_min_acceptable: 27,
        min_acceptable_per_case: 2,
        critical_min_acceptable_per_case: 3,
      },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
        stop_before_exceeding: true,
      },
      external_effects_authorized: false,
      production_assignment_change: "not_authorized",
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_003_diagnostic,
    ).toMatchObject({
      id: "OPERON-L4-003",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-002",
      assignment: {
        harness: "claude",
        model: "claude-opus-5",
        effort: "xhigh",
      },
      corpus: {
        case_id: "OPERON-EP-004",
        runs_per_case: 3,
        total_attempts: 3,
        frozen_read_only: true,
      },
      spend: {
        aggregate_ceiling_usd: 10,
        per_turn_ceiling_usd: 5,
        stop_before_exceeding: true,
      },
      external_effects_authorized: false,
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_003_qualification,
    ).toMatchObject({
      id: "OPERON-L4-003",
      stage: "qualification",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-002",
      diagnostic_evidence: {
        required_status: "passed_with_attributable_original_verdict_defect",
      },
      corpus: {
        cases: 10,
        runs_per_case: 3,
        total_attempts: 30,
        frozen_read_only: true,
      },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
        stop_before_exceeding: true,
      },
      external_effects_authorized: false,
      production_assignment_change: "not_authorized",
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_004_diagnostic,
    ).toMatchObject({
      id: "OPERON-L4-004",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-003",
      corpus: {
        case_id: "OPERON-EP-003",
        runs_per_case: 3,
        total_attempts: 3,
      },
      spend: {
        aggregate_ceiling_usd: 10,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_004_qualification,
    ).toMatchObject({
      id: "OPERON-L4-004",
      stage: "qualification",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-003",
      diagnostic_evidence: { required_status: "passed" },
      corpus: { cases: 10, runs_per_case: 3, total_attempts: 30 },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
      production_assignment_change: "not_authorized",
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_005_diagnostic,
    ).toMatchObject({
      id: "OPERON-L4-005",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-004",
      corpus: {
        case_id: "OPERON-EP-004",
        runs_per_case: 3,
        total_attempts: 3,
      },
      spend: {
        aggregate_ceiling_usd: 10,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
    });
    expect(
      policy.authorizations.layer_4_episode_planner_l4_005_qualification,
    ).toMatchObject({
      id: "OPERON-L4-005",
      stage: "qualification",
      status: "human_authorized_by_delegation",
      parent_campaign_id: "OPERON-L4-004",
      diagnostic_evidence: { required_status: "passed" },
      corpus: { cases: 10, runs_per_case: 3, total_attempts: 30 },
      spend: {
        aggregate_ceiling_usd: 60,
        per_turn_ceiling_usd: 5,
      },
      external_effects_authorized: false,
      production_assignment_change: "not_authorized",
    });
    expect(policy.authorizations.layer_3_external_operations).toBe("not_authorized");
    expect(policy.authorizations.additive_ci).toBe("not_authorized");
    expect(policy.tooling.isolation.generated_output_root).toBe("./.artifacts/");
    expect(policy.implementation.external_operations_authorized).toBe(false);
    expect(policy.implementation.ci_changes_authorized).toBe(false);
  });

  it("fails closed for each seeded unsafe policy mutation", async () => {
    const source = parse(await readFile(policyPath, "utf8")) as Record<string, unknown>;
    const mutations = parse(await readFile(mutationPath, "utf8")) as Mutation[];

    expect(mutations.length).toBeGreaterThan(0);
    for (const mutation of mutations) {
      const candidate = structuredClone(source);
      applyMutation(candidate, mutation);
      expect(
        () => validateValidationPolicy(candidate),
        `mutation ${mutation.name} should be rejected`,
      ).toThrow();
    }
  });
});

function applyMutation(target: Record<string, unknown>, mutation: Mutation): void {
  const parentPath = mutation.path.slice(0, -1);
  const leaf = mutation.path.at(-1);
  if (leaf === undefined) throw new Error(`mutation ${mutation.name} has an empty path`);
  let parent: Record<string, unknown> | unknown[] = target;
  for (const segment of parentPath) {
    const next = Array.isArray(parent) ? parent[Number(segment)] : parent[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      if (!Array.isArray(next)) {
        throw new Error(`mutation ${mutation.name} cannot traverse ${segment}`);
      }
    }
    parent = next as Record<string, unknown> | unknown[];
  }
  if (Array.isArray(parent)) {
    const index = Number(leaf);
    if (!Number.isInteger(index)) {
      throw new Error(`mutation ${mutation.name} has a non-numeric list index`);
    }
    if (mutation.operation === "delete") parent.splice(index, 1);
    else parent[index] = mutation.value;
  } else if (mutation.operation === "delete") delete parent[leaf];
  else parent[leaf] = mutation.value;
}
