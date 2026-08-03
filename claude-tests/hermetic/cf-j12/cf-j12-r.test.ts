// CF-J12-R — refusal legs (L1 guardrail + L2 composition, risk E1, control
// point T-10; case-catalog.md; contracts/B-11-learning-publisher.md §1;
// INV-012 adversarial seed (c)):
//
//   1. agent write to a protected learning surface classifies critical and
//      the default gate denies-and-escalates (`learning-surface-tamper`,
//      src/runtime/gate.ts) — while candidates/ and proposals/ stay agent-
//      writable (agents propose only, they never touch governed surfaces);
//   2. a candidate placed to be directly resolvable NEVER resolves: the
//      resolver reads only bundle/<scope> and quarantine/, and a candidate-
//      status file smuggled into bundle/ is rejected by the placement
//      detector instead of entering context.
//
// The gate legs are L1 (pure classifier + default policy over real product
// rules); the resolver legs are L2 on a temp org home. Both live here because
// the family owns the refusal direction end to end.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, defaultGate } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";
import { openCandidateArtifact } from "../../../src/org/learning/candidate-store.js";
import { bundleDir, loadConceptDir, quarantineDir } from "../../../src/org/learning/concepts.js";
import { resolveLearningContext } from "../../../src/org/learning/resolver.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import {
  candidateSpec,
  conceptDraftMarkdown,
  makeLearningWorld,
  type LearningWorld,
} from "./learning-seams.js";

// ---------------------------------------------------------------------------
// L1 — the tamper gate (guardrails enforce; evals never do)
// ---------------------------------------------------------------------------

/** Every gate-protected learning surface, in both roots' shapes: the org
 *  home's learning/** and an app repo's .cormidia/learning/**. */
const PROTECTED_WRITES: Array<{ label: string; path: string }> = [
  { label: "org bundle concept", path: "/tmp/org-home/learning/bundle/org/lesson.md" },
  { label: "org quarantine", path: "/tmp/org-home/learning/quarantine/urgent.md" },
  { label: "org evals", path: "/tmp/org-home/learning/evals/org/set/case.json" },
  { label: "org reviews", path: "/tmp/org-home/learning/reviews/cand_x.json" },
  { label: "org experiments", path: "/tmp/org-home/learning/experiments/exp_x.json" },
  { label: "org interventions", path: "/tmp/org-home/learning/interventions/int_x.json" },
  { label: "org manifest", path: "/tmp/org-home/learning/manifest.yaml" },
  { label: "org policy", path: "/tmp/org-home/learning/policy.yaml" },
  { label: "org rejection ledger", path: "/tmp/org-home/learning/rejections.jsonl" },
  { label: "app-repo bundle concept", path: "/tmp/app/.cormidia/learning/bundle/apps/app/lesson.md" },
  { label: "app-repo manifest", path: "/tmp/app/.cormidia/learning/manifest.yaml" },
];

const AGENT_WRITABLE: Array<{ label: string; path: string }> = [
  { label: "candidate JSON", path: "/tmp/org-home/learning/candidates/cand_x.json" },
  { label: "candidate concept draft", path: "/tmp/org-home/learning/candidates/cand_x.md" },
  { label: "proposal draft", path: "/tmp/org-home/learning/proposals/skills/cand_x.md" },
];

const writeAction = (path: string): ToolAction => ({
  tool: "write",
  input: { file_path: path, content: "attacker bytes" },
});
const shellAppend = (path: string): ToolAction => ({
  tool: "bash",
  input: { command: `echo pwned >> ${path}` },
});

describe("CF-J12-R — L1 tamper gate on the learning governance surfaces (T-10)", () => {
  it("negative control: a seeded agent write to EVERY protected surface fires learning-surface-tamper (write tool and shell alike)", () => {
    for (const target of PROTECTED_WRITES) {
      for (const action of [writeAction(target.path), shellAppend(target.path)]) {
        const verdict = classify(action);
        expect(verdict, `${target.label} via ${action.tool}`).toEqual({
          cls: "critical",
          rule: "learning-surface-tamper",
        });
      }
    }
  });

  it("the default gate denies-and-escalates the tamper write — fail closed, never allow-with-warning", () => {
    const decision = defaultGate(writeAction(PROTECTED_WRITES[0]!.path));
    expect(decision.allow).toBe(false);
    if (decision.allow === false) {
      expect(decision.escalate).toBe(true);
      expect(decision.reason).toContain("learning-surface-tamper");
    }
  });

  it("agents still propose freely: candidates/ and proposals/ writes classify routine (B-11 §1 valid inputs)", () => {
    for (const target of AGENT_WRITABLE) {
      expect(classify(writeAction(target.path)), target.label).toEqual({ cls: "routine" });
      expect(classify(shellAppend(target.path)), target.label).toEqual({ cls: "routine" });
    }
  });

  it("reads of protected surfaces stay routine — the gate guards writes, not visibility", () => {
    expect(
      classify({ tool: "bash", input: { command: "cat /tmp/org-home/learning/manifest.yaml" } }),
    ).toEqual({ cls: "routine" });
  });
});

// ---------------------------------------------------------------------------
// L2 — a candidate placed to be directly resolvable never resolves
// ---------------------------------------------------------------------------

describe("CF-J12-R — candidates never resolve (L2, INV-012 seed (c))", () => {
  let world: LearningWorld;

  beforeAll(async () => {
    world = await makeLearningWorld("cf-j12-r");
    // A legitimate candidate pair in the agent-writable store.
    await openCandidateArtifact(
      world.orgRoot,
      candidateSpec({ id: "cand_j12r_honest" }),
      conceptDraftMarkdown({ conceptId: "lrn_j12r_honest", name: "j12r-honest" }),
    );
  });

  afterAll(async () => {
    await world.cleanup();
  });

  const resolve = async (turn: string) =>
    resolveLearningContext({
      orgHome: world.org.orgHome,
      app: "fixture-app",
      role: "builder",
      turnId: turn,
      episodeId: `ep_${turn}`,
      taskText: "any task at all",
      policy: world.policy,
      // dry resolve — the refusal direction needs no persisted record.
    });

  it("a candidate sitting in candidates/ contributes nothing to any resolve — structurally outside every resolvable path (B-11 §2)", async () => {
    // Guard against green-by-absence: the candidate files really are there.
    await assertNonEmptyWalk(join(world.org.orgHome, "learning", "candidates"), /cand_j12r_honest/);
    const resolved = await resolve("turn_j12r_structural");
    expect(resolved.concept_ids).toEqual([]);
    expect(resolved.sections).toEqual([]);
  });

  it("negative control: a candidate-status file SMUGGLED into bundle/org is refused by the placement detector and never resolves", async () => {
    // Seed the violation: the file an attacker (or a half-completed move)
    // would leave — loop.status "candidate" physically inside bundle/org/.
    const dir = join(bundleDir(world.orgRoot), "org");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "smuggled.md"),
      conceptDraftMarkdown({ conceptId: "lrn_j12r_smuggled", name: "smuggled" }),
      "utf8",
    );

    // The detector fires: strict placement loading rejects the file.
    await expect(loadConceptDir(dir, "bundle")).rejects.toThrow(/cannot live in bundle/);

    // And the resolver (skip-warn mode) degrades it instead of resolving it.
    const resolved = await resolve("turn_j12r_smuggled");
    expect(resolved.concept_ids).not.toContain("lrn_j12r_smuggled");
    expect(resolved.concept_ids).toEqual([]);
  });

  it('an "active"-flagged doc left in candidates/ still never resolves — the resolver does not read the candidate store at all', async () => {
    const path = join(world.org.orgHome, "learning", "candidates", "flipped-status.md");
    await writeFile(
      path,
      conceptDraftMarkdown({ conceptId: "lrn_j12r_flipped", name: "flipped-status", status: "active" }),
      "utf8",
    );
    const resolved = await resolve("turn_j12r_flipped");
    expect(resolved.concept_ids).not.toContain("lrn_j12r_flipped");
  });

  it("negative control: an agent-shaped provisional (no human author) planted in quarantine/ is refused by the placement detector and never resolves", async () => {
    const dir = quarantineDir(world.orgRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(
      dir + "/agent-provisional.md",
      conceptDraftMarkdown({
        conceptId: "lrn_j12r_agent_prov",
        name: "agent-provisional",
        status: "provisional",
        ttlDays: 7,
        // no loop.author — quarantine is the human urgent lane (design §7)
      }),
      "utf8",
    );
    await expect(loadConceptDir(dir, "quarantine")).rejects.toThrow(/human author/);
    const resolved = await resolve("turn_j12r_quarantine");
    expect(resolved.concept_ids).not.toContain("lrn_j12r_agent_prov");
  });
});
