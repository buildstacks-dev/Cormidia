// CF-B32 (L2, state+refusal+evid): the declared failure modes of the
// Cormidia-adapters ↔ kernel boundary, each scripted on real temp homes —
// crash between the manifest cut and the receipt (forward-completes, no
// second cut), base drift under an approved plan (typed refusal, no write),
// a tampered receipt under a reused key (typed refusal), an active canary on
// the destination root (typed busy refusal before any write), a corrupt
// projected episode (closed evidence health, never an empty success), and an
// approval item that is not a learning-loop publish or binds different bytes
// (closed invalid decision, never a handle).
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { authorizationBindingDigest, candidateContentDigest, parseCandidate } from "@cormidia/learning-loop";
import type { AuthorizationBinding, Candidate, PreparedEffect, PublicationDestination } from "@cormidia/learning-loop";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { createCormidiaAuthorityPort, LEARNING_LOOP_PUBLISH_TOOL } from "../../../src/org/learning-loop/authority.js";
import { createOkfConceptDestination, UNVERSIONED_BASE } from "../../../src/org/learning-loop/destination-okf.js";
import { createEpisodeEvidenceSource } from "../../../src/org/learning-loop/evidence-source.js";
import { learningLoopStateDir } from "../../../src/org/learning-loop/loop.js";
import { orgLearningRoot, readManifest } from "../../../src/org/learning/concepts.js";
import { makeTestClock } from "../../fixtures/clock.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

interface DestinationWorld {
  root: string;
  orgHome: string;
  stateHome: string;
  receiptsDir: string;
  destination: PublicationDestination;
}

async function makeDestinationWorld(): Promise<DestinationWorld> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-b32-modes-"));
  roots.push(root);
  const orgHome = join(root, "org-home");
  const stateHome = join(root, "state-home");
  const receiptsDir = join(learningLoopStateDir(stateHome), "receipts", "okf-concept-org");
  const clock = makeTestClock("2026-08-21T12:00:00.000Z");
  const destination = createOkfConceptDestination({
    id: "okf-concept:org",
    root: orgLearningRoot(orgHome),
    receiptsDir,
    defaultScope: "org",
    clock: { now: () => clock.nowIso() },
  });
  return { root, orgHome, stateHome, receiptsDir, destination };
}

/** A synthetic legacy (v1) candidate — the shape the kernel's own conformance suite uses. */
function candidate(id: string, text: string): Candidate {
  const bound = {
    scope: [{ type: "org", id: "acme" }],
    problem: "problem",
    hypothesis: "hypothesis",
    evidenceIds: ["cormidia-episodes/gate:ep_web_ticket_0042:0"],
    intervention: {
      destinationId: "okf-concept:org",
      kind: "okf_concept",
      content: { text },
      rollbackIntent: "disable",
    },
    proposedRisk: "T1" as const,
  };
  return parseCandidate({
    ...bound,
    schemaVersion: 1,
    id,
    proposedBy: { id: "role:distiller", kind: "agent", independenceDomain: "runtime:codex" },
    proposerAttestationDigest: "c".repeat(64),
    proposedAt: "2026-08-21T12:00:00.000Z",
    contentDigest: candidateContentDigest(bound),
  });
}

async function firstEffect(
  destination: PublicationDestination,
  subject: Candidate,
  expectedBase?: string,
): Promise<PreparedEffect> {
  const [effect] = await destination.prepare({
    candidate: subject,
    ...(expectedBase !== undefined ? { expectedBase } : {}),
  });
  if (effect === undefined) throw new Error("prepare returned no effect");
  return effect;
}

async function rejectsWith(code: string, run: () => Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  if (thrown === null || typeof thrown !== "object" || Reflect.get(thrown, "code") !== code) {
    throw new Error(`expected a ${code} refusal, got ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
}

describe("CF-B32 destination failure modes on the OKF concept bundle", () => {
  it("forward-completes a crash between the manifest cut and the receipt without a second cut", async () => {
    const world = await makeDestinationWorld();
    const effect = await firstEffect(world.destination, candidate("cand-crash", "Type-check before done."));
    expect(effect.expectedBase).toBe(UNVERSIONED_BASE);
    const first = await world.destination.applyEffect({ effect, idempotencyKey: "key-crash" });
    const receipts = await readdir(world.receiptsDir);
    expect(receipts).toHaveLength(1);
    await unlink(join(world.receiptsDir, receipts[0] ?? ""));
    const resumed = await world.destination.applyEffect({ effect, idempotencyKey: "key-crash" });
    expect(resumed.finalVersion).toBe(first.finalVersion);
    const manifest = await readManifest(orgLearningRoot(world.orgHome));
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]?.approval_ref).toBe("key-crash");
  });

  it("refuses an approved plan whose base moved, and an activation over different bytes, without writing", async () => {
    const world = await makeDestinationWorld();
    const stale = await firstEffect(world.destination, candidate("cand-stale", "First lesson."));
    await world.destination.applyEffect({ effect: stale, idempotencyKey: "key-1" });
    const drifted = await firstEffect(world.destination, candidate("cand-drift", "Second lesson."), UNVERSIONED_BASE);
    await rejectsWith("publication.base_mismatch", () =>
      world.destination.applyEffect({ effect: drifted, idempotencyKey: "key-2" }),
    );
    expect(existsSync(join(world.orgHome, "learning", "bundle", "org", "cand-drift.md"))).toBe(false);
    expect((await readManifest(orgLearningRoot(world.orgHome)))?.history).toHaveLength(1);
  });

  it("negative control: a tampered receipt under a reused key is refused, never replayed as success", async () => {
    const world = await makeDestinationWorld();
    const effect = await firstEffect(world.destination, candidate("cand-tamper", "Lesson."));
    await world.destination.applyEffect({ effect, idempotencyKey: "key-tamper" });
    const [file] = await readdir(world.receiptsDir);
    const path = join(world.receiptsDir, file ?? "");
    const stored = JSON.parse(await readFile(path, "utf8"));
    stored.effectDigest = "0".repeat(64);
    await writeFile(path, JSON.stringify(stored));
    await rejectsWith("publication.receipt_mismatch", () =>
      world.destination.applyEffect({ effect, idempotencyKey: "key-tamper" }),
    );
  });

  it("refuses to cut while the destination root runs a canary, before any write", async () => {
    const world = await makeDestinationWorld();
    const root = orgLearningRoot(world.orgHome);
    await mkdir(root.dir, { recursive: true });
    await writeFile(
      join(root.dir, "manifest.yaml"),
      stringifyYaml({
        schema_version: 1,
        bundle_version: "2026.08.20-1",
        stable: "2026.08.20-1",
        canary: "2026.08.20-2",
        canary_meta: {
          version: "2026.08.20-2",
          started_at: "2026-08-20T00:00:00.000Z",
          window_hours: 24,
          fraction: 0.5,
          tier: "T1",
          intervention_ref: "int_x",
          concepts: ["trial"],
        },
        history: [],
      }),
    );
    const effect = await firstEffect(world.destination, candidate("cand-canary", "Lesson."));
    expect(effect.expectedBase).toBe("2026.08.20-1");
    await rejectsWith("publication.destination_busy", () =>
      world.destination.applyEffect({ effect, idempotencyKey: "key-canary" }),
    );
    expect(existsSync(join(world.orgHome, "learning", "bundle", "org", "cand-canary.md"))).toBe(false);
  });
});

describe("CF-B32 evidence failure modes on projected episodes", () => {
  it("negative control: a corrupt projected episode closes the page as evidence health, never an empty success", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-b32-evidence-"));
    roots.push(root);
    const stateHome = join(root, "state-home");
    await mkdir(join(stateHome, "learning", "episodes"), { recursive: true });
    await writeFile(
      join(stateHome, "learning", "episodes", "ep_web_ticket_0001.json"),
      '{"schema_version": 2, "episode_id": "x"}\n',
    );
    const source = createEpisodeEvidenceSource();
    const probe = await source.probe({ stateHome, org: "acme" });
    expect(probe.supported).toBe(true);
    const pages = [];
    for await (const page of source.read({ stateHome, org: "acme" })) pages.push(page);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.state.status).toBe("corrupt");
    expect(pages[0]?.episodes).toEqual([]);
    expect(pages[0]?.diagnostics.map((d) => d.code)).toEqual(["source.record_corrupt"]);
    const missing = await source.probe({ stateHome: join(root, "absent"), org: "acme" });
    expect(missing.supported).toBe(false);
  });
});

describe("CF-B32 authority failure modes on the approvals projection", () => {
  function binding(): AuthorizationBinding {
    return {
      planDigest: "a".repeat(64),
      candidateDigest: "b".repeat(64),
      destinationId: "okf-concept:org",
      effectClass: "context",
      effectiveRisk: "T1",
      action: "publish",
      expectedBases: [UNVERSIONED_BASE],
      policyDigest: "c".repeat(64),
      lineageClosureDigest: "d".repeat(64),
    };
  }

  it("negative control: a foreign approval item, an unknown id, and a different binding digest are closed invalid decisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-b32-authority-"));
    roots.push(root);
    const clock = makeTestClock("2026-08-21T12:00:00.000Z");
    const approvals = new ApprovalStore(join(root, "state-home"), { now: clock.dateFn });
    const port = createCormidiaAuthorityPort(approvals);
    const bound = binding();
    const foreign = await approvals.raise({
      app: "web",
      role: "builder",
      rule: "deploy",
      action: { tool: "bash", input: "deploy" },
    });
    await approvals.decide(foreign.id, { decision: "approved", now: clock.nowDate() });
    const other = await approvals.raise({
      app: "org",
      role: "learning",
      rule: "learning-loop-publish",
      action: {
        tool: LEARNING_LOOP_PUBLISH_TOOL,
        input: {
          kind: LEARNING_LOOP_PUBLISH_TOOL,
          version: 1,
          planId: "plan-x",
          bindingDigest: "e".repeat(64),
          binding: bound,
        },
      },
    });
    await approvals.decide(other.id, { decision: "approved", now: clock.nowDate() });
    expect("e".repeat(64)).not.toBe(authorizationBindingDigest(bound));
    expect(port.id).toBe("cormidia/approvals");
    const decisions = await Promise.all([
      port.verify({ evidence: { approvalId: foreign.id }, binding: bound }),
      port.verify({ evidence: { approvalId: "missing-approval" }, binding: bound }),
      port.verify({ evidence: { approvalId: other.id }, binding: bound }),
      port.verify({ evidence: "not-an-object", binding: bound }),
    ]);
    expect(decisions.map((decision) => decision.status)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
    const codes = decisions.flatMap((decision) =>
      decision.status === "authorized" ? [] : decision.diagnostics.map((d) => d.code),
    );
    expect(codes).toContain("authority.not_a_learning_loop_publish");
    expect(codes).toContain("authority.approval_unknown");
    expect(codes).toContain("publication.binding_mismatch");
    expect(codes).toContain("authority.evidence_invalid");

    const exact = await approvals.raise({
      app: "org",
      role: "learning",
      rule: "learning-loop-publish",
      action: {
        tool: LEARNING_LOOP_PUBLISH_TOOL,
        input: {
          kind: LEARNING_LOOP_PUBLISH_TOOL,
          version: 1,
          planId: "plan-x",
          bindingDigest: authorizationBindingDigest(bound),
          binding: bound,
        },
      },
    });
    expect((await port.verify({ evidence: { approvalId: exact.id }, binding: bound })).status).toBe("pending");
    await approvals.decide(exact.id, { decision: "denied", reason: "seeded denial", now: clock.nowDate() });
    expect((await port.verify({ evidence: { approvalId: exact.id }, binding: bound })).status).toBe("denied");
  });
});
