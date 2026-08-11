// Traceability: CF-J12-A · HB-017; CF-C-B11 · HB-017 · contracts/journey-acceptance.md J-12 alternative-surface criterion; contracts/B-11-learning-publisher.md.

// CF-J12-A — the five learning states (candidate / published / authorized /
// active / validated) render DISTINCTLY on the learn/report surfaces (L2
// evid, risk E3; case-catalog.md; INV-012 falsifying shape: "authorized"
// surfaced as "validated"; B-11 §2 output guarantee: the states are separate
// recorded facts).
//
// Surface under test: the REAL `cormidia learn` CLI (cmdLearn, src/cli/
// learn.ts) run in-process against the temp homes via its --org-home/
// --state-home flags, output captured from the console seam. Nothing is
// mocked below the CLI: the same readers, validators, and claimLabel
// rendering production uses.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cmdLearn } from "../../../src/cli/learn.js";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { writeInterventionRecord } from "../../../src/org/learning/intervention.js";
import { publishCandidate } from "../../../src/org/learning/publisher.js";
import { writeReviewerVerdict } from "../../../src/org/learning/review.js";
import { sha256Ref } from "../../../src/org/learning/candidate-store.js";
import {
  candidateSpec,
  makeLearningWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  verdictSpec,
  type LearningWorld,
} from "./learning-seams.js";

describe("CF-J12-A — candidate/published/authorized/active/validated render distinctly on learn/report surfaces (L2 evid, E3)", () => {
  let world: LearningWorld;
  let flags: string[];

  /** Run the real CLI in-process, capturing both console streams. */
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
    world = await makeLearningWorld("cf-j12-a");
    flags = ["--org-home", world.org.orgHome, "--state-home", world.state.stateHome];

    // State 1 — candidate awaiting review (fails closed).
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_awaiting", destination: "skill_draft" }));

    // State 2 — reviewed, not yet published.
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_reviewed", destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: "cand_a_reviewed", destination: "skill_draft" }));

    // State 3 — published (routine proposal draft; activation is a SEPARATE
    // fact this record does not carry).
    await openCandidateArtifact(world.orgRoot, candidateSpec({ id: "cand_a_published", destination: "skill_draft" }));
    await writeReviewerVerdict(world.org.orgHome, verdictSpec({ id: "cand_a_published", destination: "skill_draft" }));
    const routine = await publishCandidate(world.deps, "cand_a_published");
    if (routine.status !== "published") {
      throw new Error(`routine publish failed: ${JSON.stringify(routine)}`);
    }

    // State 4 — active with claim AUTHORIZED (human-gated activation).
    await seedReviewedOkfCandidate(world, {
      id: "cand_a_active",
      conceptId: "lrn_a_active",
      name: "a-active-lesson",
    });
    await raiseAndApprove(world, "cand_a_active");
    const activated = await publishCandidate(world.deps, "cand_a_active");
    if (activated.status !== "published") {
      throw new Error(`gated publish failed: ${JSON.stringify(activated)}`);
    }

    // State 5 — VALIDATED: only representable with the completed experiment
    // lineage attached (this record models the downstream eval having
    // decided `improved` — the one legal upgrade path, design §9.1).
    await writeInterventionRecord(world.org.orgHome, {
      schema_version: 1,
      intervention_id: "int_a_validated",
      candidate_ref: "cand_a_validated",
      destination: "okf_concept",
      reviewed_content_hash: sha256Ref("validated-content"),
      approval_ref: "appr-validated",
      publish: {
        kind: "bundle_version",
        ref: "org@2026.07.30-1",
        commit: null,
        published_at: "2026-07-30T00:00:00.000Z",
      },
      activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "validated" },
      affected_episodes: { query: "bundle_versions.org >= 2026.07.30-1" },
      experiment_ref: "exp_a_validated",
      outcome_ref: "eval_a_validated",
      rollback: null,
      status: "active",
    });
  });

  afterAll(async () => {
    await world.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("learn show renders all five states as pairwise-distinct dispositions", async () => {
    const awaiting = await runLearn(["show", "cand_a_awaiting"]);
    const reviewed = await runLearn(["show", "cand_a_reviewed"]);
    const published = await runLearn(["show", "int_a_published"]);
    const active = await runLearn(["show", "int_a_active"]);
    const validated = await runLearn(["show", "int_a_validated"]);
    for (const result of [awaiting, reviewed, published, active, validated]) {
      expect(result.code).toBe(0);
    }

    const dispositions = [
      dispositionOf(awaiting.out),
      dispositionOf(reviewed.out),
      dispositionOf(published.out),
      dispositionOf(active.out),
      dispositionOf(validated.out),
    ];
    // Every state names itself...
    expect(dispositions[0]).toContain("awaiting review");
    expect(dispositions[1]).toContain("reviewed, not yet published");
    expect(dispositions[2]).toContain("published");
    expect(dispositions[3]).toContain("active");
    expect(dispositions[4]).toContain("active");
    // ...and no two states share a rendering (distinct recorded facts).
    expect(new Set(dispositions).size).toBe(dispositions.length);
  });

  it('authorized renders as "authorized (unproven)" and NEVER as validated (INV-012)', async () => {
    const active = await runLearn(["show", "int_a_active"]);
    const disposition = dispositionOf(active.out);
    expect(disposition).toContain("claim authorized (unproven)");
    expect(disposition).not.toContain("validated");
  });

  it("a published-but-not-activated record carries NO claim — published does not imply authorized/active", async () => {
    const published = await runLearn(["show", "int_a_published"]);
    const disposition = dispositionOf(published.out);
    expect(disposition).toContain("published skill_draft");
    expect(disposition).not.toContain("claim");
  });

  it('validated renders as "claim validated" only on the record carrying the completed experiment lineage', async () => {
    const validated = await runLearn(["show", "int_a_validated"]);
    expect(dispositionOf(validated.out)).toContain("claim validated");
  });

  it("learn report --json keeps claim and claim_display distinct per intervention — authorized never blends into validated", async () => {
    const report = await runLearn(["report", "--json"]);
    expect(report.code).toBe(0);
    const parsed = JSON.parse(report.out) as {
      interventions: Array<{
        intervention_id: string;
        status: string;
        claim: string | null;
        claim_display?: string;
      }>;
      reviews: Array<{ candidate_id: string }>;
    };
    const byId = new Map(parsed.interventions.map((entry) => [entry.intervention_id, entry]));
    expect(byId.get("int_a_published")?.claim).toBeNull();
    expect(byId.get("int_a_published")?.claim_display).toBeUndefined();
    expect(byId.get("int_a_active")?.claim).toBe("authorized");
    expect(byId.get("int_a_active")?.claim_display).toBe("authorized (unproven)");
    expect(byId.get("int_a_validated")?.claim).toBe("validated");
    expect(byId.get("int_a_validated")?.claim_display).toBe("validated");
    // The still-unpublished states appear on the review surface, not as
    // interventions — candidate-ness is not an intervention status.
    expect(byId.has("int_a_awaiting")).toBe(false);
    expect(parsed.reviews.some((entry) => entry.candidate_id === "cand_a_reviewed")).toBe(true);
  });

  it("negative control: a forged validated record without its experiment lineage cannot render at all — the reader validator fires and the surface errors", async () => {
    // Seed the violation BELOW the writer (writeInterventionRecord would
    // refuse it): plant the forged file directly, as a tampering process
    // would, then ask the surface to render it.
    const forged = {
      schema_version: 1,
      intervention_id: "int_a_forged",
      candidate_ref: "cand_a_forged",
      destination: "okf_concept",
      reviewed_content_hash: sha256Ref("forged"),
      approval_ref: null,
      publish: {
        kind: "bundle_version",
        ref: "org@2026.07.30-2",
        commit: null,
        published_at: "2026-07-30T00:00:00.000Z",
      },
      activation: { activated_at: "2026-07-30T00:00:00.000Z", claim: "validated" },
      affected_episodes: null,
      experiment_ref: null,
      outcome_ref: null,
      rollback: null,
      status: "active",
    };
    const dir = join(world.org.orgHome, "learning", "interventions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "int_a_forged.json"), JSON.stringify(forged, null, 2) + "\n", "utf8");

    const shown = await runLearn(["show", "int_a_forged"]);
    expect(shown.code).toBe(1);
    expect(shown.err).toContain("validated");
    expect(shown.err).toContain("experiment");
    expect(shown.out).not.toContain("claim validated");

    // Clean up so the forged file cannot leak into other renders.
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "int_a_forged.json"));
  });
});
