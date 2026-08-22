// CF-B32-PARITY (L2, state+evid): byte/state parity of the kernel path
// against the forked deterministic engine's captured org home
// (tests/fixtures/learning-parity/captured, recorded by the fork itself at
// commit ad3ba7db under a fixed clock — CAPTURE.md), per the compatibility
// policy (research/2026-08-21_learning-loop-migration-compatibility-policy.md
// §3): (a) the kernel path replaying the SAME inputs writes byte-identical
// activated concepts, proposal drafts, and rejection ledger entries, and
// manifest cuts identical except for the ruled `approval_ref` (kernel
// idempotency key) and note; (b) the post-cutover host resolver over the
// kernel-published roots pins the SAME resolved record, canary assignment,
// and concept_loaded events the fork pinned; (c) the captured ACTIVE
// artifacts — the fork's own bundle and manifest — resolve unchanged under
// the post-cutover reader (exact preservation); (d) the fork's binding
// artifacts (approval items, publish journals) read through the
// compatibility readers. The fixture's own integrity is pinned by digests.
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSequentialIds } from "@cormidia/learning-loop/testing";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { createCormidiaLearningLoop, type CormidiaLearningLoop } from "../../../src/org/learning-loop/loop.js";
import { legacyPublishBindingOf, readLegacyPublishJournal } from "../../../src/org/learning-loop/legacy.js";
import { listKernelInterventions } from "../../../src/org/learning-loop/interventions.js";
import { publishCandidate, type PublishDeps } from "../../../src/org/learning-loop/publish.js";
import { openCandidateArtifact } from "../../../src/org/learning-loop/host/candidate-store.js";
import { appLearningRoot, orgLearningRoot, readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { appendLearningEventsDeduped, readLearningEvents } from "../../../src/org/learning-loop/host/events.js";
import { defaultLearningPolicy } from "../../../src/org/learning-loop/host/policy.js";
import { resolveLearningContext } from "../../../src/org/learning-loop/host/resolver.js";
import { writeReviewerVerdict } from "../../../src/org/learning-loop/host/review.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import {
  PARITY_APP,
  PARITY_APP_CANDIDATE,
  PARITY_CLOCK_START,
  PARITY_EPISODES,
  PARITY_ORG,
  PARITY_ORG_CANDIDATE,
  PARITY_REJECT_CANDIDATE,
  PARITY_RESOLVE,
  PARITY_SKILL_CANDIDATE,
  episodeRecord,
  parityApprovalIdSource,
  parityErrorEvent,
} from "../../fixtures/learning-parity/inputs.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { walkFiles } from "../../fixtures/walk.js";

const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "learning-parity");
const CAPTURED = join(FIXTURE, "captured");

/** Parse JSON and require an object — the fixture files are data, not types. */
function objectOf(raw: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} is not an object`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) out[key] = Reflect.get(parsed, key);
  return out;
}

function stringsOf(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`${label} is not a string array`);
  return value.filter((entry): entry is string => typeof entry === "string");
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not a string`);
  return value;
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`${label} is not a number`);
  return value;
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is not an object`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = Reflect.get(value, key);
  return out;
}

async function summary(): Promise<{
  concept_ids: string[];
  sections: string[];
  context_bytes: number;
  bundle_versions: Record<string, unknown>;
}> {
  const raw = objectOf(await readFile(join(FIXTURE, "resolved-summary.json"), "utf8"), "resolved-summary.json");
  return {
    concept_ids: stringsOf(raw["concept_ids"], "concept_ids"),
    sections: stringsOf(raw["sections"], "sections"),
    context_bytes: numberOf(raw["context_bytes"], "context_bytes"),
    bundle_versions: recordOf(raw["bundle_versions"], "bundle_versions"),
  };
}

interface World {
  org: TempOrgHome;
  state: TempStateHome;
  appWorkdir: string;
  clock: TestClock;
  approvals: ApprovalStore;
  learning: CormidiaLearningLoop;
  deps: PublishDeps;
}

async function captured(relative: string): Promise<string> {
  return readFile(join(CAPTURED, relative), "utf8");
}

async function makeWorld(): Promise<World> {
  const org = await makeTempOrgHome({ name: PARITY_ORG });
  const state = await makeTempStateHome({ name: PARITY_ORG });
  const clock = makeTestClock(PARITY_CLOCK_START);
  const approvals = new ApprovalStore(state.stateHome, { now: clock.dateFn, idSource: parityApprovalIdSource() });
  const appWorkdir = join(org.root, "apps", PARITY_APP);
  await mkdir(appWorkdir, { recursive: true });
  const policy = defaultLearningPolicy();
  const learning = createCormidiaLearningLoop({
    orgHome: org.orgHome,
    stateHome: state.stateHome,
    org: PARITY_ORG,
    approvals,
    policy,
    apps: [{ name: PARITY_APP, workdir: appWorkdir, resolved: true }],
    clock: { now: () => clock.nowIso() },
    ids: createSequentialIds("parity"),
  });
  const deps: PublishDeps = {
    learning,
    policy,
    approvals,
    appRoots: { [PARITY_APP]: appLearningRoot(appWorkdir) },
    actor: "human:parity-operator",
    clock: clock.dateFn,
  };
  return { org, state, appWorkdir, clock, approvals, learning, deps };
}

/** The forked capture's exact input sequence, replayed on the kernel path. */
async function replayInputs(world: World): Promise<void> {
  const { org, state, appWorkdir, clock, approvals, deps } = world;
  await mkdir(state.path("learning", "episodes"), { recursive: true });
  for (const [id, ticket, closed] of PARITY_EPISODES) {
    await writeFile(
      state.path("learning", "episodes", `${id}.json`),
      `${JSON.stringify(episodeRecord(id, ticket, closed), null, 2)}\n`,
    );
  }
  await appendLearningEventsDeduped(state.stateHome, [parityErrorEvent(clock.nowIso())]);
  const orgRoot = orgLearningRoot(org.orgHome);
  const appRoot = appLearningRoot(appWorkdir);

  await openCandidateArtifact(orgRoot, PARITY_ORG_CANDIDATE.spec(), PARITY_ORG_CANDIDATE.draft());
  await writeReviewerVerdict(org.orgHome, PARITY_ORG_CANDIDATE.verdict());
  const raisedOrg = await publishCandidate(deps, PARITY_ORG_CANDIDATE.id);
  if (raisedOrg.status !== "raised") throw new Error(`org raise: ${JSON.stringify(raisedOrg)}`);
  await approvals.decide(raisedOrg.approvalId, { decision: "approved", now: clock.nowDate() });
  clock.advance(60_000);
  const publishedOrg = await publishCandidate(deps, PARITY_ORG_CANDIDATE.id);
  if (publishedOrg.status !== "published") throw new Error(`org publish: ${JSON.stringify(publishedOrg)}`);

  await openCandidateArtifact(appRoot, PARITY_APP_CANDIDATE.spec(), PARITY_APP_CANDIDATE.draft());
  await writeReviewerVerdict(org.orgHome, PARITY_APP_CANDIDATE.verdict());
  const raisedApp = await publishCandidate(deps, PARITY_APP_CANDIDATE.id);
  if (raisedApp.status !== "raised") throw new Error(`app raise: ${JSON.stringify(raisedApp)}`);
  await approvals.decide(raisedApp.approvalId, { decision: "approved", now: clock.nowDate() });
  clock.advance(60_000);
  const publishedApp = await publishCandidate(deps, PARITY_APP_CANDIDATE.id);
  if (publishedApp.status !== "published") throw new Error(`app publish: ${JSON.stringify(publishedApp)}`);

  await openCandidateArtifact(orgRoot, PARITY_SKILL_CANDIDATE.spec());
  await writeReviewerVerdict(org.orgHome, PARITY_SKILL_CANDIDATE.verdict());
  clock.advance(60_000);
  const publishedSkill = await publishCandidate(deps, PARITY_SKILL_CANDIDATE.id);
  if (publishedSkill.status !== "published") throw new Error(`skill publish: ${JSON.stringify(publishedSkill)}`);

  await openCandidateArtifact(orgRoot, PARITY_REJECT_CANDIDATE.spec());
  await writeReviewerVerdict(org.orgHome, PARITY_REJECT_CANDIDATE.verdict());
  clock.advance(60_000);
  const rejected = await publishCandidate(deps, PARITY_REJECT_CANDIDATE.id);
  if (rejected.status !== "rejected") throw new Error(`reject: ${JSON.stringify(rejected)}`);
  clock.advance(60_000);
}

async function resolveParityTurn(orgHome: string, appWorkdir: string, stateHome: string, clock: TestClock) {
  return resolveLearningContext({
    orgHome,
    appWorkdir,
    app: PARITY_APP,
    role: PARITY_RESOLVE.role,
    turnId: PARITY_RESOLVE.turnId,
    episodeId: PARITY_RESOLVE.episodeId,
    taskText: PARITY_RESOLVE.taskText,
    policy: defaultLearningPolicy(),
    stateHome,
    clock: clock.dateFn,
  });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The parity detector: captured bytes vs produced bytes for one file. */
class ParityViolation extends Error {
  constructor(readonly file: string) {
    super(`parity violation: ${file} differs from the forked engine's captured bytes`);
    this.name = "ParityViolation";
  }
}

async function assertByteParity(producedPath: string, capturedRelative: string): Promise<void> {
  const produced = await readFile(producedPath, "utf8");
  const expected = await captured(capturedRelative);
  if (produced !== expected) throw new ParityViolation(capturedRelative);
}

describe("CF-B32-PARITY — kernel path vs the forked engine's captured org home", () => {
  let world: World;
  const ORG_CONCEPT = "org-home/learning/bundle/org/parity-org-lesson.md";
  const APP_CONCEPT = "app-web/.cormidia/learning/bundle/apps/web/parity-app-lesson.md";

  beforeAll(async () => {
    world = await makeWorld();
    await replayInputs(world);
  }, 120_000);

  afterAll(async () => {
    await world.org.cleanup();
    await world.state.cleanup();
  });

  it("the captured fixture is intact: every file's SHA-256 matches the pinned digest manifest", async () => {
    const manifest = objectOf(await readFile(join(FIXTURE, "digests.json"), "utf8"), "digests.json");
    expect(manifest["clock_start"]).toBe(PARITY_CLOCK_START);
    const pinned = recordOf(manifest["files"], "files");
    const files = await walkFiles(CAPTURED);
    expect(files.sort()).toEqual(Object.keys(pinned).sort());
    for (const file of files) {
      expect(sha256(await readFile(join(CAPTURED, file))), file).toBe(pinned[file]);
    }
  });

  it("activated concept bytes are byte-identical on both roots (§3a exact preservation)", async () => {
    await assertByteParity(join(world.org.orgHome, "learning", "bundle", "org", "parity-org-lesson.md"), ORG_CONCEPT);
    await assertByteParity(
      join(world.appWorkdir, ".cormidia", "learning", "bundle", "apps", "web", "parity-app-lesson.md"),
      APP_CONCEPT,
    );
  });

  it("manifest cuts match version-for-version; only the ruled approval_ref (kernel idempotency key) and note differ", async () => {
    for (const [root, rel] of [
      [orgLearningRoot(world.org.orgHome), "org-home/learning/manifest.yaml"],
      [appLearningRoot(world.appWorkdir), "app-web/.cormidia/learning/manifest.yaml"],
    ] as const) {
      const produced = await readManifest(root);
      const { parse } = await import("yaml");
      const expected = recordOf(parse(await captured(rel)), rel);
      const history = expected["history"];
      if (!Array.isArray(history)) throw new Error(`${rel}: history is not a list`);
      expect(produced?.bundle_version).toBe(expected["bundle_version"]);
      expect(produced?.stable).toBe(expected["stable"]);
      expect(produced?.canary).toBe(expected["canary"]);
      expect(produced?.history).toHaveLength(history.length);
      for (const [index, raw] of history.entries()) {
        const entry = recordOf(raw, `${rel} history[${index}]`);
        const cut = produced?.history[index];
        expect(cut?.version).toBe(entry["version"]);
        expect(cut?.promoted).toBe(entry["promoted"]);
        expect(cut?.concepts).toEqual(entry["concepts"]);
        // The ruled delta: the fork keyed cuts by approval id, the kernel by its idempotency key.
        expect(cut?.approval_ref).toMatch(/^[0-9a-f]{64}$/);
        expect(cut?.approval_ref).not.toBe(stringOf(entry["approval_ref"], "approval_ref"));
      }
    }
  });

  it("routine proposal draft bytes and the rejection ledger entry are byte-identical", async () => {
    await assertByteParity(
      join(world.org.orgHome, "learning", "proposals", "skills", "cand_parity_skill.md"),
      "org-home/learning/proposals/skills/cand_parity_skill.md",
    );
    await assertByteParity(
      join(world.org.orgHome, "learning", "rejections.jsonl"),
      "org-home/learning/rejections.jsonl",
    );
  });

  it("the post-cutover resolver over the kernel-published roots pins the same resolved record, episode assignment, and concept_loaded events", async () => {
    const resolved = await resolveParityTurn(world.org.orgHome, world.appWorkdir, world.state.stateHome, world.clock);
    const expected = await summary();
    expect(resolved.concept_ids).toEqual(expected.concept_ids);
    expect(resolved.sections).toEqual(expected.sections);
    expect(resolved.context_bytes).toBe(expected.context_bytes);
    expect(resolved.bundle_versions).toEqual(expected.bundle_versions);
    await assertByteParity(
      world.state.path("learning", "resolved", "turn_parity_1.json"),
      "state-home/learning/resolved/turn_parity_1.json",
    );
    await assertByteParity(
      world.state.path("learning", "canary", "assignments", "ep_web_ticket_0044.json"),
      "state-home/learning/canary/assignments/ep_web_ticket_0044.json",
    );
    await assertByteParity(
      world.state.path("learning", "events", "2026-08-21", "turn_parity_1.jsonl"),
      "state-home/learning/events/2026-08-21/turn_parity_1.jsonl",
    );
  });

  it("the captured active artifacts (the fork's own bundle + manifest) resolve unchanged under the post-cutover reader", async () => {
    const org = await makeTempOrgHome({ name: "parity-captured" });
    const state = await makeTempStateHome({ name: "parity-captured" });
    try {
      const appWorkdir = join(org.root, "apps", PARITY_APP);
      await cp(join(CAPTURED, "org-home", "learning"), join(org.orgHome, "learning"), { recursive: true });
      await cp(join(CAPTURED, "app-web", ".cormidia", "learning"), join(appWorkdir, ".cormidia", "learning"), {
        recursive: true,
      });
      await cp(join(CAPTURED, "state-home", "learning", "episodes"), state.path("learning", "episodes"), {
        recursive: true,
      });
      const clock = makeTestClock(PARITY_CLOCK_START);
      clock.advance(5 * 60_000);
      const resolved = await resolveParityTurn(org.orgHome, appWorkdir, state.stateHome, clock);
      const expected = await summary();
      expect(resolved.concept_ids).toEqual(expected.concept_ids);
      expect(resolved.sections).toEqual(expected.sections);
      await assertByteParity(
        state.path("learning", "resolved", "turn_parity_1.json"),
        "state-home/learning/resolved/turn_parity_1.json",
      );
      const events = await readLearningEvents(state.stateHome);
      expect(events.filter((event) => event.type === "concept_loaded").map((event) => event.event_id)).toEqual([
        "evt_resolve_turn_parity_1_load-lrn_parity_org",
        "evt_resolve_turn_parity_1_load-lrn_parity_app",
      ]);
    } finally {
      await org.cleanup();
      await state.cleanup();
    }
  });

  it("the fork's binding artifacts read through the compatibility readers and are never rewritten", async () => {
    const { item } = await world.approvals.show("parity-approval-01");
    const binding = legacyPublishBindingOf({
      ...item,
      action: {
        tool: "learning_publish",
        input: recordOf(
          objectOf(await captured("state-home/approvals/decided/parity-approval-01.json"), "item")["action"],
          "action",
        )["input"],
      },
    });
    expect(binding?.candidate_id).toBe("cand_parity_org");
    expect(binding?.final_diff_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const state = await makeTempStateHome({ name: "parity-legacy" });
    try {
      await cp(join(CAPTURED, "state-home", "learning", "publish-journal"), state.path("learning", "publish-journal"), {
        recursive: true,
      });
      const journal = await readLegacyPublishJournal(state.stateHome, "parity-approval-01");
      expect(journal?.done_at).toBe("2026-08-21T12:01:00.000Z");
      expect(journal?.manifest_version).toBe("2026.08.21-1");
      expect(await readLegacyPublishJournal(state.stateHome, "routine-cand_parity_skill")).toMatchObject({
        candidate_id: "cand_parity_skill",
        approval_ref: null,
      });
    } finally {
      await state.cleanup();
    }
  });

  it("the kernel path raised the same approval ids and the kernel journaled every lane as a verified authorization", async () => {
    const decided = await world.approvals.listDecidedReadOnly();
    expect(decided.map((item) => item.id)).toEqual(["parity-approval-01", "parity-approval-02"]);
    expect(decided.every((item) => item.action.tool === "learning_loop_publish")).toBe(true);
    const interventions = await listKernelInterventions(world.learning);
    expect(interventions.map((view) => view.artifactId).sort()).toEqual([
      "cand_parity_app",
      "cand_parity_org",
      "cand_parity_skill",
    ]);
    for (const view of interventions) {
      const record = await world.learning.loop.getIntervention({ interventionId: view.id });
      expect(record?.state.authorization).toBe("authorized");
      expect(record?.state.publication).toBe("published");
      expect(record?.authorizationIds).toHaveLength(1);
    }
    // Activation follows effect class: context (OKF) active, proposal inactive.
    const byArtifact = new Map(interventions.map((view) => [view.artifactId, view]));
    expect(byArtifact.get("cand_parity_org")?.claimLabel).toBe("authorized (unproven)");
    expect(byArtifact.get("cand_parity_app")?.state.activation).toBe("active");
    expect(byArtifact.get("cand_parity_skill")?.state.activation).toBe("inactive");
    expect(byArtifact.get("cand_parity_skill")?.claim).toBeNull();
  });

  it("negative control: a single altered byte in a produced concept makes the parity detector fire", async () => {
    const path = join(world.org.orgHome, "learning", "bundle", "org", "parity-org-lesson.md");
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("type-check", "type-chek"));
    try {
      await expect(assertByteParity(path, ORG_CONCEPT)).rejects.toThrow(ParityViolation);
    } finally {
      await writeFile(path, original);
    }
  });
});
