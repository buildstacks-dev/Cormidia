// CF-J12-K (L2, state+refusal): the J-12 learning pipeline on the kernel path
// — evidence → inert candidate → independent review → bound plan → approval
// in the EXISTING approvals store → exactly-once publish into the OKF bundle
// with a manifest cut → receipt-frozen context resolution → acknowledged
// exposure. Every learning state stays an explicit recorded fact (INV-012):
// a pending or denied approval, or an approval bound to different bytes,
// produces no write. The kernel's own records stay under
// `<state>/learning-loop/`; the only org-home writes are the concept and the
// manifest (B-32 confinement), proven with a seeded stray write as the
// negative control.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizationBindingDigest } from "@cormidia/learning-loop";
import type { AuthorizationBinding, JsonValue, PreparedPublication, PublicationOutcome } from "@cormidia/learning-loop";
import { createSequentialIds } from "@cormidia/learning-loop/testing";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { LEARNING_LOOP_PUBLISH_TOOL, raiseLearningLoopPublish } from "../../../src/org/learning-loop/authority.js";
import { createCormidiaLearningLoop, type CormidiaLearningLoop } from "../../../src/org/learning-loop/loop.js";
import { rolePrincipalEvidence } from "../../../src/org/learning-loop/identity.js";
import { scopeFromLoopScope } from "../../../src/org/learning-loop/scope.js";
import { appLearningRoot, readManifest } from "../../../src/org/learning/concepts.js";
import { defaultLearningPolicy } from "../../../src/org/learning/policy.js";
import { parseOkfDocument, serializeOkfDocument } from "../../../src/org/memory.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { walkFiles } from "../../fixtures/walk.js";

const ORG = "acme";

function markdownOf(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const markdown: unknown = Reflect.get(value, "markdown");
  return typeof markdown === "string" ? markdown : undefined;
}

function conceptDraft(conceptId: string, name: string): string {
  return serializeOkfDocument({
    frontmatter: {
      name,
      description: `learning concept ${name}`,
      type: "lesson",
      keywords: ["typecheck"],
      evidence: [],
      status: "active",
      created: "2026-08-21",
      updated: "2026-08-21",
      loop: { id: conceptId, tier: "T1", status: "candidate", scope: "apps/web", version: 1, claim: "authorized" },
    },
    body: `Run the repository type-check before reporting completion (${name}).\n`,
  });
}

function episodeRecord(episodeId: string, ticket: string): Record<string, unknown> {
  return {
    schema_version: 1,
    episode_id: episodeId,
    kind: "build_ticket",
    app: "web",
    source: { kind: "github_issue", ref: ticket },
    stage: null,
    risk_tier: null,
    opened: "2026-08-20T09:00:00.000Z",
    closed: "2026-08-20T10:00:00.000Z",
    status: "closed",
    fingerprint_ref: null,
    bundle_lineage: null,
    turns: [],
    gates: [
      { gate: "typecheck", status: "fail", run_id: "run-1" },
      { gate: "typecheck", status: "pass", run_id: "run-2" },
    ],
    approvals: [],
    artifacts: [],
    side_effects: [],
    outcome: {
      completed: true,
      merged: true,
      release_disposition: "merged",
      review_cycles: 2,
      gate_failures: 1,
      human_interventions: 1,
      cost_usd: 1.25,
      cost_estimated: false,
      unsettled_runs: [],
      terminal_reason: "completed",
    },
    late_outcomes: [{ kind: "revert", ref: "pr-7", recorded: "2026-08-21T08:00:00.000Z" }],
    human_observations: [],
  };
}

interface World {
  org: TempOrgHome;
  state: TempStateHome;
  /** The registered app's checkout: its `.cormidia/learning` is the destination root. */
  appWorkdir: string;
  clock: TestClock;
  approvals: ApprovalStore;
  learning: CormidiaLearningLoop;
  baseline: string[];
}

async function seedEpisode(state: TempStateHome, episodeId: string, ticket: string): Promise<void> {
  await mkdir(state.path("learning", "episodes"), { recursive: true });
  await writeFile(
    state.path("learning", "episodes", `${episodeId}.json`),
    `${JSON.stringify(episodeRecord(episodeId, ticket), null, 2)}\n`,
  );
}

async function makeWorld(): Promise<World> {
  const org = await makeTempOrgHome({ name: ORG });
  const state = await makeTempStateHome({ name: ORG });
  const clock = makeTestClock("2026-08-21T12:00:00.000Z");
  const approvals = new ApprovalStore(state.stateHome, { now: clock.dateFn });
  const appWorkdir = join(org.root, "apps", "web");
  await mkdir(appWorkdir, { recursive: true });
  const learning = createCormidiaLearningLoop({
    orgHome: org.orgHome,
    stateHome: state.stateHome,
    org: ORG,
    approvals,
    policy: defaultLearningPolicy(),
    apps: [{ name: "web", workdir: appWorkdir }],
    clock: { now: () => clock.nowIso() },
    ids: createSequentialIds("j12k"),
  });
  const baseline = await walkFiles(org.orgHome);
  return { org, state, appWorkdir, clock, approvals, learning, baseline };
}

/** B-32 confinement detector: every org-home file the journey added must be
 *  in the allow-list; every kernel record must live under `<state>/learning-loop`. */
async function assertKernelConfined(world: World, allowedAppRelative: readonly string[]): Promise<void> {
  // walkFiles yields paths relative to the walked root.
  const orgAdded = (await walkFiles(world.org.orgHome)).filter((path) => !world.baseline.includes(path));
  if (orgAdded.length > 0) throw new Error(`kernel path wrote into the org home: ${orgAdded.join(", ")}`);
  const appFiles = await walkFiles(world.appWorkdir);
  const stray = appFiles.filter((path) => !allowedAppRelative.includes(path));
  if (stray.length > 0)
    throw new Error(`kernel path wrote outside its allow-list in the app checkout: ${stray.join(", ")}`);
  const kernelFiles = await walkFiles(world.learning.stateDir);
  if (kernelFiles.length === 0) throw new Error("kernel state directory is empty — no durable records were written");
}

async function prepareCandidate(
  world: World,
  candidateId: string,
  conceptId: string,
  name: string,
  evidenceIds: readonly string[],
): Promise<PreparedPublication> {
  const { loop, identity, destinations } = world.learning;
  const proposer = await identity.verify(rolePrincipalEvidence("distiller", "codex"));
  const reviewer = await identity.verify(rolePrincipalEvidence("learning-reviewer", "claude"));
  const proposed = await loop.propose({
    id: candidateId,
    scope: scopeFromLoopScope(ORG, "apps/web"),
    problem: "agents report completion before the type-check runs",
    hypothesis: "a standing instruction to type-check before done reduces review cycles",
    evidenceIds,
    intervention: {
      destinationId: destinations.apps["web"] ?? "",
      kind: "okf_concept",
      content: { markdown: conceptDraft(conceptId, name) },
      rollbackIntent: "disable the activated concept version",
    },
    proposedRisk: "T1",
    proposedBy: proposer,
  });
  await loop.reviewCandidate({
    id: `review-${candidateId}`,
    candidateId: proposed.candidate.id,
    reviewer: {
      id: "learning-reviewer",
      version: "1.0.0",
      principal: reviewer,
      review: (input) =>
        Promise.resolve({
          candidateId: input.candidate.id,
          candidateDigest: input.candidate.contentDigest,
          disposition: "accept",
          findings: [],
        }),
    },
  });
  return loop.preparePublication({ candidateId: proposed.candidate.id, destinationId: destinations.apps["web"] ?? "" });
}

function tampered(binding: AuthorizationBinding): AuthorizationBinding {
  return { ...binding, planDigest: binding.planDigest.split("").reverse().join("") };
}

describe("CF-J12-K learning pipeline on the kernel path", () => {
  let world: World;
  let observationIds: readonly string[];
  let evidenceIds: readonly string[];
  const conceptPath = join(".cormidia", "learning", "bundle", "apps", "web", "typecheck-before-done.md");
  const manifestPath = join(".cormidia", "learning", "manifest.yaml");

  beforeAll(async () => {
    world = await makeWorld();
    await seedEpisode(world.state, "ep_web_ticket_0042", "web#42");
    await seedEpisode(world.state, "ep_web_ticket_0043", "web#43");
  });
  afterAll(async () => {
    await world.org.cleanup();
    await world.state.cleanup();
  });

  it("ingests projected episodes as observed evidence with measurements bound to the outcome observation", async () => {
    const receipt = await world.learning.loop.ingest(world.learning.episodes, {
      stateHome: world.state.stateHome,
      org: ORG,
    });
    expect(receipt.completeness).toBe("complete");
    expect(receipt.episodeIds).toEqual([
      "cormidia-episodes/episode:ep_web_ticket_0042",
      "cormidia-episodes/episode:ep_web_ticket_0043",
    ]);
    expect(receipt.observationIds.length).toBeGreaterThanOrEqual(8);
    expect(receipt.measurementIds.length).toBe(10);
    observationIds = receipt.observationIds;
    evidenceIds = observationIds.filter((id) => id.includes("ep_web_ticket_0042")).slice(0, 2);
  });

  it("a pending approval publishes nothing; an approved one writes the concept and cuts one manifest version", async () => {
    const prepared = await prepareCandidate(
      world,
      "cand-typecheck",
      "lesson-typecheck",
      "typecheck-before-done",
      evidenceIds,
    );
    expect(prepared.plan.candidateId).toBe("cand-typecheck");
    const orgHome = world.appWorkdir;
    const root = appLearningRoot(orgHome);

    const unauthorized = await world.learning.loop.publish({ planId: prepared.plan.id });
    expect(unauthorized.status).not.toBe("published");
    expect(existsSync(join(orgHome, conceptPath))).toBe(false);

    const item = await raiseLearningLoopPublish(world.approvals, {
      app: "web",
      plan: prepared.plan,
      binding: prepared.authorizationBinding,
      now: world.clock.nowDate(),
    });
    expect(item.action.tool).toBe(LEARNING_LOOP_PUBLISH_TOOL);
    const again = await raiseLearningLoopPublish(world.approvals, {
      app: "web",
      plan: prepared.plan,
      binding: prepared.authorizationBinding,
    });
    expect(again.id).toBe(item.id);

    const pending = await world.learning.loop.publish({
      planId: prepared.plan.id,
      authorizationEvidence: { approvalId: item.id },
    });
    expect(pending.status).toBe("pending");
    expect(existsSync(join(orgHome, conceptPath))).toBe(false);
    expect(await readManifest(root)).toBeNull();

    await world.approvals.decide(item.id, { decision: "approved", now: world.clock.nowDate() });
    const published: PublicationOutcome = await world.learning.loop.publish({
      planId: prepared.plan.id,
      authorizationEvidence: { approvalId: item.id },
    });
    expect(published.status).toBe("published");
    if (published.status !== "published") return;
    const [receipt] = published.receipts;
    expect(receipt).toBeDefined();
    if (receipt === undefined) return;
    const concept = parseOkfDocument(await readFile(join(orgHome, conceptPath), "utf8"), conceptPath);
    expect(concept.frontmatter.loop?.status).toBe("active");
    expect(concept.frontmatter.loop?.id).toBe("lesson-typecheck");
    const manifest = await readManifest(root);
    expect(manifest?.bundle_version).toBe(receipt.finalVersion);
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]?.approval_ref).toBe(receipt.idempotencyKey);
    expect(manifest?.history[0]?.concepts).toEqual(["lesson-typecheck"]);

    const replay = await world.learning.loop.publish({
      planId: prepared.plan.id,
      authorizationEvidence: { approvalId: item.id },
    });
    expect(["no_op", "resumed"]).toContain(replay.status);
    expect((await readManifest(root))?.history).toHaveLength(1);
  });

  it("resolves the published concept for a future episode and acknowledges one exposure set", async () => {
    const scope = scopeFromLoopScope(ORG, "apps/web");
    const resolved = await world.learning.loop.resolveContext({
      episodeId: "ep_web_ticket_0043",
      scope,
      query: { role: "builder" },
      budget: { maximumEntries: 4, maximumCharacters: 20_000 },
    });
    expect(resolved.entries).toHaveLength(1);
    const entry = resolved.entries[0];
    expect(entry?.candidateId).toBe("cand-typecheck");
    expect(markdownOf(entry?.content)).toContain("typecheck-before-done");
    const exposure = await world.learning.loop.acknowledgeExposure({
      resolutionReceiptId: resolved.id,
      appliedEntryIds: resolved.entries.map((applied) => applied.id),
      assignmentId: "stable",
      fingerprintId: "sys_0123456789ab",
      evidenceIds: observationIds.filter((id) => id.includes("ep_web_ticket_0043")).slice(0, 1),
    });
    expect(exposure.entries).toHaveLength(1);
  });

  it("a denied approval and an approval bound to different bytes both refuse without a write", async () => {
    const orgHome = world.appWorkdir;
    const root = appLearningRoot(orgHome);
    const bundle = join(orgHome, ".cormidia", "learning", "bundle", "apps", "web");
    const denied = await prepareCandidate(world, "cand-denied", "lesson-denied", "denied-concept", evidenceIds);
    const deniedItem = await raiseLearningLoopPublish(world.approvals, {
      app: "web",
      plan: denied.plan,
      binding: denied.authorizationBinding,
    });
    await world.approvals.decide(deniedItem.id, {
      decision: "denied",
      reason: "not grounded",
      now: world.clock.nowDate(),
    });
    const deniedOutcome = await world.learning.loop.publish({
      planId: denied.plan.id,
      authorizationEvidence: { approvalId: deniedItem.id },
    });
    expect(deniedOutcome.status).toBe("denied");
    expect(existsSync(join(bundle, "denied-concept.md"))).toBe(false);

    const mismatched = await prepareCandidate(
      world,
      "cand-mismatch",
      "lesson-mismatch",
      "mismatch-concept",
      evidenceIds,
    );
    const wrongItem = await raiseLearningLoopPublish(world.approvals, {
      app: "web",
      plan: mismatched.plan,
      binding: tampered(mismatched.authorizationBinding),
    });
    await world.approvals.decide(wrongItem.id, { decision: "approved", now: world.clock.nowDate() });
    expect(authorizationBindingDigest(tampered(mismatched.authorizationBinding))).not.toBe(
      authorizationBindingDigest(mismatched.authorizationBinding),
    );
    const refused = await world.learning.loop.publish({
      planId: mismatched.plan.id,
      authorizationEvidence: { approvalId: wrongItem.id },
    });
    expect(refused.status).not.toBe("published");
    expect(existsSync(join(bundle, "mismatch-concept.md"))).toBe(false);
    expect((await readManifest(root))?.history).toHaveLength(1);
  });

  it("B-32 confinement: the kernel wrote only its state directory plus the concept and manifest", async () => {
    await assertKernelConfined(world, [conceptPath, manifestPath]);
  });

  it("negative control: a seeded stray write under the org-home learning tree makes the confinement detector fire", async () => {
    const stray = join(world.appWorkdir, ".cormidia", "learning", "bundle", "apps", "web", "stray.md");
    await writeFile(stray, "planted\n");
    await expect(assertKernelConfined(world, [conceptPath, manifestPath])).rejects.toThrow(/stray\.md/);
  });
});
