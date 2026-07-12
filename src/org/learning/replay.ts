// Paired-replay execution (M5; design §9.3-§9.5): recreate a build episode's
// starting conditions from a trusted eval fixture and ask an arm — control
// (the stable system) or treatment (stable plus the candidate under test) —
// to attempt the task again in an isolated worktree.
//
// Replay is where the learning loop finally spends model tokens, so its
// side-effect surface is structurally empty rather than policy-checked: the
// executor never constructs GhOps, never grants network, and its runs land
// under the reserved `learning-replay` runlog namespace, which the capture
// and episode projectors skip — a replay must not become evidence in the
// store it is being judged against.
//
// Offline outcome semantics (spec deltas, recorded in the M5 PR):
//   - `merged` grades MERGE-EQUIVALENCE: final quality gates pass AND the
//     final review pass approves. No PR exists to merge, publishing is
//     forbidden by the capsule's side-effect policy.
//   - `review_cycles` counts review rounds that returned findings (0 = the
//     first review approved), mirroring the loop's bounce semantics with a
//     single bounded fix round in V1.
//   - The held-out contract (design §9.3): expected outcomes and graders
//     never enter brief or context bytes — the acting agent sees the
//     original brief and the arm's context, nothing else.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadGateCommands, DEFAULT_LOOP_POLICY } from "../../loop/driver.js";
import { defaultCriterionTests, parseAcceptanceCriteria } from "../../loop/loop.js";
import type { PipelineConfig } from "../../loop/pipelines.js";
import { executePipeline } from "../../loop/pipeline.js";
import { loadPolicy, resolveTier } from "../../loop/policy.js";
import { runGates, type GateRunResult } from "../../loop/qgates.js";
import {
  parseVerdictEither,
  parseWithRetry,
  VERDICT_SCHEMAS,
  type ReviewVerdict,
} from "../../loop/verdicts.js";
import { defaultGate } from "../../runtime/gate.js";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../../runtime/types.js";
import { assembleContext } from "../context.js";
import { orgLearningRoot, appLearningRoot, renderActivatedConcept } from "./concepts.js";
import { conceptDraftPath, findCandidateArtifact } from "./candidate-store.js";
import type { CandidateArtifact } from "./candidate.js";
import { gradeBuildOutcome, type EvalFixture } from "./eval-fixture.js";
import type { ExperimentRecord } from "./experiment.js";
import { sanitizeIdSegment } from "./events.js";
import type { LearningPolicy } from "./policy.js";
import { renderConcept } from "./resolver.js";
import { parseOkfDocument } from "../memory.js";

// Replay runs land under the reserved REPLAY_RUNLOG_APP namespace declared
// in capture.ts — the projectors skip it so replays never contaminate the
// evidence store; reconcile deliberately still walks it (spend recovery is
// about money, not evidence).
import { REPLAY_RUNLOG_APP } from "./capture.js";
export { REPLAY_RUNLOG_APP };

export type ReplayArm = "control" | "treatment";
export type ReplayMode = "targeted" | "full";

export interface ReplayAttemptRequest {
  fixture: EvalFixture;
  arm: ReplayArm;
  /** 0 for the targeted pre-check, 1..N for full paired trials. */
  pair: number;
  mode: ReplayMode;
  experiment: ExperimentRecord;
}

export interface ReplayAttempt {
  arm: ReplayArm;
  pair: number;
  mode: ReplayMode;
  /** Metric name → value, EvalTrial-shaped. Only what the mode measured:
   *  targeted attempts carry no merged/review_cycles. */
  metrics: Record<string, number>;
  /** The held-in grade: did this attempt do at least as well as the
   *  original episode (full), or build cleanly through gates (targeted)? */
  heldInPass: boolean;
  costUsd: number;
  runIds: string[];
  detail: string;
}

export interface ReplayExecutor {
  attempt(request: ReplayAttemptRequest): Promise<ReplayAttempt>;
}

export interface LoopReplayExecutorOptions {
  orgHome: string;
  stateHome: string;
  /** Local clone containing the fixture's seed commit (fetched by the CLI
   *  before the runner starts). */
  localRepo: string;
  worktreeRoot: string;
  roles: Record<string, RoleConfig>;
  runtimeFor: (role: RoleConfig) => Runtime;
  policy: LearningPolicy;
  /** Rendered treatment overlay — the candidate's concept exactly as the
   *  resolver would render it active (renderCandidateOverlay). Required
   *  when any treatment attempt runs. */
  treatmentOverlay?: string;
  /** Candidate the experiment tests; stamps per-candidate ledger rows. */
  candidateRef?: string;
  hooks?: TurnHooks;
  clock?: () => Date;
}

/** The real executor: worktree from the seed commit, build/review passes
 *  through the ordinary pass executor (envelopes, briefs, safety gate,
 *  ledger settlement — all standard), quality gates between passes. */
export function createLoopReplayExecutor(options: LoopReplayExecutorOptions): ReplayExecutor {
  const clock = options.clock ?? ((): Date => new Date());
  const hooks: TurnHooks = options.hooks ?? { gate: defaultGate };

  return {
    async attempt(request: ReplayAttemptRequest): Promise<ReplayAttempt> {
      const { fixture, arm, pair, mode } = request;
      if (fixture.validated_by === null) {
        throw new Error(
          `learning: fixture ${fixture.fixture_id} is not independently validated — ` +
            `replay spends tokens only on trusted evals (spec §7)`,
        );
      }
      const brief = fixture.input.brief;
      if (brief === null || brief === undefined) {
        throw new Error(
          `learning: fixture ${fixture.fixture_id} carries no verbatim brief — ` +
            `re-assemble its capsule while the run's brief.md survives, then re-draft`,
        );
      }
      if (fixture.seed.commit === null) {
        throw new Error(`learning: fixture ${fixture.fixture_id} has no seed commit`);
      }
      if (arm === "treatment" && options.treatmentOverlay === undefined) {
        throw new Error("learning: treatment attempts need the candidate overlay");
      }

      const builder = requireRole(options.roles, "builder");
      const reviewer = requireRole(options.roles, "reviewer");
      const attemptSlug = `${sanitizeIdSegment(request.experiment.experiment_id)}-p${pair}-${arm}`;
      const worktree = createSeedWorktree(
        options.localRepo,
        options.worktreeRoot,
        `replay/${attemptSlug}`,
        fixture.seed.commit,
      );
      try {
        const context = await armContext(options, worktree, request, builder);
        const runIds: string[] = [];
        let costUsd = 0;
        let gateFailures = 0;

        const runPass = async (
          role: RoleConfig,
          passId: string,
          task: string,
          withVerdict: boolean,
        ): Promise<{ summary: string; verdict?: ReviewVerdict; completed: boolean }> => {
          let verdict: ReviewVerdict | undefined;
          const result = await executePipeline({
            pipeline: replayPipeline(passId, role.name),
            selection: { tier: "standard" },
            roles: options.roles,
            runtimeFor: options.runtimeFor,
            briefFor: () => task,
            promptsDir: options.orgHome,
            context: withVerdict
              ? context.reviewer ?? context.builder
              : context.builder,
            // Eval fixtures are independently validated as byte-exact inputs.
            // Authority remains in native context + envelope, not fixture text.
            authorityBrief: "context-only",
            workdir: worktree,
            hooks,
            runlog: {
              root: options.stateHome,
              app: REPLAY_RUNLOG_APP,
              ticket: fixture.input.ticket_ref,
              traceId: `replay-${attemptSlug}`,
            },
            clock,
            telemetry: {
              orgDir: options.stateHome,
              trigger: "manual",
              experimentRef: request.experiment.experiment_id,
              ...(options.candidateRef !== undefined
                ? { candidateRef: options.candidateRef }
                : {}),
            },
            ...(withVerdict
              ? {
                  verdictSchemaFor: () => VERDICT_SCHEMAS.review,
                  recordVerdict: async (ctx) => {
                    try {
                      verdict = await parseWithRetry(
                        "review",
                        ctx.result.summary,
                        async (reason) => {
                          const retry = await ctx.runtime.runTurn(
                            {
                              role: ctx.role,
                              workdir: ctx.workdir,
                              task: `Your review verdict could not be parsed (${reason}). Restate ONLY the structured review verdict.`,
                              context: ctx.context,
                              session: ctx.result.session,
                            },
                            ctx.hooks,
                          );
                          return retry.summary;
                        },
                        (t) => parseVerdictEither("review", t),
                      );
                      await ctx.events.append({
                        type: "verdict.recorded",
                        detail: { kind: "review", verdict: verdict.verdict },
                      });
                      return { ok: true };
                    } catch (error) {
                      return {
                        ok: false,
                        errorCode: "error_verdict_unparseable",
                        error: error instanceof Error ? error : new Error(String(error)),
                      };
                    }
                  },
                }
              : {}),
          });
          for (const record of result.passes) {
            runIds.push(record.runId);
            costUsd += record.result.usage.costUsd;
          }
          const last = result.passes.at(-1);
          return {
            summary: last?.result.summary ?? "",
            ...(verdict !== undefined ? { verdict } : {}),
            completed: !result.aborted && last?.result.status === "completed",
          };
        };

        const gates = async (): Promise<GateRunResult> => {
          const result = await runReplayGates(worktree, fixture.seed.commit!, brief);
          if (result.status !== "pass") gateFailures += 1;
          return result;
        };

        // -- build ----------------------------------------------------------
        const build = await runPass(builder, "build", brief, false);
        if (!build.completed) {
          return finish("build pass did not complete", {
            arm, pair, mode,
            metrics: { held_in_pass: 0, gate_failures: gateFailures, cost_usd: costUsd },
            heldInPass: false, costUsd, runIds,
          });
        }
        let gate = await gates();

        if (mode === "targeted") {
          // Targeted role-level eval (design §9.5): one builder pass, graded
          // by the quality gates — the cheap step before full replay.
          const pass = gate.status === "pass";
          return finish(pass ? "build + gates pass" : `gates ${gate.status}`, {
            arm, pair, mode,
            metrics: {
              held_in_pass: pass ? 1 : 0,
              gate_failures: gateFailures,
              cost_usd: costUsd,
            },
            heldInPass: pass, costUsd, runIds,
          });
        }

        // -- full: review, one bounded fix round, re-review -----------------
        let reviewCycles = 0;
        let approved = false;
        const review = await runPass(reviewer, "review", reviewBrief(brief, worktree, fixture.seed.commit!), true);
        let findings = review.verdict?.findings ?? [];
        if (review.verdict?.verdict === "approve") {
          approved = true;
        } else {
          reviewCycles += 1;
          const fix = await runPass(builder, "fix", fixBrief(brief, findings), false);
          if (fix.completed) {
            gate = await gates();
            const second = await runPass(reviewer, "review-2", reviewBrief(brief, worktree, fixture.seed.commit!), true);
            approved = second.verdict?.verdict === "approve";
            if (!approved) reviewCycles += 1;
            findings = second.verdict?.findings ?? findings;
          }
        }

        const merged = gate.status === "pass" && approved;
        const grade = gradeBuildOutcome(fixture.expected_outcome, {
          merged,
          review_cycles: reviewCycles,
        });
        return finish(
          grade.pass ? "merge-equivalent within expected review cycles" : grade.reasons.join("; "),
          {
            arm, pair, mode,
            metrics: {
              merged: merged ? 1 : 0,
              review_cycles: reviewCycles,
              gate_failures: gateFailures,
              held_in_pass: grade.pass ? 1 : 0,
              cost_usd: costUsd,
            },
            heldInPass: grade.pass, costUsd, runIds,
          },
        );
      } finally {
        removeSeedWorktree(options.localRepo, worktree);
      }
    },
  };
}

function finish(detail: string, attempt: Omit<ReplayAttempt, "detail">): ReplayAttempt {
  return { ...attempt, detail };
}

// ---------------------------------------------------------------------------
// arm context
// ---------------------------------------------------------------------------

interface ArmContext {
  builder: ContextBundle;
  reviewer?: ContextBundle;
}

/** Both arms resolve the STABLE lineage record-free (a running live trial
 *  must not leak into an offline experiment); the treatment arm prepends the
 *  candidate overlay as the first governed section — exactly where the
 *  resolver would place it once active. */
async function armContext(
  options: LoopReplayExecutorOptions,
  worktree: string,
  request: ReplayAttemptRequest,
  builder: RoleConfig,
): Promise<ArmContext> {
  const reviewer = options.roles["reviewer"];
  const assemble = async (role: RoleConfig): Promise<ContextBundle> => {
    const assembled = await assembleContext({
      orgHome: options.orgHome,
      appWorkdir: worktree,
      app: request.experiment.eligibility.app,
      role,
      taskText: request.fixture.input.brief ?? "",
      learning: {
        turnId: `replay-${sanitizeIdSegment(request.experiment.experiment_id)}-p${request.pair}-${request.arm}-${role.name}`,
        episodeId: request.fixture.episode_ref,
        lineageOverride: "stable",
      },
    });
    if (request.arm === "treatment" && options.treatmentOverlay !== undefined) {
      return {
        ...assembled.bundle,
        memoryExcerpts: [options.treatmentOverlay, ...assembled.bundle.memoryExcerpts],
      };
    }
    return assembled.bundle;
  };
  const builderBundle = await assemble(builder);
  return {
    builder: builderBundle,
    ...(reviewer !== undefined ? { reviewer: await assemble(reviewer) } : {}),
  };
}

/** Render the candidate's draft concept for the treatment arm — the same
 *  activated bytes the publisher would write, through the same renderer the
 *  resolver uses. */
export async function renderCandidateOverlay(input: {
  orgHome: string;
  appWorkdir?: string;
  candidateId: string;
  policy: LearningPolicy;
}): Promise<{ overlay: string; candidate: CandidateArtifact }> {
  const roots = [
    orgLearningRoot(input.orgHome),
    ...(input.appWorkdir !== undefined ? [appLearningRoot(input.appWorkdir)] : []),
  ];
  const found = await findCandidateArtifact(roots, input.candidateId);
  if (found === undefined) {
    throw new Error(`learning: no candidate ${input.candidateId} in the searched roots`);
  }
  if (found.candidate.destination !== "okf_concept") {
    throw new Error(
      `learning: ${input.candidateId} routes to ${found.candidate.destination} — ` +
        `only okf_concept candidates replay as context overlays`,
    );
  }
  const draft = [found.root, ...roots]
    .map((root) => conceptDraftPath(root, input.candidateId))
    .find((path) => existsSync(path));
  if (draft === undefined) {
    throw new Error(
      `learning: ${input.candidateId} has no concept draft (.md beside the candidate JSON)`,
    );
  }
  const activated = await renderActivatedConcept(draft);
  const doc = parseOkfDocument(activated.bytes, draft);
  return {
    overlay: renderConcept(doc, activated.scope, false, input.policy),
    candidate: found.candidate,
  };
}

// ---------------------------------------------------------------------------
// passes, briefs, gates
// ---------------------------------------------------------------------------

/** template "" = brief-only task (the runRole precedent); replay briefs are
 *  the fixture's verbatim inputs, not prompt templates. */
function replayPipeline(passId: string, roleName: string): PipelineConfig {
  return {
    name: "replay",
    mechanical: false,
    passes: [{ id: passId, role: roleName, template: "" }],
  };
}

const DIFF_CAP_BYTES = 24 * 1024;

function reviewBrief(brief: string, worktree: string, seedCommit: string): string {
  let diff: string;
  try {
    diff = gitIn(worktree, "diff", seedCommit, "HEAD");
  } catch (error) {
    diff = `(diff unavailable: ${error instanceof Error ? error.message : String(error)})`;
  }
  if (Buffer.byteLength(diff, "utf8") > DIFF_CAP_BYTES) {
    // Truncate in BYTES (the cap's unit); toString drops a split multibyte
    // sequence into a replacement char rather than a lone surrogate.
    const capped = Buffer.from(diff, "utf8").subarray(0, DIFF_CAP_BYTES).toString("utf8");
    diff = `${capped}\n… (diff truncated at ${DIFF_CAP_BYTES} bytes)`;
  }
  return [
    "You are reviewing a replayed implementation attempt. The original task brief follows, then the diff.",
    "Respond with a structured review verdict: `approve`, or `findings` with the finding list.",
    "",
    "## Original task brief",
    "",
    brief,
    "",
    "## Diff under review",
    "",
    "```diff",
    diff,
    "```",
  ].join("\n");
}

function fixBrief(brief: string, findings: ReviewVerdict["findings"]): string {
  return [
    "Address the review findings on your implementation of the task below. Fix them in the worktree.",
    "",
    "## Review findings",
    "",
    ...findings.map(
      (finding) =>
        `- ${finding.category}/${finding.severity} ${finding.location} — ${finding.description} -> ${finding.action}`,
    ),
    "",
    "## Original task brief",
    "",
    brief,
  ].join("\n");
}

/** Quality gates against the seed diff, with the app's own policy and
 *  commands when the worktree carries them (the setup gate installs deps
 *  first, exactly like a loop tick). Acceptance criteria parse from the
 *  original brief — it embeds the ticket body — and map through the same
 *  placeholder tests the manual loop driver uses. */
async function runReplayGates(
  worktree: string,
  seedCommit: string,
  brief: string,
): Promise<GateRunResult> {
  const policyPath = join(worktree, ".operon", "policy.yaml");
  const policy = existsSync(policyPath) ? await loadPolicy(policyPath) : DEFAULT_LOOP_POLICY;
  const changed = gitIn(worktree, "diff", "--name-only", seedCommit, "HEAD")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const head = gitIn(worktree, "rev-parse", "HEAD");
  const criteria = parseAcceptanceCriteria(brief);
  return runGates(
    resolveTier(policy, changed),
    worktree,
    criteria,
    [],
    // Review freshness is a loop-PR concern; replay grades review approval
    // through the verdict itself.
    { approvedCommitId: head, headCommitId: head },
    {
      policy,
      commands: loadGateCommands(worktree),
      criterionTests: defaultCriterionTests(criteria, "replay"),
    },
  );
}

// ---------------------------------------------------------------------------
// seed worktrees
// ---------------------------------------------------------------------------

function createSeedWorktree(
  localRepo: string,
  worktreeRoot: string,
  branch: string,
  seedCommit: string,
): string {
  const path = join(worktreeRoot, branch.replace(/\//g, "-"));
  if (existsSync(path)) removeSeedWorktree(localRepo, path);
  execFileSync("git", ["worktree", "add", "-B", branch, path, seedCommit], {
    cwd: localRepo,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return path;
}

function removeSeedWorktree(localRepo: string, worktree: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: localRepo,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    rmSync(worktree, { recursive: true, force: true });
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: localRepo, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // best effort — a stale worktree entry never blocks the next attempt
      // because createSeedWorktree removes before adding.
    }
  }
}

/** Shared by the executor and the experiment CLI: one git wrapper whose
 *  errors carry stderr — an opaque "Command failed: git …" hides whether a
 *  fetch failed on auth or a missing ref. */
export function gitIn(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `\n${stderr.trim()}` : "";
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${detail}`);
  }
}

function requireRole(roles: Record<string, RoleConfig>, name: string): RoleConfig {
  const role = roles[name];
  if (role === undefined) {
    throw new Error(`learning: replay needs a "${name}" role in roles.yaml`);
  }
  return role;
}
