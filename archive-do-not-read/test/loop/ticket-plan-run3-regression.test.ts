// Acceptance evidence for run 3's planner-structure cluster (ISSUE-023,
// ISSUE-024), driven by the exact plan JSON the EpisodePlanner emitted in that
// run. The fixtures under test/fixtures/run3-plans are byte-copies of
// `efficiency/episodes/<id>/plan-v{1,2}.json` from the captured run-3 state
// home; the two `issue-023-*` files are reconstructions of the topologies
// transcribed in ISSUE-023, which was written before those plans were
// persisted. Every case here is a pure graph property — no provider turn, no
// network, no state home.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isEpisodePlan,
  type EpisodePlan,
} from "../../src/loop/episode-plan.js";
import {
  validateTicketEpisodePlan,
  type TicketEpisodePlanIssue,
} from "../../src/loop/ticket-episode-plan.js";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "run3-plans");

/** Content pins. A fixture edited to make a test pass is not evidence. */
const FIXTURE_SHA256 = {
  "ticket-2-plan-v1.json": "211b7419ec114d1e9e370daeea4d818a9c38c247d90d7d12de80e1c69c7957c1",
  "ticket-4-stranded-plan-v1.json":
    "dc1b46cf70e2599b524f137f537740f5136aec1a4c320dcf88e7ec3ca52400e8",
  "ticket-4-stranded-plan-v2.json":
    "370388fc5287b780c3482248f4a5651e38b982febbfe30464bd6f4caa3fe940a",
  "ticket-6-stranded-plan-v1.json":
    "2704183e1aa757039cc11fe5b57073cd3792c006fc799a9da31674f0f57e8c90",
  "ticket-6-stranded-plan-v2.json":
    "19dac4cfe6b0bb3f1b93ffde5aa7a6ab90cee1d0763cae94f436a54c16590328",
  "ticket-9-shipped-plan-v1.json":
    "015ac37700f58623180a7205c2bd05184c364d458649c6743ccf59a3acb6407f",
  "ticket-10-plan-v1.json": "4ca7ab9338e58e519922bf3881abd518dcc9280c9f7fc28b2649b63765af2adb",
  "ticket-10-plan-v2.json": "ff2b7d0f9701fc175d117a85b088a0b918417d06f5401f5ab9c63b3439e6696f",
  "issue-023-attempt-1-plan.json":
    "ffffd906f639479e55f714ab57ff88d135690302ae746dfcc1b6dcbb865bad32",
  "issue-023-attempt-2-repair-plan.json":
    "d6fbe9378ac74ab9363add00bcf80941623056311d9d491b5f5834db28fc9b1a",
} as const;

type FixtureName = keyof typeof FIXTURE_SHA256;

/** The captured file is an accepted, persisted `EpisodePlan`, so it is read
 * through the durable shape guard and handed to the acceptance validator
 * verbatim — exactly the value `validateAcceptedPlan` sees in production. */
async function capturedPlan(name: FixtureName): Promise<EpisodePlan> {
  const raw = await readFile(join(FIXTURE_DIR, name), "utf8");
  expect(createHash("sha256").update(raw).digest("hex")).toBe(FIXTURE_SHA256[name]);
  const parsed = JSON.parse(raw) as unknown;
  if (!isEpisodePlan(parsed)) throw new Error(`${name} is not a durable EpisodePlan`);
  return parsed;
}

function contractIssues(issues: readonly TicketEpisodePlanIssue[]): TicketEpisodePlanIssue[] {
  return issues.filter((issue) => issue.code === "ticket_gate_input_unavailable");
}

describe("run-3 stranded plans fail acceptance before provisioning (ISSUE-024)", () => {
  for (const name of [
    "ticket-4-stranded-plan-v1.json",
    "ticket-6-stranded-plan-v1.json",
  ] as const) {
    it(`rejects ${name} and names the missing build/contract step`, async () => {
      const plan = await capturedPlan(name);
      expect(plan.steps.some((step) =>
        step.kind === "provider_turn" && step.operation === "build/contract"
      )).toBe(false);

      const result = validateTicketEpisodePlan(plan);
      expect(result.ok).toBe(false);
      const missing = contractIssues(result.issues);
      expect(missing.length).toBeGreaterThan(0);
      for (const issue of missing) {
        expect(issue).toMatchObject({
          code: "ticket_gate_input_unavailable",
          rule: "gate_inputs_produced_by_ancestor",
        });
        expect(issue.message).toContain("build/contract");
        expect(issue.message).toContain("criterion_test_contract_mapping");
        expect(issue.message).toContain("completeness");
      }
      // The gate that stranded the paid builder turn is named explicitly.
      expect(missing.map((issue) => issue.stepId)).toContain(
        plan.steps.find((step) =>
          step.kind === "mechanical_gate" && step.gate === "ticket/gates-and-pr"
        )!.id,
      );
    });
  }

  // The v2 revisions kept the same defect and added a fix/fix step. They must
  // still be rejected: adding a remediation turn does not produce a contract.
  for (const name of [
    "ticket-4-stranded-plan-v2.json",
    "ticket-6-stranded-plan-v2.json",
  ] as const) {
    it(`rejects the ${name} revision, which added fix/fix but still no contract`, async () => {
      const plan = await capturedPlan(name);
      expect(plan.steps.some((step) =>
        step.kind === "provider_turn" && step.operation === "fix/fix"
      )).toBe(true);
      expect(contractIssues(validateTicketEpisodePlan(plan).issues).length).toBeGreaterThan(0);
    });
  }
});

describe("run-3 accepted plans stay accepted", () => {
  // The regression guard. #9 is the one plan in this project's history that
  // planned, built, reviewed, opened a PR, and merged without a human. A fix
  // that rejects it has broken the thing it was meant to protect.
  it("still accepts ticket #9 plan-v1 verbatim — the only autonomously shipped plan", async () => {
    const plan = await capturedPlan("ticket-9-shipped-plan-v1.json");
    expect(validateTicketEpisodePlan(plan)).toEqual({ ok: true, issues: [] });
  });

  for (const name of [
    "ticket-2-plan-v1.json",
    "ticket-10-plan-v1.json",
    "ticket-10-plan-v2.json",
  ] as const) {
    it(`still accepts ${name} verbatim`, async () => {
      expect(validateTicketEpisodePlan(await capturedPlan(name)))
        .toEqual({ ok: true, issues: [] });
    });
  }

  // Adversarial near-miss: #9 with only its contract step's *operation*
  // changed still has a builder turn, a worktree write, and every ordering
  // rule intact — and must still be rejected. The rule is about the contract
  // mapping, not about "some builder turn ran".
  it("rejects ticket #9 when only the build/contract operation is swapped away", async () => {
    const plan = await capturedPlan("ticket-9-shipped-plan-v1.json");
    const nearMiss = structuredClone(plan) as EpisodePlan;
    const contract = nearMiss.steps.find((step) =>
      step.kind === "provider_turn" && step.operation === "build/contract"
    );
    if (contract?.kind !== "provider_turn") throw new Error("captured contract step disappeared");
    contract.operation = "ticket/diagnose";

    const issues = contractIssues(validateTicketEpisodePlan(nearMiss).issues);
    expect(issues.map((issue) => issue.stepId)).toEqual(["gates-and-pr", "ship"]);
  });

  // Adversarial near-miss: the contract step exists but sits on a parallel
  // branch, so it is not an ancestor of the gate that reads its mapping.
  it("rejects a contract step that is not a dependency ancestor of the gate", async () => {
    const plan = await capturedPlan("ticket-9-shipped-plan-v1.json");
    const detached = structuredClone(plan) as EpisodePlan;
    const implement = detached.steps.find((step) => step.id === "build-implement");
    if (implement?.kind !== "provider_turn") throw new Error("captured implement step disappeared");
    implement.dependsOn = ["provision"];
    implement.inputRefs = [];

    const issues = contractIssues(validateTicketEpisodePlan(detached).issues);
    expect(issues.map((issue) => issue.stepId)).toEqual(["gates-and-pr", "ship"]);
  });
});

describe("ISSUE-023 topologies", () => {
  it("rejects attempt 1 only for the ship-check-free terminal shape, not the review order", async () => {
    const plan = await capturedPlan("issue-023-attempt-1-plan.json");
    // Attempt 1's review ordering was already correct: the topology validator
    // must not complain about it. (Its real defect was the core validator's
    // plan_terminal_output_missing, which this domain validator does not own.)
    expect(validateTicketEpisodePlan(plan)).toEqual({ ok: true, issues: [] });
  });

  it("rejects the attempt-2 repair that put review-authorization ahead of the review lens", async () => {
    const plan = await capturedPlan("issue-023-attempt-2-repair-plan.json");
    const result = validateTicketEpisodePlan(plan);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ticket_topology_invalid",
        rule: "review_authorization_joins_review_lenses",
        stepId: "review_authorization",
      }),
      expect.objectContaining({
        code: "ticket_topology_invalid",
        rule: "review_lens_feeds_review_authorization",
        stepId: "verify",
      }),
    ]));
  });
});
