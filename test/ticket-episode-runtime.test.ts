import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultGate } from "../src/runtime/gate.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnRequest,
  TurnResult,
} from "../src/runtime/types.js";
import { baseRevisionForBranch } from "../src/loop/default-branch.js";
import {
  selfApprovalMarker,
  type CreateReviewInput,
  type GhReview,
} from "../src/loop/github.js";
import type {
  AcceptedTicketEpisodePlan,
  TicketEpisodePlanningRequest,
} from "../src/loop/driver.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  persistEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type EpisodeStep,
  type MechanicalGateStep,
  type ProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { routeAdmissionForEpisodePlan } from "../src/loop/episode-route.js";
import { admitPlannedEpisodeRoute } from "../src/loop/planner-admission.js";
import type { Policy } from "../src/loop/policy.js";
import type { LoopItem } from "../src/loop/types.js";
import { parseVerdict } from "../src/loop/verdicts.js";
import { resolvedRuntimeCapabilities } from "../src/runtime/capabilities.js";
import { hashedFileStem } from "../src/runtime/runlog/paths.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import { efficiencyEpisodeDir } from "../src/loop/efficiency.js";
import { formatStatusRows, readStatusRows } from "../src/runtime/runlog/status.js";
import { foldAppStories } from "../src/narrative/story.js";
import { cmdTelemetry } from "../src/cli/telemetry.js";
import {
  createTicketEpisodeRuntime,
  type TicketEpisodeRuntime,
} from "../src/org/ticket-episode-runtime.js";
import {
  TICKET_PROVIDER_OPERATIONS,
  ticketProviderOperation,
} from "../src/loop/ticket-episode-plan.js";
import type { AppEntry } from "../src/org/apps.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const NOW = new Date("2026-07-19T22:30:00.000Z");
const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "builder-model-test",
  effort: "high",
};
const PLANNER_ASSIGNMENT: TurnAssignment = {
  harness: "claude",
  model: "planner-model-test",
  effort: "medium",
};
const BUILDER: RoleConfig = role("builder", ASSIGNMENT, 2);
const PLANNER: RoleConfig = role("planner", PLANNER_ASSIGNMENT, 1);
const REVIEWER: RoleConfig = role("reviewer", {
  harness: "claude",
  model: "reviewer-model-test",
  effort: "high",
}, 2);
const ROLES = [PLANNER, BUILDER, REVIEWER] as const;
const CONTEXT: ContextBundle = { taste: ["test authority"], memoryExcerpts: [] };
const POLICY: Policy = {
  riskTiers: { high: [], medium: [], low: [] },
  gates: { high: [], medium: [], low: [] },
  dimensionGlobs: {},
  remediation: { maxAttempts: 3 },
};
/** Minimal valid contract verdict. Every ticket plan that writes to the
 * worktree now needs a `build/contract` step: `ticket/gates-and-pr` scores the
 * completeness gate against the criterion→test mapping only that pass
 * produces, so a plan without it is unsatisfiable (ISSUE-024). */
const CONTRACT_VERDICT = JSON.stringify({
  files: ["src/parser.ts"],
  approach: "Make the bounded parser correction.",
  tests: [{ criterionId: "AC1", tests: ["pnpm test parser"] }],
  risks: "Localized parser behavior only.",
  complexity: "low",
});

function isContractTurn(request: TurnRequest): boolean {
  return request.task.includes("Operation: build/contract");
}

const RUN2_BLOCKED_VERDICT = readFileSync(
  new URL("./fixtures/run2/blocked-build-verdict.json", import.meta.url),
  "utf8",
).trimEnd();

describe("ticket EpisodePlanner execution adapter", () => {
  it("executes one provider call with the exact accepted assignment and role authority", async () => {
    const fixture = await setup("diagnose", "ticket/diagnose");
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(fixture, calls, "bounded diagnostic evidence");
      const beforeProviderTurn = vi.fn(async () => undefined);

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn,
      });
      expect(item.phase).toBe("building");
      expect(beforeProviderTurn).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        assignment: ASSIGNMENT,
        factoryRole: BUILDER,
        requestAssignment: ASSIGNMENT,
        requestRole: BUILDER,
      });
      expect(calls[0]?.request.context.execution).toMatchObject({
        role: "builder",
        assignment: ASSIGNMENT,
        roleDelegation: BUILDER.delegation,
      });
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({ status: "completed" });

      const outputDir = join(
        efficiencyEpisodeDir(fixture.state.root, fixture.accepted.plan.episodeId),
        "ticket-step-outputs",
        "v1",
      );
      const output = JSON.parse(readFileSync(join(outputDir, `${hashedFileStem("diagnose")}.json`), "utf8")) as {
        status: string;
        payloadSha256: string;
        payload: { providerOutput: string };
      };
      expect(output).toMatchObject({
        status: "completed",
        payload: { providerOutput: "bounded diagnostic evidence" },
      });
      expect(output.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fixture.cleanup();
    }
  });

  it("recovers terminal provider evidence after an outer comment crash without rerunning the model", async () => {
    const fixture = await setup("contract", "build/contract", true);
    try {
      const gh = new FailFirstCommentGh({
        cloneRoot: fixture.repo.clone.root,
        issues: [ticketSeed()],
      });
      fixture.replaceGh(gh);
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        JSON.stringify({
          files: ["src/parser.ts"],
          approach: "Make the bounded parser correction.",
          tests: [{ criterionId: "AC1", tests: ["pnpm test parser"] }],
          risks: "Localized parser behavior only.",
          complexity: "low",
        }),
      );

      await expect(runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      })).rejects.toMatchObject({ code: "error_episode_plan_step_interrupted" });
      expect(calls).toHaveLength(1);
      expect(gh.issueComments.get(7)).toBeUndefined();

      const recovered = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => {
          throw new Error("provider must not restart during evidence replay");
        },
      });

      expect(calls).toHaveLength(1);
      expect(recovered.contract).toContain("## Implementation contract");
      expect(gh.issueComments.get(7)).toHaveLength(1);
      expect(gh.issueComments.get(7)?.[0]).toContain("execution-id=");
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({ status: "completed" });
    } finally {
      fixture.cleanup();
    }
  });

  it("fails an invalid typed verdict after one provider turn and never launches a hidden reformat", async () => {
    const fixture = await setup("invalid-contract", "build/contract", true);
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(fixture, calls, "not a contract verdict");

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });

      expect(calls).toHaveLength(1);
      expect(item.phase).toBe("returned");
      expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.accepted.plan.episodeId))
        .toMatchObject({
          status: "failed",
          events: expect.arrayContaining([
            expect.objectContaining({
              kind: "step_failed",
              reason_code: "error_verdict_unparseable",
            }),
          ]),
        });
    } finally {
      fixture.cleanup();
    }
  });

  it("publishes a completed reviewer verdict once, then authorizes the exact remote review commit", async () => {
    const fixture = await setup("verify", "review/verify", true);
    try {
      let actorTerminated = false;
      const gh = new FailAfterReviewPublishGh(
        () => actorTerminated,
        { cloneRoot: fixture.repo.clone.root, issues: [ticketSeed()] },
      );
      fixture.replaceGh(gh);
      fixture.item = {
        ...fixture.item,
        body: "## Goal\nFix a bounded parser bug.\n",
        branch: "main",
      };
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        (request) => request.role.name === "reviewer"
          ? JSON.stringify({
              verdict: "approve",
              findings: [],
              review: {
                rationale: "The exact delivered diff satisfies the bounded parser ticket.",
                evidence: [{
                  claim: "AC1 parser regression",
                  evidence: "the named parser regression test passes at the reviewed head",
                }],
                notReviewed: ["unrelated application paths"],
              },
            })
          : isContractTurn(request)
            ? CONTRACT_VERDICT
            : JSON.stringify({ status: "done" }),
        () => { actorTerminated = true; },
      );

      await expect(runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      })).rejects.toMatchObject({ code: "error_episode_plan_step_interrupted" });
      expect(calls.filter((call) => call.requestRole.name === "reviewer")).toHaveLength(1);
      expect(gh.reviewPublicationCount).toBe(1);
      expect(gh.actorWasTerminatedAtPublication).toBe(true);
      const [pr] = await gh.listPRsForBranch("main");
      if (pr === undefined) throw new Error("expected the seeded gates step to create a PR");

      const recovered = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: {
          ...fixture.item,
          labels: ["op:in-review"],
          phase: "reviewing",
          prNumber: pr.number,
        },
        beforeProviderTurn: async () => {
          throw new Error("the completed reviewer must not restart during delivery recovery");
        },
      });
      expect(calls.filter((call) => call.requestRole.name === "reviewer")).toHaveLength(1);
      expect(gh.reviewPublicationCount).toBe(1);
      const reviews = await gh.listReviews(pr.number);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({ state: "APPROVED", commitId: pr.headRefOid });
      expect(reviews[0]?.body).toContain("## Review rationale");
      expect(reviews[0]?.body).toContain("## Evidence");
      expect(reviews[0]?.body).toContain("## Not reviewed");
      expect(reviews[0]?.body).toContain("unrelated application paths");
      expect(parseVerdict("review", reviews[0]!.body)).toMatchObject({
        ok: true,
        verdict: { verdict: "approve", findings: [] },
      });
      // The seeded contract pass posts its own contract comment; the reviewer
      // verdict comment must still be published exactly once.
      expect((gh.issueComments.get(7) ?? []).filter((body) =>
        body.includes("Structured review verdict"))).toHaveLength(1);

      expect(recovered).toMatchObject({
        phase: "shipping",
        approvedCommitId: pr.headRefOid,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("authorizes a same-account comment fallback only from its relisted remote commit", async () => {
    const fixture = await setup("verify", "review/verify", true);
    try {
      const secret = "fixture-review-authorization-secret";
      const gh = new SelfCommentReviewGh(secret, {
        cloneRoot: fixture.repo.clone.root,
        issues: [ticketSeed()],
      });
      fixture.replaceGh(gh);
      fixture.runtimeOptions = {
        ...fixture.runtimeOptions,
        authorization: { selfApprovalSecret: secret },
      };
      fixture.item = {
        ...fixture.item,
        body: "## Goal\nFix a bounded parser bug.\n",
        branch: "main",
      };
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        (request) => request.role.name === "reviewer"
          ? JSON.stringify({
              verdict: "approve",
              findings: [],
              review: {
                rationale: "The exact delivered diff satisfies the bounded parser ticket.",
                evidence: [{
                  claim: "AC1 parser regression",
                  evidence: "the named parser regression test passes at the reviewed head",
                }],
                notReviewed: [],
              },
            })
          : isContractTurn(request)
            ? CONTRACT_VERDICT
            : JSON.stringify({ status: "done" }),
      );

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });
      const [pr] = await gh.listPRsForBranch("main");
      if (pr === undefined) throw new Error("expected the seeded gates step to create a PR");
      const reviews = await gh.listReviews(pr.number);

      expect(gh.syntheticCreateResultCommit).not.toBe(pr.headRefOid);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({ state: "COMMENTED", commitId: pr.headRefOid });
      expect(item).toMatchObject({ phase: "shipping", approvedCommitId: pr.headRefOid });
    } finally {
      fixture.cleanup();
    }
  });

  it("reports the exact run-2 typed blocked verdict as blocked/failed across durable surfaces", async () => {
    const fixture = await setup("implement", "build/implement", true, true, true);
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        (request) => isContractTurn(request) ? CONTRACT_VERDICT : RUN2_BLOCKED_VERDICT,
      );
      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });

      // The seeded contract ancestor runs first, then the blocked implement turn.
      expect(calls).toHaveLength(2);
      expect(item.phase).toBe("returned");
      const rows = await readStatusRows(fixture.state.root, { app: "fixture" });
      const implement = rows.find((row) => row.pass === "implement");
      expect(implement).toMatchObject({ status: "blocked" });
      expect(JSON.parse(implement!.verdictSummary!)).toEqual(JSON.parse(RUN2_BLOCKED_VERDICT));
      const statusText = formatStatusRows(rows);
      expect(statusText).toMatch(/episode-plan-dag\/implement\s+blocked/);
      expect(statusText).toContain("TERMINAL ATTENTION");
      expect(statusText).toContain("duplicated mapping key");

      const telemetryLines: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        telemetryLines.push(args.map(String).join(" "));
      });
      try {
        expect(await cmdTelemetry([
          "--org-home", fixture.org.root,
          "--state-home", fixture.state.root,
          "--app", "fixture",
        ])).toBe(0);
      } finally {
        log.mockRestore();
      }
      const telemetryText = telemetryLines.join("\n");
      expect(telemetryText).toMatch(/episode-plan-dag\/implement\s+blocked/);
      expect(telemetryText).toContain("terminal integrity: valid; 0/1 (0.0%)");
      // Two provider turns ran (the seeded contract ancestor and the blocked
      // implement turn); neither is productive because the episode failed.
      expect(telemetryText).toContain("productive provider turns: valid; 0/2 (0.0%)");
      expect(telemetryText).toContain("trace-declared stages only: incomplete");
      expect(telemetryText).not.toContain("trace-declared stages only: complete");

      const narrative = await foldAppStories(fixture.state.root, "fixture");
      const story = narrative.stories.find(
        (candidate) => candidate.story_id === fixture.accepted.plan.episodeId,
      );
      expect(story).toMatchObject({ status: "failed" });
      expect(story?.moments.find((moment) => moment.pass === "implement")).toMatchObject({
        status: "blocked",
      });
    } finally {
      fixture.cleanup();
    }
  });

  // ISSUE-016 residual. `fix/fix` was reachable in an accepted plan but had
  // never been executed offline. It is executed here end to end, through the
  // same catalog-driven template resolution that the run-2 revision crashed on.
  it("executes the registered fix/fix operation end to end and publishes its resolutions", async () => {
    const fixture = await setup("fix", "fix/fix", true, true, true);
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        JSON.stringify({
          status: "done",
          blockedEntry: null,
          resolutions: [
            { outcome: "fixed", location: "src/parser.ts:42", note: "commit ab12cd3, test/parser.test.ts" },
            { outcome: "rebutted", location: "docs/spec.md:9", note: "documented behavior, see docs/spec.md" },
          ],
        }),
      );

      const item = await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });

      // One paid turn, with the catalog's own pipeline/pass/template triple.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.request.role.name).toBe("builder");
      expect(calls[0]?.request.task).toContain("Operation: fix/fix");
      expect(calls[0]?.request.task).toContain("Governed pipeline/pass: fix/fix");
      expect(calls[0]?.request.task).toContain("Access: write");
      // ISSUE-012 asserted nothing could bind a ticket to a builder turn. The
      // ticket route binds the ref, the title, and the acceptance criteria into
      // every builder step's brief.
      expect(calls[0]?.request.task).toContain("Ticket: #7 Fix a bounded parser bug");
      expect(calls[0]?.request.task).toContain("parser regression is covered");
      // The template resolved to real prompt bytes — the undefined-template
      // TypeError ISSUE-016 reported cannot recur silently.
      expect(calls[0]?.request.task).toContain("Return the typed verdict.");
      expect(calls[0]?.request.verdictSchema).toMatchObject({ title: "BuildVerdict" });

      // The build verdict parsed and the fix step completed. The plan's later
      // deterministic gate step is out of this test's scope, so assert the fix
      // step's own durable evidence rather than the whole-plan status.
      const journal = await readEpisodePlanExecutionJournal(
        fixture.state.root,
        fixture.accepted.plan.episodeId,
      );
      expect(journal?.events.some((event) =>
        event.kind === "step_completed" && event.step_id === "fix"
      )).toBe(true);
      expect(journal?.blocked_step_id).not.toBe("fix");
      const fixOutput = JSON.parse(readFileSync(
        join(
          efficiencyEpisodeDir(fixture.state.root, fixture.accepted.plan.episodeId),
          "ticket-step-outputs",
          "v1",
          `${hashedFileStem("fix")}.json`,
        ),
        "utf8",
      )) as { status: string; payload: { providerOutput: string } };
      expect(fixOutput.status).toBe("completed");
      expect(JSON.parse(fixOutput.payload.providerOutput)).toMatchObject({ status: "done" });

      // The resolutions reached the durable findings ledger. This is the only
      // behaviour that distinguishes fix/fix from build/implement.
      const comments = fixture.gh.issueComments.get(7) ?? [];
      const resolutionComment = comments.find((body) => body.includes("fixed src/parser.ts:42"));
      expect(resolutionComment).toBeDefined();
      expect(resolutionComment).toContain("- rebutted docs/spec.md:9 -- documented behavior, see docs/spec.md");

      const rows = await readStatusRows(fixture.state.root, { app: "fixture" });
      const fixRow = rows.find((row) => row.pass === "fix");
      expect(fixRow).toMatchObject({ status: "completed" });
      expect(JSON.parse(fixRow!.verdictSummary!)).toMatchObject({ status: "done" });
    } finally {
      fixture.cleanup();
    }
  });

  it("completes a fix/fix turn whose strict-mode verdict carries explicit nulls", async () => {
    // Codex strict structured outputs must emit every declared property, so a
    // fix pass with nothing to resolve returns `resolutions: null`. Passing
    // that null through made `resolutions !== undefined` true and threw a raw
    // TypeError inside the comment renderer — the ISSUE-016 failure shape.
    const fixture = await setup("fix", "fix/fix", true, true, true);
    try {
      const calls: ObservedCall[] = [];
      const runtime = makeTicketRuntime(
        fixture,
        calls,
        JSON.stringify({ status: "done", blockedEntry: null, resolutions: null }),
      );

      await runtime.executeTicketPlan({
        request: fixture.request,
        accepted: fixture.accepted,
        item: fixture.item,
        beforeProviderTurn: async () => undefined,
      });

      expect(calls).toHaveLength(1);
      const journal = await readEpisodePlanExecutionJournal(
        fixture.state.root,
        fixture.accepted.plan.episodeId,
      );
      expect(journal?.events.some((event) =>
        event.kind === "step_completed" && event.step_id === "fix"
      )).toBe(true);
      // No resolutions means no findings-ledger comment, not a crash.
      const comments = fixture.gh.issueComments.get(7) ?? [];
      expect(comments.some((body) => body.includes("Fix resolutions"))).toBe(false);
      expect(JSON.stringify(journal)).not.toContain("is not a function");
    } finally {
      fixture.cleanup();
    }
  });

  it("refuses an unregistered operation before constructing a provider", async () => {
    // Adversarial near-miss for ISSUE-016: the exact invented names run 2 saw.
    // They must be rejected as typed operation-binding failures, never reach a
    // template lookup, and never surface as a raw Node TypeError.
    for (const invented of ["ticket/repair", "build/diagnose"]) {
      expect(TICKET_PROVIDER_OPERATIONS).not.toContain(invented);
      const fixture = await setup("fix", invented, true, true, false);
      try {
        const runtimeForAssignment = vi.fn((): Runtime => ({
          kind: "codex",
          async runTurn(): Promise<TurnResult> {
            throw new Error("no provider may be constructed for an unregistered operation");
          },
        }));
        const runtime = createTicketEpisodeRuntime({
          ...fixture.runtimeOptions,
          runtimeForAssignment,
        });
        const failure = await runtime.executeTicketPlan({
          request: fixture.request,
          accepted: fixture.accepted,
          item: fixture.item,
          beforeProviderTurn: async () => undefined,
        }).then(
          () => undefined,
          (error: unknown) => error as Error & { code?: string },
        );

        expect(runtimeForAssignment).not.toHaveBeenCalled();
        expect(failure).toBeDefined();
        expect(failure!.code).toBe("error_ticket_episode_plan_invalid");
        expect(failure!.message).toContain("ticket_provider_operation_unknown");
        expect(failure!.message).toContain(invented);
        // The valid set is named, and no Node TypeError leaks through.
        expect(failure!.message).toContain("fix/fix");
        expect(failure!.message).not.toContain("must be of type string or an instance of Buffer");
      } finally {
        fixture.cleanup();
      }
    }
  });

  it("rejects a planner allowance that leaves no delivery budget before runtime construction", async () => {
    const fixture = await setup("budget", "ticket/diagnose", false, false);
    try {
      const runtimeForAssignment = vi.fn((): Runtime => ({
        kind: "codex",
        async runTurn(): Promise<TurnResult> {
          throw new Error("no provider should be constructed");
        },
      }));
      const runtime = createTicketEpisodeRuntime({
        ...fixture.runtimeOptions,
        remainingBudgetUsd: 0.5,
        plannerPromptText: "Return one EpisodePlan JSON object.",
        plannerLimits: {
          maxAttempts: 1,
          perAttempt: {
            equivalentCostUsd: 0.5,
            activeTimeMs: 1_000,
          },
          aggregate: {
            providerTurns: 1,
            equivalentCostUsd: 0.5,
            activeTimeMs: 1_000,
          },
        },
        runtimeForAssignment,
      });

      await expect(runtime.planTicket(fixture.request)).rejects.toThrow(
        /must be positive and leave delivery budget/,
      );
      expect(runtimeForAssignment).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });
});

interface ObservedCall {
  assignment: TurnAssignment;
  factoryRole: RoleConfig;
  requestAssignment?: TurnAssignment;
  requestRole: RoleConfig;
  request: TurnRequest;
}

interface Fixture {
  state: ReturnType<typeof makeOrgHome>;
  org: ReturnType<typeof makeOrgHome>;
  repo: ReturnType<typeof makeBareWithClone>;
  gh: FakeGhOps;
  request: TicketEpisodePlanningRequest;
  accepted: AcceptedTicketEpisodePlan;
  item: LoopItem;
  runtimeOptions: Parameters<typeof createTicketEpisodeRuntime>[0];
  replaceGh(gh: FakeGhOps): void;
  cleanup(): void;
}

async function setup(
  stepId: string,
  operation: string,
  needsPrompt = false,
  persist = true,
  validWriteTopology = false,
): Promise<Fixture> {
  const state = makeOrgHome();
  const org = makeOrgHome();
  const repo = makeBareWithClone();
  if (needsPrompt) {
    // The template comes from the operation catalog, exactly as the executor
    // resolves it. Every write topology now carries a seeded build/contract
    // ancestor (the gate-input rule requires one), and a review topology also
    // needs the implement step's template.
    const catalogTemplate = ticketProviderOperation(operation)?.template;
    const prompts = [...new Set([
      ...(catalogTemplate === undefined || catalogTemplate === null
        ? []
        : [join(org.root, "prompts", ...catalogTemplate.split("/"))]),
      join(org.root, "prompts", "build", "contract.md"),
      ...(operation === "review/verify"
        ? [join(org.root, "prompts", "build", "implement.md")]
        : []),
    ])];
    for (const prompt of prompts) {
      mkdirSync(dirname(prompt), { recursive: true });
      writeFileSync(prompt, "Return the typed verdict.");
    }
  }
  let gh = new FakeGhOps({
    cloneRoot: repo.clone.root,
    issues: [ticketSeed()],
  });
  const app: AppEntry = {
    name: "fixture",
    repo: "fixture/repo",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
    execution: { assignmentMode: "fixed", allowedAssignments: {} },
  };
  const step = providerStep(stepId, operation);
  // A seeded ticket/gates-and-pr needs its contract ancestor unless the step
  // under test is itself the contract pass.
  const seededContract: ProviderTurnStep[] = operation === "build/contract"
    ? []
    : [{ ...providerStep("contract", "build/contract"), dependsOn: ["provision"] }];
  const steps: EpisodeStep[] = validWriteTopology
    ? [
        mechanicalStep("provision", "ticket/provision", []),
        ...seededContract,
        { ...step, dependsOn: seededContract.length === 0 ? ["provision"] : ["contract"] },
        mechanicalStep("gates", "ticket/gates-and-pr", [stepId]),
      ]
    : [step];
  const accepted = authority(steps);
  if (persist) {
    await persistEpisodePlan({
      root: state.root,
      intent: accepted.intent,
      plan: accepted.plan,
      policy: validationPolicy(),
    });
    await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
      root: state.root,
      intent: accepted.intent,
      plan: accepted.plan,
      now: NOW,
    }));
  }
  const request: TicketEpisodePlanningRequest = {
    root: state.root,
    episodeId: accepted.plan.episodeId,
    app: app.name,
    targetRepo: app.repo,
    localRepo: repo.clone.root,
    base: baseRevisionForBranch("main"),
    ticket: {
      issueNumber: 7,
      ticketRef: "#7",
      title: "Fix a bounded parser bug",
      body: ticketSeed().body!,
      labels: ["op:building"],
    },
  };
  const item: LoopItem = {
    issueNumber: 7,
    ticketRef: "#7",
    title: request.ticket.title,
    body: request.ticket.body,
    targetRepo: app.repo,
    labels: ["op:building"],
    phase: "building",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    branch: "op/7-parser",
    worktree: repo.clone.root,
  };
  const runtimeOptions: Fixture["runtimeOptions"] = {
    root: state.root,
    orgRoot: org.root,
    app,
    roles: ROLES,
    gh,
    policy: POLICY,
    commands: {},
    hooks: { gate: defaultGate },
    runtimeForAssignment: () => {
      throw new Error("test must supply a runtime factory");
    },
    plannerContext: CONTEXT,
    remainingBudgetUsd: 50,
    now: () => NOW,
  };
  const fixture: Fixture = {
    state,
    org,
    repo,
    gh,
    request,
    accepted,
    item,
    runtimeOptions,
    replaceGh(nextGh) {
      gh = nextGh;
      fixture.gh = nextGh;
      fixture.runtimeOptions = { ...fixture.runtimeOptions, gh: nextGh };
    },
    cleanup() {
      state.cleanup();
      org.cleanup();
      repo.cleanup();
    },
  };
  return fixture;
}

function makeTicketRuntime(
  fixture: Fixture,
  calls: ObservedCall[],
  summary: string | ((request: TurnRequest) => string),
  onActorTerminated?: () => void,
): TicketEpisodeRuntime {
  return createTicketEpisodeRuntime({
    ...fixture.runtimeOptions,
    runtimeForAssignment: (assignment, roleConfig): Runtime => ({
      kind: assignment.harness,
      async runTurn(request): Promise<TurnResult> {
        calls.push({
          assignment: structuredClone(assignment),
          factoryRole: structuredClone(roleConfig),
          ...(request.assignment === undefined
            ? {}
            : { requestAssignment: structuredClone(request.assignment) }),
          requestRole: structuredClone(request.role),
          request,
        });
        try {
          return {
            status: "completed",
            summary: typeof summary === "string" ? summary : summary(request),
            artifacts: [],
            session: { runtime: assignment.harness, id: `session-${calls.length}` },
            usage: {
              tokensIn: 10,
              tokensOut: 5,
              costUsd: 0.01,
              subagentTurns: 0,
              wallClockMs: 5,
            },
            escalations: [],
          };
        } finally {
          onActorTerminated?.();
        }
      },
    }),
  });
}

function providerStep(stepId: string, operation: string): ProviderTurnStep {
  const review = operation.startsWith("review/") || operation.startsWith("ship/");
  return {
    kind: "provider_turn",
    operation,
    id: stepId,
    role: review ? "reviewer" : "builder",
    objective: `Execute ${operation}`,
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    assignment: review
      ? { harness: REVIEWER.runtime, model: REVIEWER.model, effort: REVIEWER.effort }
      : ASSIGNMENT,
    assignmentSource: "configured",
    inputRefs: [{ ref: "github:#7", required: true }],
    expectedOutputs: [{ id: `${stepId}-evidence`, kind: "evidence", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "One bounded provider turn is sufficient for this test ticket",
  };
}

function authority(inputSteps: EpisodeStep[]): AcceptedTicketEpisodePlan {
  const reviewStep = inputSteps.length === 1 && inputSteps[0]?.kind === "provider_turn" &&
      inputSteps[0].role === "reviewer"
    ? inputSteps[0]
    : undefined;
  const contract: ProviderTurnStep = {
    ...providerStep("contract", "build/contract"),
    dependsOn: ["provision"],
    inputRefs: [{ ref: "plan-output:worktree", required: true }],
  };
  const implementation: ProviderTurnStep = {
    ...providerStep("implement", "build/implement"),
    dependsOn: [contract.id],
    inputRefs: [{ ref: `plan-output:${contract.expectedOutputs[0]!.id}`, required: true }],
  };
  const reviewedStep: ProviderTurnStep | undefined = reviewStep === undefined
    ? undefined
    : {
        ...reviewStep,
        dependsOn: ["gates"],
        inputRefs: [{ ref: "plan-output:pr", required: true }],
      };
  const steps: EpisodeStep[] = reviewedStep === undefined
    ? inputSteps
    : [
        {
          kind: "mechanical_gate",
          id: "provision",
          objective: "Confirm the isolated worktree is provisioned.",
          dependsOn: [],
          inputRefs: [{ ref: "github:#7", required: true }],
          expectedOutputs: [{ id: "worktree", kind: "provisioned-worktree", required: true }],
          gate: "ticket/provision",
        },
        contract,
        implementation,
        {
          kind: "mechanical_gate",
          id: "gates",
          objective: "Run deterministic gates and create the pull request.",
          dependsOn: [implementation.id],
          inputRefs: [{ ref: `plan-output:${implementation.expectedOutputs[0]!.id}`, required: true }],
          expectedOutputs: [{ id: "pr", kind: "pr", required: true }],
          gate: "ticket/gates-and-pr",
        },
        reviewedStep,
        {
          kind: "mechanical_gate",
          id: "review-auth",
          objective: "Authorize the exact published review revision.",
          dependsOn: [reviewedStep.id],
          inputRefs: [{ ref: `plan-output:${reviewedStep.expectedOutputs[0]!.id}`, required: true }],
          expectedOutputs: [{ id: "review-authorization", kind: "review-authorization", required: true }],
          gate: "ticket/review-authorization",
        },
      ];
  const creatorSteps = steps.map((step) => Object.fromEntries(
    Object.entries(step).filter(([key]) => key !== "assignmentSource"),
  ) as NonNullable<CreatorEpisodeScope["steps"]>[number]);
  const providerSteps = steps.filter((step): step is ProviderTurnStep => step.kind === "provider_turn");
  const selectedRoles = [...new Set(providerSteps.map((step) => step.role))].map((name) => {
    const selected = ROLES.find((roleConfig) => roleConfig.name === name);
    if (selected === undefined) throw new Error(`missing test role ${name}`);
    return selected;
  });
  const providerBudgetUsd = providerSteps.reduce(
    (sum, providerStep) => sum + providerStep.maxTurnBudgetUsd,
    0,
  );
  const provenance = {
    source: "agent" as const,
    creatorId: "parent-episode-planner",
    createdAt: NOW.toISOString(),
    evidenceRefs: ["parent-plan:v1"],
  };
  const creatorScope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance,
    objective: "Fix a bounded parser bug",
    inScope: ["bounded ticket evidence"],
    outOfScope: ["unrelated product work"],
    acceptanceCriteria: ["the planned step produces its required evidence"],
    expectedArtifacts: steps.flatMap((step) =>
      step.expectedOutputs.map((output) => ({ ...output }))),
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: creatorSteps,
  };
  const intent: EpisodeIntent = {
    episodeId: "ticket:fixture:#7",
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "github_issue", sourceRef: "fixture/repo#7" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { baseRef: "refs/remotes/origin/main" },
    requestedConstraints: { network: false },
    hardBudget: {
      maxProviderTurns: providerSteps.length,
      maxEquivalentCostUsd: providerBudgetUsd,
      maxMechanicalOverheadUsd: 0,
    },
    availableRoles: selectedRoles.map((selectedRole) => ({
      role: selectedRole.name,
      responsibility: selectedRole.name === "reviewer"
        ? "Independently review the bounded ticket"
        : "Implement or diagnose the bounded ticket",
      requiredCapabilities: ["tool_gate"],
      expectedOutputs: selectedRole.name === "reviewer" ? ["review"] : ["patch"],
      configuredAssignment: {
        harness: selectedRole.runtime,
        model: selectedRole.model,
        effort: selectedRole.effort,
      },
    })),
    allowedAssignments: selectedRoles.map((selectedRole) => {
      const assignment = {
        harness: selectedRole.runtime,
        model: selectedRole.model,
        effort: selectedRole.effort,
      };
      return {
        candidateId: "configured",
        role: selectedRole.name,
        assignment,
        providerFamily: assignment.harness === "claude" ? "anthropic" as const : "openai" as const,
        capabilities: resolvedRuntimeCapabilities(assignment.harness),
        qualificationRef: `configured-role-assignment:${selectedRole.name}`,
        priceRef: "role.max_turn_budget_usd",
        maxTurnCostUsd: 2,
        available: true,
      };
    }),
    requiredSafetyFacts: [],
    creatorScope,
  };
  const plan: EpisodePlan = {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: intent.goal,
    workflowClass: "bounded-ticket-test",
    planningSource: "creator_scope",
    creatorProvenance: provenance,
    steps,
    estimatedBudget: {
      providerTurns: providerSteps.length,
      providerTurnBudgetUsd: providerBudgetUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: providerBudgetUsd,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, []),
    createdAt: NOW.toISOString(),
  };
  return { intent, plan };
}

function mechanicalStep(
  id: string,
  gate: string,
  dependsOn: string[],
): MechanicalGateStep {
  return {
    kind: "mechanical_gate",
    id,
    gate,
    objective: `Execute ${gate}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [{ id: `${id}-evidence`, kind: "evidence", required: true }],
  };
}

function validationPolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (name) => {
      if (name === "builder") return ASSIGNMENT;
      if (name === "reviewer") {
        return { harness: REVIEWER.runtime, model: REVIEWER.model, effort: REVIEWER.effort };
      }
      return undefined;
    },
    isAssignmentAllowed: (name, assignment) => {
      const configured = name === "builder"
        ? ASSIGNMENT
        : name === "reviewer"
          ? { harness: REVIEWER.runtime, model: REVIEWER.model, effort: REVIEWER.effort }
          : undefined;
      return configured !== undefined && JSON.stringify(assignment) === JSON.stringify(configured);
    },
    isKnownRole: (name) => name === "builder" || name === "reviewer",
    capabilitiesFor: (_name, assignment) => resolvedRuntimeCapabilities(assignment.harness),
    requiredTerminalOutputIds: [],
  };
}

function role(name: string, assignment: TurnAssignment, maxTurnBudgetUsd: number): RoleConfig {
  return {
    name,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["evidence"],
    maxTurnBudgetUsd,
  };
}

function ticketSeed(): { number: number; title: string; body: string; labels: string[] } {
  return {
    number: 7,
    title: "Fix a bounded parser bug",
    body: [
      "## Goal",
      "Fix a bounded parser bug.",
      "",
      "## Acceptance criteria",
      "- [ ] parser regression is covered",
      "",
    ].join("\n"),
    labels: ["op:building"],
  };
}

class FailFirstCommentGh extends FakeGhOps {
  private fail = true;

  override async commentIssue(issueNumber: number, body: string): Promise<void> {
    if (this.fail) {
      this.fail = false;
      throw new Error("injected crash after provider terminal evidence");
    }
    await super.commentIssue(issueNumber, body);
  }
}

class FailAfterReviewPublishGh extends FakeGhOps {
  private failRemoteReconciliation = true;
  reviewPublicationCount = 0;
  actorWasTerminatedAtPublication = false;

  constructor(
    private readonly actorTerminated: () => boolean,
    options: ConstructorParameters<typeof FakeGhOps>[0],
  ) {
    super(options);
  }

  override async createReview(
    prNumber: number,
    input: CreateReviewInput,
    author?: string,
  ): Promise<GhReview> {
    this.reviewPublicationCount += 1;
    this.actorWasTerminatedAtPublication = this.actorTerminated();
    return super.createReview(prNumber, input, author);
  }

  override async listReviews(prNumber: number): Promise<GhReview[]> {
    if (this.reviewPublicationCount > 0 && this.failRemoteReconciliation) {
      this.failRemoteReconciliation = false;
      throw new Error("injected crash after remote review publication");
    }
    return super.listReviews(prNumber);
  }
}

class SelfCommentReviewGh extends FakeGhOps {
  readonly syntheticCreateResultCommit = "synthetic-client-acknowledgement";

  constructor(
    private readonly secret: string,
    options: ConstructorParameters<typeof FakeGhOps>[0],
  ) {
    super(options);
  }

  override async createReview(
    prNumber: number,
    input: CreateReviewInput,
    author?: string,
  ): Promise<GhReview> {
    if (input.state !== "approve") return super.createReview(prNumber, input, author);
    const pr = await this.readPR(prNumber);
    if (pr.headRefOid === undefined) throw new Error("test PR head must resolve");
    const body = `${input.body.trimEnd()}\n\n${selfApprovalMarker(
      this.secret,
      prNumber,
      pr.headRefOid,
    )}\n`;
    const remote = await super.createReview(
      prNumber,
      {
        state: "comment",
        body,
        ...(input.expectedCommit === undefined ? {} : { expectedCommit: input.expectedCommit }),
      },
      author,
    );
    return { ...remote, commitId: this.syntheticCreateResultCommit };
  }
}
