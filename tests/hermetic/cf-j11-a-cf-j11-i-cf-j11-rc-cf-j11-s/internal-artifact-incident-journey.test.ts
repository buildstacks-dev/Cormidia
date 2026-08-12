// Traceability: CF-J11-S · HB-143; CF-J11-I · HB-143; CF-J11-RC · HB-143; CF-J11-A · HB-143 · contracts/journey-acceptance.md J-11; system-map.md J-11; boundary-map.md B-01/B-17; invariants.md CORMIDIA-INV-003/008/014; docs/approvals/design.md §5.3 consequence split; validation-policy.yaml F-PT-035.

// CF-J11-S/I/RC/A — the internal-artifact and incident journey family (L2).
//
// Owner ruling F-PT-035 (2026-08-12): source-linked `op:incident` filing into
// the app's OWN configured repository is budgeted `repo-collaboration` — the
// composed gate verifies the target repository BEFORE any grant matching, and
// anything foreign, dynamic, or unverifiable refines to the human-only
// `repo-collaboration-foreign`. J-11's "external" means outside the app's own
// configured repositories. Analysis-complete and incident-filed remain
// SEPARATE recorded claims (never collapsed), with exactly one source-linked
// issue under crash and retry.
//
// Hermetic composition on real product code: persistStandingRoleOutcome →
// composeGate(defaultGate) → ApprovalStore → executeApprovedDeliveries against
// the gh PROCESS double through unmodified GhCliOps, with the injected test
// clock. No live calls anywhere.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GhCliOps } from "../../../src/loop/github.js";
import { executeApprovedDeliveries } from "../../../src/org/approval-delivery.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import type { TurnEvent } from "../../../src/org/journal.js";
import { persistStandingRoleOutcome } from "../../../src/org/standing-roles.js";
import { resolveTriggerRoute } from "../../../src/org/trigger-routing.js";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { defaultGate } from "../../../src/runtime/gate.js";
import type { GateFn } from "../../../src/runtime/types.js";
import { makeTestClock, type TestClock } from "../../fixtures/clock.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { walkFiles } from "../../fixtures/walk.js";

const APP = "incident-app";
const REPO = "cormidia-double/incident-app";
const EVENT_KEY = "health-001";
const T0 = "2026-08-12T09:00:00.000Z";

function healthAlert(overrides: Record<string, unknown> = {}): TurnEvent {
  return {
    kind: "health-alert",
    key: EVENT_KEY,
    source: "file-drop-inbox",
    payload: {
      kind: "health-alert",
      id: EVENT_KEY,
      app: APP,
      occurred_at: T0,
      source: "fixture",
      severity: "critical",
      service: "web",
      status: "down",
      summary: "/health returned 500 for three consecutive checks.",
      ...overrides,
    },
  };
}

function supportFeedback(): TurnEvent {
  return {
    kind: "support-feedback",
    key: "feedback-001",
    source: "file-drop-inbox",
    payload: {
      kind: "support-feedback",
      id: "feedback-001",
      app: APP,
      occurred_at: T0,
      source: "fixture",
      severity: "medium",
      channel: "email",
      summary: "User cannot tell whether /health failure is transient.",
    },
  };
}

function adoptionSignal(): TurnEvent {
  return {
    kind: "adoption-signal",
    key: "adoption-001",
    source: "file-drop-inbox",
    payload: {
      kind: "adoption-signal",
      id: "adoption-001",
      app: APP,
      occurred_at: T0,
      source: "fixture",
      metric: "weekly_active",
      direction: "up",
      value: 42,
      summary: "Weekly actives grew after the health fix.",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defined<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is undefined`);
  return value;
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value)) throw new Error(`expected a JSON object at ${path}`);
  return value;
}

/** Every remote issue that claims this source event as an incident. The
 *  uniqueness oracle below is the detector the seeded duplicate control fires. */
function sourceLinkedIncidents(handle: GithubDoubleHandle, eventKey: string): Array<{ title: string; body: string }> {
  return Object.values(handle.readState().issues)
    .filter((issue) => issue.labels.includes("op:incident") && issue.body.includes(`Event: ${eventKey}`))
    .map((issue) => ({ title: issue.title, body: issue.body }));
}

function assertExactlyOneSourceLinkedIncident(handle: GithubDoubleHandle, eventKey: string): void {
  const incidents = sourceLinkedIncidents(handle, eventKey);
  if (incidents.length !== 1) {
    throw new Error(
      `duplicate-incident detector: expected exactly 1 op:incident issue for ${eventKey}, found ${incidents.length}`,
    );
  }
}

function effectfulCalls(handle: GithubDoubleHandle): string[] {
  return handle
    .callLog()
    .filter((entry) => entry.effect)
    .map((entry) => entry.op);
}

/** Byte fingerprint of a state-home subtree — the read-only-observation oracle. */
async function treeFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await walkFiles(root)) {
    hash.update(file);
    hash.update(await readFile(join(root, file)));
  }
  return hash.digest("hex");
}

interface Walk {
  state: TempStateHome;
  handle: GithubDoubleHandle;
  store: ApprovalStore;
  clock: TestClock;
  appsFile: AppsFile;
  gate: GateFn;
  persist(event: TurnEvent, role: string): ReturnType<typeof persistStandingRoleOutcome>;
  deliver(fault?: "after_claim" | "after_remote"): ReturnType<typeof executeApprovedDeliveries>;
  artifactPath(artifactId: string): string;
}

describe("CF-J11 — internal artifacts and the incident journey (L2, hermetic)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<Walk> {
    const state = await makeTempStateHome({ name: "cf-j11" });
    cleanups.push(() => state.cleanup());
    const handle = await installGithubDouble({ repo: REPO, defaultBranch: "trunk" });
    cleanups.push(() => handle.dispose());
    // PATH seam active for the whole walk: ANY product path that spawns `gh`
    // — including a seeded draft path that publishes — hits the double and
    // shows up as an effectful call, never the network.
    cleanups.push(handle.activatePath());
    const clock = makeTestClock(T0);
    const store = new ApprovalStore(state.stateHome, { now: clock.dateFn });
    const gate = composeGate(defaultGate, store, {
      app: APP,
      role: "sre",
      appRepo: REPO,
      ticketRef: `event:${EVENT_KEY}`,
      now: clock.dateFn,
    });
    const appsFile: AppsFile = {
      org: { name: "cf-j11-org", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
      apps: [{ name: APP, repo: REPO, status: "live", budgetUsdMonth: 100, objectiveBudgetUsd: 1000, cadence: {} }],
    };
    return {
      state,
      handle,
      store,
      clock,
      appsFile,
      gate,
      persist: (event, role) =>
        persistStandingRoleOutcome({
          stateHome: state.stateHome,
          app: APP,
          role,
          event,
          providerSummary: `scripted ${role} analysis summary`,
          now: clock.nowDate(),
          repo: REPO,
          gate,
        }),
      deliver: (fault) =>
        executeApprovedDeliveries({
          stateHome: state.stateHome,
          appsFile,
          now: clock.dateFn,
          ghFor: () => new GhCliOps(REPO, handle.exec),
          ...(fault === undefined
            ? {}
            : {
                fault: (boundary: "after_claim" | "after_remote") => {
                  if (boundary === fault) throw new Error(`SIMULATED CRASH at ${fault}`);
                },
              }),
        }),
      artifactPath: (artifactId) => state.path("standing-roles", APP, "artifacts", `${artifactId}.json`),
    };
  }

  describe("CF-J11-S — Support/Marketing/SRE completion ends in channel-gated internal draft artifacts", () => {
    it("all three roles persist draft-only internal artifacts with no outward effect", async () => {
      const walk = await makeWalk();
      const support = defined(await walk.persist(supportFeedback(), "support"), "support persistence");
      const marketing = defined(await walk.persist(adoptionSignal(), "marketing"), "marketing persistence");
      // A degraded (non-deploy-shaped) health alert: analysis without filing.
      const sre = defined(
        await walk.persist(healthAlert({ severity: "high", status: "degraded" }), "sre"),
        "sre persistence",
      );

      for (const result of [support, marketing, sre]) {
        expect(result.artifactCreated).toBe(true);
        expect(result.artifact.draft_only).toBe(true);
        expect(result.artifact.outward_effects).toEqual([]);
        expect(result.artifact.approval_state).toBe("not_requested");
        expect(result.plannerFeed.status).toBe("pending");
        // The internal artifact is durable at its documented state-home
        // location (README → Observability: standing-roles/<app>/).
        const onDisk = await readJsonObject(walk.artifactPath(result.artifact.artifact_id));
        expect(onDisk["draft_only"]).toBe(true);
        expect(onDisk["outward_effects"]).toEqual([]);
      }
      expect(support.artifact.draft).toContain("Reply draft only; no email, message, or ticket reply was sent.");
      expect(marketing.artifact.draft).toContain("Draft only; nothing was published.");
      expect(sre.artifact.delivery).toBeUndefined();

      // NO publication side effect anywhere on the draft path: with the PATH
      // seam active, any `gh` mutation would appear here.
      expect(effectfulCalls(walk.handle)).toEqual([]);
      expect(await walk.store.listPending()).toEqual([]);
    });

    it("channel gating: Support/Marketing without a declared channel never route; SRE is not channel-gated", () => {
      // Undeclared channels ({}): the audience roles are gated off.
      expect(resolveTriggerRoute({ role: "support", trigger: { event: "support-feedback" }, channels: {} })).toEqual({
        kind: "skip",
        reason: "support: support channel gate: app declares no support channels",
      });
      expect(resolveTriggerRoute({ role: "marketing", trigger: { event: "adoption-signal" }, channels: {} })).toEqual({
        kind: "skip",
        reason: "marketing: marketing channel gate: app declares no marketing channels",
      });
      // Declared channels route to their internal-artifact pipelines.
      expect(
        resolveTriggerRoute({
          role: "support",
          trigger: { event: "support-feedback" },
          channels: { support: ["email"] },
        }),
      ).toEqual({ kind: "pipeline", pipeline: "support-digest" });
      expect(
        resolveTriggerRoute({
          role: "marketing",
          trigger: { event: "adoption-signal" },
          channels: { marketing: ["blog"] },
        }),
      ).toEqual({ kind: "pipeline", pipeline: "ci-sweep" });
      // SRE incident intake is never channel-gated.
      expect(resolveTriggerRoute({ role: "sre", trigger: { event: "health-alert" }, channels: {} })).toEqual({
        kind: "pipeline",
        pipeline: "sre-incident",
      });
    });

    it("publication-effect oracle self-test: a draft path that actually publishes IS visible as an effectful call", async () => {
      const walk = await makeWalk();
      expect(effectfulCalls(walk.handle)).toEqual([]);
      // SEEDED VIOLATION (oracle self-test): simulate a violating draft path
      // performing the publication a draft path must never perform.
      await new GhCliOps(REPO, walk.handle.exec).createIssue({
        title: "draft path published",
        body: "this publication must be detected",
        labels: [],
      });
      expect(effectfulCalls(walk.handle)).toContain("issue.create"); // the detector fires
    });
  });

  describe("CF-J11-I — analysis-complete and incident-filed are separate claims across a crash", () => {
    it("a deploy-shaped alert completes analysis, files under budgeted repo-collaboration via an attributable AGENT decision, and a crash after the remote effect recovers without double-filing or losing the analysis", async () => {
      const walk = await makeWalk();
      const persisted = defined(await walk.persist(healthAlert(), "sre"), "sre persistence");
      const delivery = defined(persisted.artifact.delivery, "incident delivery");

      // Two SEPARATE recorded claims from the same turn.
      expect(delivery.analysis_state).toBe("complete");
      expect(delivery.filing_state).toBe("ready"); // filed is a DIFFERENT claim, not yet true
      expect(persisted.artifact.approval_state).toBe("parked");

      // The filing intent is a durable content-bound record under the ruled
      // rule — an attributable agent decision, never presented as human, with
      // the budgeted per-action audit row beside it (F-PT-035).
      const item = defined(
        (await walk.store.listDecided()).find((candidate) => candidate.rule === "repo-collaboration"),
        "repo-collaboration filing item",
      );
      expect(item.decision).toBe("approved");
      expect(defined(item.decidedBy, "decider").kind).toBe("agent");
      expect(defined(item.decidedBy, "decider").identity).toMatch(/^agent[:/]/);
      expect(defined(item.execution, "execution").executor).toBe("durable-github");
      expect(await walk.store.listPending()).toEqual([]);
      const auditLog = await readFile(walk.state.path("approvals", "objective-grants", "log.jsonl"), "utf8");
      expect(auditLog).toContain('"type":"budgeted-action"');
      expect(auditLog).toContain('"rule":"repo-collaboration"');
      // No stale-rule record anywhere: the retired name keeps its human-only
      // tombstone and is never minted anew (tests/unit/cf-split-publishing/).
      expect(item.rule).not.toBe("external-publishing");

      // CRASH between the remote effect and its acknowledgement.
      await expect(walk.deliver("after_remote")).rejects.toThrow(/SIMULATED CRASH/);
      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(1);
      // The analysis claim survives the crash untouched.
      const artifactAfterCrash = await readJsonObject(walk.artifactPath(persisted.artifact.artifact_id));
      const deliveryAfterCrash = artifactAfterCrash["delivery"];
      if (!isRecord(deliveryAfterCrash)) throw new Error("artifact lost its delivery claim");
      expect(deliveryAfterCrash["analysis_state"]).toBe("complete");

      // Recovery reconciles by idempotency marker — never a second filing.
      const outcomes = await walk.deliver();
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ status: "executed" });
      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(1);

      // Re-running the SAME turn persistence after recovery reports the filed
      // claim without duplicating the artifact, the item, or the issue.
      const again = defined(await walk.persist(healthAlert(), "sre"), "sre re-persistence");
      expect(again.artifactCreated).toBe(false);
      expect(defined(again.artifact.delivery, "delivery").filing_state).toBe("filed");
      expect(defined(again.artifact.delivery, "delivery").analysis_state).toBe("complete");
      expect(
        (await walk.store.listDecided()).filter((candidate) => candidate.rule === "repo-collaboration"),
      ).toHaveLength(1);
      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(1);
    });

    it("an interrupted mint (crash between raise and decision) converges on the next run onto the SAME item, without a human decision", async () => {
      // Derive the exact crash-residue bytes from a completed reference walk.
      const reference = await makeWalk();
      await reference.persist(healthAlert(), "sre");
      const referenceItem = defined(
        (await reference.store.listDecided()).find((candidate) => candidate.rule === "repo-collaboration"),
        "reference filing item",
      );

      // Fresh state home holding ONLY the residue a crash between raise and
      // decide leaves behind: a pending repo-collaboration item, no decision.
      // The residue carries the raising process's WALL timestamp — exactly
      // what a crashed queueIncidentFiling would have written (its internal
      // store runs on the wall clock), so the recovery decision below never
      // trips the pending TTL regardless of when this suite runs.
      const walk = await makeWalk();
      const residue = await walk.store.raise({
        app: APP,
        role: "sre",
        rule: "repo-collaboration",
        action: { tool: referenceItem.action.tool, input: referenceItem.action.input },
        ticketRef: `event:${EVENT_KEY}`,
        now: new Date(),
      });
      expect(residue.status).toBe("pending");

      const recovered = defined(await walk.persist(healthAlert(), "sre"), "recovered persistence");
      expect(defined(recovered.artifact.delivery, "delivery").filing_state).toBe("ready");
      expect(await walk.store.listPending()).toEqual([]);
      const decided = (await walk.store.listDecided()).filter((candidate) => candidate.rule === "repo-collaboration");
      expect(decided).toHaveLength(1); // the SAME item completed, never a duplicate
      expect(defined(decided[0], "decided item").id).toBe(residue.id);
      expect(defined(defined(decided[0], "decided item").decidedBy, "decider").kind).toBe("agent");
    });
  });

  describe("CF-J11-RC — exactly one source-linked op:incident issue under retry", () => {
    it("the idempotency key holds across re-persists and repeated dispatch: exactly one issue, source-linked", async () => {
      const walk = await makeWalk();
      const first = defined(await walk.persist(healthAlert(), "sre"), "first persistence");
      const firstKey = defined(first.artifact.delivery, "delivery").idempotency_key;

      await walk.deliver();
      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(1);

      // Retries: dispatch again, re-persist the same event, dispatch again.
      expect(await walk.deliver()).toEqual([]);
      const second = defined(await walk.persist(healthAlert(), "sre"), "second persistence");
      expect(defined(second.artifact.delivery, "delivery").idempotency_key).toBe(firstKey);
      await walk.deliver();

      const incidents = sourceLinkedIncidents(walk.handle, EVENT_KEY);
      expect(incidents).toHaveLength(1);
      const body = defined(incidents[0], "incident issue").body;
      expect(body).toContain(`Event: ${EVENT_KEY}`);
      expect(body).toContain("Payload SHA-256: ");
      expect(body).toContain("Artifact: standing_");
      expect(walk.handle.callLog().filter((entry) => entry.op === "issue.create")).toHaveLength(1);
      assertExactlyOneSourceLinkedIncident(walk.handle, EVENT_KEY); // green on honest bytes
    });

    it("SEEDED VIOLATION — a broken idempotency key mints a second filing and the uniqueness oracle turns red", async () => {
      const walk = await makeWalk();
      const persisted = defined(await walk.persist(healthAlert(), "sre"), "persistence");
      await walk.deliver();
      assertExactlyOneSourceLinkedIncident(walk.handle, EVENT_KEY); // honest state is green

      // Seed the exact failure a broken key derivation would produce: a second
      // durable filing for the SAME source event whose key (and therefore
      // marker) differs — reconciliation cannot see the first filing.
      const honest = defined(
        (await walk.store.listDecided()).find((candidate) => candidate.rule === "repo-collaboration"),
        "honest filing item",
      );
      const input = honest.action.input;
      if (!isRecord(input)) throw new Error("filing action input is not an object");
      const brokenKey = `${defined(persisted.artifact.delivery, "delivery").idempotency_key}-broken-retry-2`;
      const raised = await walk.store.raise({
        app: APP,
        role: "sre",
        rule: "repo-collaboration",
        action: { tool: honest.action.tool, input: { ...input, idempotency_key: brokenKey } },
        ticketRef: `event:${EVENT_KEY}`,
        now: walk.clock.nowDate(),
      });
      await walk.store.decide(raised.id, {
        decision: "approved",
        decidedBy: { kind: "agent", identity: "agent/seeded-violation/broken-key" },
        reason: "seeded duplicate-incident negative control (CF-J11-RC)",
        now: walk.clock.nowDate(),
      });
      await walk.deliver();

      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(2); // the violation landed
      expect(() => assertExactlyOneSourceLinkedIncident(walk.handle, EVENT_KEY)).toThrow(/duplicate-incident detector/); // the detector FIRES
    });
  });

  describe("CF-J11-A — draft visibility through observe with NO publication effect", () => {
    it("the filing intent is visible in the observe projection, the draft is durable at its documented location, and observation mutates nothing", async () => {
      const walk = await makeWalk();
      await walk.persist(supportFeedback(), "support");
      const sre = defined(await walk.persist(healthAlert(), "sre"), "sre persistence");
      // Deliberately NOT delivered: the draft and its filing INTENT are what
      // observe must show, with the remote untouched.
      const callsBefore = walk.handle.callLog().length;
      const approvalsBefore = await treeFingerprint(walk.state.path("approvals"));
      const draftsBefore = await treeFingerprint(walk.state.path("standing-roles"));

      const local = await indexLocalSources({
        orgName: "cf-j11-org",
        stateHome: walk.state.stateHome,
        appsFile: walk.appsFile,
        filters: {},
        now: walk.clock.nowDate(),
      });
      const snapshot = projectObserveSnapshot({ ...local, cursor: "0", github: [] });

      // Visibility: the filing intent surfaces through observe under the
      // ruled rule with its execution state — never silently absent.
      const view = defined(
        snapshot.approvals.find((approval) => approval.rule === "repo-collaboration"),
        "observe approval view",
      );
      expect(view.app).toBe(APP);
      expect(view.execution_state).toBe("approved");
      expect(view.execution_remote_ref).toBeNull();

      // The draft artifacts stay durable and draft-only at the documented
      // state-home location while being observed.
      const artifact = await readJsonObject(walk.artifactPath(sre.artifact.artifact_id));
      expect(artifact["draft_only"]).toBe(true);
      expect(artifact["outward_effects"]).toEqual([]);

      // NO publication effect from observation: no gh call of any kind, and
      // the approvals + standing-roles trees are byte-identical.
      expect(walk.handle.callLog().length).toBe(callsBefore);
      expect(effectfulCalls(walk.handle)).toEqual([]);
      expect(await treeFingerprint(walk.state.path("approvals"))).toBe(approvalsBefore);
      expect(await treeFingerprint(walk.state.path("standing-roles"))).toBe(draftsBefore);
      expect(sourceLinkedIncidents(walk.handle, EVENT_KEY)).toHaveLength(0);
    });
  });
});
