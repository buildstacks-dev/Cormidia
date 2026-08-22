// Traceability: CF-J12-A · HB-157; CF-C-B32 · HB-156 · contracts/journey-acceptance.md J-12 alternative-surface criterion; contracts/B-32-learning-kernel-ports.md.

// CF-J12-A — the five learning states (candidate / published / authorized /
// active / validated) render DISTINCTLY on the learn/report surfaces of the
// KERNEL path (L2 evid, risk E3; INV-012 falsifying shape: "authorized"
// surfaced as "validated"; B-32: the kernel's four-dimensional intervention
// state is the recorded fact; `validated` exists only after the kernel's
// own evaluation improved the intervention — kernel decision 0028).
//
// Surface under test: the REAL `cormidia learn` CLI (cmdLearn) run in-process
// against the temp homes via --org-home/--state-home, output captured from
// the console seam. Nothing is mocked below the CLI except the replay runner
// the kernel drives (a deterministic host runner at the B-32 §5 seam).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import { cmdLearn } from "../../../src/cli/learn.js";
import { ingestEpisodes } from "../../../src/org/learning-loop/candidates.js";
import {
  declareKernelExperiment,
  REPLAY_METRICS,
  runKernelExperiment,
} from "../../../src/org/learning-loop/experiments.js";
import { writeHostExperiment } from "../../../src/org/learning-loop/experiments-audit.js";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { prepareKernelCandidate } from "../../../src/org/learning-loop/publish-prepare.js";
import type { CormidiaReplayRunner } from "../../../src/org/learning-loop/replay-executor.js";
import { openCandidateArtifact } from "../../../src/org/learning-loop/host/candidate-store.js";
import type { EvalFixture } from "../../../src/org/learning-loop/host/eval-fixture.js";
import type { SystemFingerprint } from "../../../src/org/learning-loop/host/fingerprint.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import {
  candidateSpec,
  KERNEL_APP,
  KERNEL_EPISODE,
  makeKernelWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type KernelWorld,
} from "./learning-kernel-seams.js";

/** A deterministic host runner: the treatment arm always holds in, the control never. */
function improvingRunner(): CormidiaReplayRunner {
  return {
    id: "deterministic-improving",
    version: "1.0.0",
    configurationDigest: sha256HexOfCanonicalJson({ runner: "deterministic-improving" }),
    run: (request) =>
      Promise.resolve({
        status: "completed",
        measurements: [
          { metric: REPLAY_METRICS.held_in_pass, value: request.arm === "treatment" },
          { metric: REPLAY_METRICS.merged, value: true },
        ],
        cost: { amount: 0.1, currency: "USD" },
      }),
  };
}

function fingerprint(id: string, lineage: string): SystemFingerprint {
  return {
    fingerprint_id: id,
    cormidia: { version: "0.1.1", commit: "abc" },
    org: { commit: "def", taste_hash: "t", roles_hash: "r", pipelines_hash: "p", prompts_hash: "q" },
    app: { name: KERNEL_APP, commit: null, config_hash: null },
    bundle_versions: { org: "2026.07.31-1" },
    bundle_lineage: lineage,
    models: { builder: { runtime: "codex", model: "gpt", effort: "high" } },
    gates_hash: null,
    permissions_hash: null,
    budget_caps: { app_usd_month: null, per_turn_usd_by_role: {} },
    env: { node: "v26.7.0", platform: "darwin" },
  };
}

function fixture(): EvalFixture {
  return {
    schema_version: 1,
    fixture_id: "evals/org/standard/cap_kernel_0001",
    eval_set: "org/standard",
    capsule_ref: "cap_kernel_0001",
    episode_ref: KERNEL_EPISODE,
    kind: "build_ticket",
    seed: { repo: "fixture/app", commit: "0123456789abcdef0123456789abcdef01234567", fixtures: [] },
    input: { ticket_ref: `${KERNEL_APP}#1`, brief_hash: null, brief: "Fix the thing." },
    fingerprint_ref: null,
    artifacts: [],
    observed_outcome: { merged: true, review_cycles: 1, cost_usd: 0.5 },
    expected_outcome: { merged: true, review_cycles: 1, cost_usd: 0.5 },
    grader: { kind: "deterministic", ref: "grader:build-outcome-v1" },
    side_effect_policy: { network: "fixture_only", publishing: "forbidden", deployment: "sandbox_only" },
    sanitized: true,
    drafted_by: "human:drafter",
    drafted_at: "2026-07-31T10:00:00.000Z",
    validated_by: "human:validator",
    validated_at: "2026-07-31T10:30:00.000Z",
  };
}

describe("CF-J12-A — candidate/published/authorized/active/validated render distinctly on the kernel path (L2 evid, E3)", () => {
  let world: KernelWorld;
  let flags: string[];
  let publishedId: string;
  let activeId: string;
  let validatedId: string;

  const runLearn = async (args: string[]): Promise<{ code: number; out: string; err: string }> => {
    const outLines: string[] = [];
    const errLines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      outLines.push(parts.map(String).join(" "));
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errLines.push(parts.map(String).join(" "));
    });
    try {
      const code = await cmdLearn([...args, ...flags]);
      return { code, out: outLines.join("\n"), err: errLines.join("\n") };
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  };

  const dispositionOf = (out: string): string =>
    out
      .split("\n")
      .filter((line) => line.startsWith("disposition:"))
      .join(" | ");

  beforeAll(async () => {
    world = await makeKernelWorld("cf-j12-a-kernel", { replayRunner: improvingRunner() });
    flags = ["--org-home", world.org.orgHome, "--state-home", world.state.stateHome];

    // State 1 — candidate awaiting review (fails closed).
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_awaiting", destination: "skill_draft" }));

    // State 2 — reviewed (kernel candidate + decisive review minted), not yet published.
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_reviewed", destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: "cand_a_reviewed", destination: "skill_draft" }));
    const reviewed = await prepareKernelCandidate(world.deps, "cand_a_reviewed", { requireProceed: false });
    if (reviewed.status !== "prepared") throw new Error(`review not recorded: ${JSON.stringify(reviewed)}`);

    // State 3 — published (routine proposal draft; inactive by effect class).
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_published", destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: "cand_a_published", destination: "skill_draft" }));
    const routine = await publishCandidate(world.deps, "cand_a_published");
    if (routine.status !== "published") throw new Error(`routine publish failed: ${JSON.stringify(routine)}`);
    publishedId = routine.intervention.id;

    // State 4 — active with claim AUTHORIZED (human-gated activation).
    await seedReviewedOkfCandidate(world, { id: "cand_a_active", conceptId: "lrn_a_active", name: "a-active-lesson" });
    await raiseAndApprove(world, "cand_a_active");
    const activated = await publishCandidate(world.deps, "cand_a_active");
    if (activated.status !== "published") throw new Error(`gated publish failed: ${JSON.stringify(activated)}`);
    activeId = activated.intervention.id;

    // State 5 — VALIDATED: only the kernel's own evaluation can move
    // `validation` (decision 0028): declare and run a kernel experiment on
    // the activated intervention through the deterministic runner.
    await seedReviewedOkfCandidate(world, {
      id: "cand_a_validated",
      conceptId: "lrn_a_validated",
      name: "a-validated-lesson",
    });
    await raiseAndApprove(world, "cand_a_validated");
    const validated = await publishCandidate(world.deps, "cand_a_validated");
    if (validated.status !== "published") throw new Error(`gated publish failed: ${JSON.stringify(validated)}`);
    validatedId = validated.intervention.id;
    await ingestEpisodes(world.learning);
    await declareKernelExperiment({
      learning: world.learning,
      experimentId: "exp_a_validated",
      artifactId: "cand_a_validated",
      candidateId: validated.intervention.candidateId,
      interventionId: validatedId,
      app: KERNEL_APP,
      stage: ["live"],
      evalSet: "evals/org/standard",
      fixtures: [fixture()],
      hypothesis: "the lesson holds in",
      metric: "held_in_pass",
      direction: "higher",
      minimumUsefulEffect: 0.5,
      guardrails: [{ metric: "merged", rule: "must_not_regress" }],
      repetitions: 1,
      control: fingerprint("sys_a_control", "stable"),
      treatment: fingerprint("sys_a_treatment", "candidate:a"),
    });
    const outcome = await runKernelExperiment(world.learning, "exp_a_validated");
    if (outcome.evaluation.verdict !== "improved") {
      throw new Error(`expected an improved verdict, got ${JSON.stringify(outcome.evaluation)}`);
    }
  }, 120_000);

  afterAll(async () => {
    await world.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("learn show renders all five states as pairwise-distinct dispositions", async () => {
    const awaiting = await runLearn(["show", "cand_a_awaiting"]);
    const reviewed = await runLearn(["show", "cand_a_reviewed"]);
    const published = await runLearn(["show", publishedId]);
    const active = await runLearn(["show", activeId]);
    const validated = await runLearn(["show", validatedId]);
    for (const result of [awaiting, reviewed, published, active, validated]) {
      expect(result.code, result.err).toBe(0);
    }
    const dispositions = [
      dispositionOf(awaiting.out),
      dispositionOf(reviewed.out),
      dispositionOf(published.out),
      dispositionOf(active.out),
      dispositionOf(validated.out),
    ];
    expect(dispositions[0]).toContain("awaiting review");
    expect(dispositions[1]).toContain("reviewed, not yet published");
    expect(dispositions[2]).toContain("published skill_draft");
    expect(dispositions[3]).toContain("active okf_concept");
    expect(dispositions[4]).toContain("active okf_concept");
    expect(new Set(dispositions).size).toBe(dispositions.length);
  });

  it('authorized renders as "authorized (unproven)" and NEVER as validated (INV-012)', async () => {
    const active = await runLearn(["show", activeId]);
    const disposition = dispositionOf(active.out);
    expect(disposition).toContain("claim authorized (unproven)");
    expect(disposition).toContain("validation untested");
    expect(disposition).not.toContain("claim validated");
  });

  it("a published-but-inactive record carries NO claim — published does not imply authorized-into-context/active", async () => {
    const published = await runLearn(["show", publishedId]);
    const disposition = dispositionOf(published.out);
    expect(disposition).toContain("published skill_draft");
    expect(disposition).not.toContain("claim");
  });

  it('validated renders as "claim validated" only on the intervention whose kernel evaluation improved', async () => {
    const validated = await runLearn(["show", validatedId]);
    const disposition = dispositionOf(validated.out);
    expect(disposition).toContain("claim validated");
    expect(disposition).toContain("validation improved");
  });

  it("learn report --json keeps claim and claim_display distinct per intervention — authorized never blends into validated", async () => {
    const report = await runLearn(["report", "--json"]);
    expect(report.code, report.err).toBe(0);
    const parsed: unknown = JSON.parse(report.out);
    if (parsed === null || typeof parsed !== "object") throw new Error("report is not an object");
    const interventions: unknown = Reflect.get(parsed, "interventions");
    const reviews: unknown = Reflect.get(parsed, "reviews");
    if (!Array.isArray(interventions) || !Array.isArray(reviews)) throw new Error("report shape");
    const row = (id: string): Record<string, unknown> => {
      const found: unknown = interventions.find(
        (entry: unknown) => entry !== null && typeof entry === "object" && Reflect.get(entry, "intervention_id") === id,
      );
      if (found === null || typeof found !== "object") throw new Error(`no row for ${id}`);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(found)) out[key] = Reflect.get(found, key);
      return out;
    };
    expect(row(publishedId)["claim"]).toBeNull();
    expect(row(publishedId)["claim_display"]).toBeUndefined();
    expect(row(activeId)["claim"]).toBe("authorized");
    expect(row(activeId)["claim_display"]).toBe("authorized (unproven)");
    expect(row(validatedId)["claim"]).toBe("validated");
    expect(row(validatedId)["claim_display"]).toBe("validated");
    expect(row(activeId)["engine"]).toBe("kernel");
    expect(
      reviews.some(
        (entry: unknown) =>
          entry !== null && typeof entry === "object" && Reflect.get(entry, "candidate_id") === "cand_a_reviewed",
      ),
    ).toBe(true);
  });

  it("negative control: a forged improved verdict planted in the host audit copy cannot surface as validated — the claim comes from the kernel state only", async () => {
    await mkdir(join(world.learning.stateDir, "host", "experiments"), { recursive: true });
    await writeHostExperiment(world.learning.stateDir, {
      schema_version: 1,
      experiment_id: "exp_a_forged",
      artifact_id: "cand_a_active",
      candidate_id: "cand_a_active",
      intervention_id: activeId,
      app: KERNEL_APP,
      eval_set: "evals/org/standard",
      hypothesis: "forged",
      declared_at: "2026-07-31T12:00:00.000Z",
      definition_digest: "f".repeat(64),
      control_fingerprint: "a".repeat(64),
      treatment_fingerprint: "b".repeat(64),
      evaluation: {
        id: "evaluation-forged",
        verdict: "improved",
        evaluated_at: "2026-07-31T12:05:00.000Z",
        classifications: [],
        analysis: null,
      },
    });
    const shown = await runLearn(["show", activeId]);
    expect(dispositionOf(shown.out)).toContain("claim authorized (unproven)");
    expect(dispositionOf(shown.out)).not.toContain("claim validated");
    const report = await runLearn(["report", "--json"]);
    expect(report.out).toContain(`"intervention_id": "${activeId}"`);
    const planted = await runLearn(["show", "exp_a_forged"]);
    expect(planted.out).toContain("improved"); // the audit copy is readable…
    expect(dispositionOf(shown.out)).toContain("validation untested"); // …but the kernel state is untouched
    await writeFile(join(world.learning.stateDir, "host", "experiments", "exp_a_forged.json"), "", "utf8");
  });
});
