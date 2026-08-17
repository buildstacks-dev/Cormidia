// Traceability: CF-J17-S · HB-013 · contracts/journey-acceptance.md J-17 success criterion.

// CF-J17-S — declared release: mechanism → fresh content-bound approval →
// at-most-once execution; acceptance vs completion recorded separately
// (contracts/journey-acceptance.md J-17; contracts/B-17-typed-executor.md §2/§4;
// CORMIDIA-INV-003; system-map T-12, risk E-1).
//
// L2 walk on real product code end to end: `queueReleaseApprovals` raises the
// production-deploy critical op from the merged milestone's declared trigger,
// the human decision mints the fresh single-use content-bound grant, and
// `executeApprovedReleases` (the A4 release executor, orchestrator owner)
// performs it exactly once through the real episode boundary. The only fakes
// sit at ratified seams: the injected `commandRunner` (the deploy target),
// the gh process double (B-01) for the ticket acknowledgement comment, and a
// real temp git repo as the managed clone.
//
// BLOCKED:B-17-L3 — CF-J17-A (the real non-GitHub round-trip of this journey)
// stays parked per validation-policy.yaml obligation B-17-L3: there is no
// disposable real non-GitHub target. Do not implement it here; the scripted
// walk below is the L2 cell only and no green L3 claim follows from it.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";
import {
  ApprovalStore,
  actionHash,
  approvalLifecycleState,
  commandIdentityHash,
  type ApprovalItem,
} from "../../../src/org/approvals.js";
import type { AppsFile } from "../../../src/org/apps.js";
import {
  executeApprovedReleases,
  queueReleaseApprovals,
  type ReleaseCommandResult,
  type ReleaseExecutionRecord,
} from "../../../src/org/release.js";
import { digestJson, parseReleaseTagMessage, type ReleaseAttestationV1 } from "../../../src/org/release-evidence.js";
import type { LoopItem } from "../../../src/loop/types.js";
import { GhCliOps } from "../../../src/loop/github.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTestClock } from "../../fixtures/clock.js";

const APP = "release-app";
const RELEASE_COMMAND = "./scripts/deploy.sh production";

const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: HERMETIC_GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

function mergedItem(issueNumber: number): LoopItem {
  return {
    issueNumber,
    ticketRef: `#${issueNumber}`,
    title: "Ship the deployable milestone",
    body: "## Goal\nDeploy.\n\nRelease-kind: deploy\n",
    targetRepo: "cormidia-double/unused",
    labels: [],
    phase: "merged",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults: [],
    findings: [],
    releaseTrigger: { kind: "deploy", command: RELEASE_COMMAND, owner: "orchestrator" },
  };
}

interface Walk {
  org: TempOrgHome;
  handle: GithubDoubleHandle;
  store: ApprovalStore;
  appsFile: AppsFile;
  issueNumber: number;
  managedClone: string;
  remote: string;
}

describe("CF-J17-S — declared release: fresh content-bound approval → at-most-once execution (L2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<Walk> {
    const org = await makeTempOrgHome({ name: "cf-j17-org" });
    cleanups.push(() => org.cleanup());
    const handle = await installGithubDouble({ defaultBranch: "trunk" });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);
    const issue = await gh.createIssue({
      title: "Deployable milestone",
      body: "Release-kind: deploy",
      labels: [],
    });

    // Managed clone at the exact product path (real git, not a stub dir).
    const managedClone = join(org.stateHome, "repos", APP);
    mkdirSync(managedClone, { recursive: true });
    gitIn(managedClone, "init");
    writeFileSync(join(managedClone, "README.md"), "fixture clone\n");
    gitIn(managedClone, "add", "README.md");
    gitIn(
      managedClone,
      "-c",
      "user.email=fixture@invalid",
      "-c",
      "user.name=fixture",
      "commit",
      "--no-gpg-sign",
      "-m",
      "init",
    );
    gitIn(managedClone, "config", "user.email", "fixture@invalid");
    gitIn(managedClone, "config", "user.name", "fixture");
    const remote = join(org.stateHome, "release-remote.git");
    execFileSync("git", ["init", "--bare", remote], { env: HERMETIC_GIT_ENV, stdio: "ignore" });
    gitIn(managedClone, "remote", "add", "origin", remote);

    const appsFile: AppsFile = {
      org: { name: "cf-j17-org", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
      apps: [
        {
          name: APP,
          repo: handle.repo,
          status: "live",
          budgetUsdMonth: 100,
          objectiveBudgetUsd: 1000,
          cadence: {},
          release: { kind: "deploy", command: RELEASE_COMMAND, owner: "orchestrator", trigger: "command" },
        },
      ],
    };
    return {
      org,
      handle,
      store: new ApprovalStore(org.stateHome),
      appsFile,
      issueNumber: issue.number,
      managedClone,
      remote,
    };
  }

  it("walks trigger → content-bound approval → single typed execution with acceptance and completion as separate durable facts", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");

    // 1 — the merged milestone's declared trigger raises the critical op.
    const queued = await queueReleaseApprovals(walk.org.stateHome, APP, [mergedItem(walk.issueNumber)], clock.dateFn);
    expect(queued).toHaveLength(1);
    const approvalId = queued[0]!.approvalId;
    const pending = await walk.store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.rule).toBe("production-deploy");
    // Content-bound: the approval binds the executable action itself.
    expect(pending[0]!.action.tool).toBe("bash");
    expect((pending[0]!.action.input as { command: string }).command).toBe(RELEASE_COMMAND);

    // 2 — before any decision, dispatch must execute nothing (INV-003:
    // approval is never execution — and absence of approval doubly so).
    const runnerCalls: Array<{ command: string; cwd: string }> = [];
    const runner = async (command: string, cwd: string): Promise<ReleaseCommandResult> => {
      runnerCalls.push({ command, cwd });
      // Acceptance vs completion recorded separately (B-17 §2): while the
      // command is still running, the durable release record already says
      // `running` (the accepted attempt) and the approval says `executing` —
      // neither surface may claim completion yet.
      const midFlight = JSON.parse(
        readFileSync(join(walk.org.stateHome, "releases", `${approvalId}.json`), "utf8"),
      ) as ReleaseExecutionRecord;
      expect(midFlight.status).toBe("running");
      expect(midFlight.startedAt).toBeDefined();
      expect(midFlight.finishedAt).toBeUndefined();
      const midItem = await walk.store.show(approvalId);
      expect(midItem.item.execution?.state).toBe("executing");
      return { exitCode: 0, stdout: "deployed rev 42", stderr: "" };
    };
    const options = {
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      commandRunner: runner,
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
    };
    const before = await executeApprovedReleases(options);
    expect(before).toEqual([]);
    expect(runnerCalls).toHaveLength(0);

    // 3 — the human decision mints the FRESH content-bound single-use grant.
    const decided = await walk.store.decide(approvalId, {
      decision: "approved",
      now: clock.nowDate(),
    });
    expect(decided.execution?.executor).toBe("release");
    expect(approvalLifecycleState(decided)).toBe("approved"); // approved ≠ executed
    const shown = await walk.store.show(approvalId);
    expect(shown.grant).toBeDefined();
    expect(shown.grant!.uses).toBe(1);
    expect(shown.grant!.scope).toBeUndefined(); // fresh + exact, never widened
    expect(shown.grant!.actionHash).toBe(actionHash(decided.action));
    expect(shown.grant!.commandSha256).toBe(commandIdentityHash(RELEASE_COMMAND));

    // 4 — a later dispatch performs the typed execution exactly once.
    const outcomes = await executeApprovedReleases(options);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ approvalId, app: APP, status: "completed" });
    expect(runnerCalls).toEqual([{ command: RELEASE_COMMAND, cwd: walk.managedClone }]);

    // Completion recorded separately from acceptance: the terminal record
    // carries both instants and the terminal status.
    const record = JSON.parse(
      readFileSync(join(walk.org.stateHome, "releases", `${approvalId}.json`), "utf8"),
    ) as ReleaseExecutionRecord;
    expect(record.status).toBe("completed");
    expect(record.startedAt).toBeDefined();
    expect(record.finishedAt).toBeDefined();
    expect(record.exitCode).toBe(0);
    expect(record.command).toBe(RELEASE_COMMAND);

    // The approval acknowledgement is a distinct durable fact (T-12).
    const acked = await walk.store.show(approvalId);
    expect(acked.item.execution?.state).toBe("executed");
    expect(acked.item.execution?.actor).toBe("orchestrator/release");
    expect(acked.grant!.uses).toBe(0); // exactly one grant consumption (B-17 §1)
    expect(acked.grant!.consumedAt).toBeDefined();

    // The ticket carries the outcome comment (external acknowledgement).
    const comments = await new GhCliOps(walk.handle.repo, walk.handle.exec).listIssueComments(walk.issueNumber);
    const outcomeComments = comments.filter((comment) => comment.body.includes("Cormidia release outcome"));
    expect(outcomeComments).toHaveLength(1);
    expect(outcomeComments[0]!.body).toContain(approvalId);
    expect(outcomeComments[0]!.body).toContain("**completed**");

    // 5 — at-most-once: a re-dispatch performs nothing and re-acknowledges nothing.
    const again = await executeApprovedReleases(options);
    expect(again).toEqual([]);
    expect(runnerCalls).toHaveLength(1);
    const commentsAfter = await new GhCliOps(walk.handle.repo, walk.handle.exec).listIssueComments(walk.issueNumber);
    expect(commentsAfter.filter((comment) => comment.body.includes("Cormidia release outcome"))).toHaveLength(1);
  });

  it("negative control: post-decision tamper of the approved command — the content-binding detector FIRES and nothing runs", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const [queued] = await queueReleaseApprovals(walk.org.stateHome, APP, [mergedItem(walk.issueNumber)], clock.dateFn);
    const approvalId = queued!.approvalId;
    await walk.store.decide(approvalId, { decision: "approved", now: clock.nowDate() });

    // SEEDED VIOLATION (INV-003 falsifier: "changed bytes executing under the
    // old approval"): the decided record's command is edited after the human
    // decision; the grant still binds the ORIGINAL action identity.
    const decidedPath = join(walk.org.stateHome, "approvals", "decided", `${approvalId}.json`);
    const raw = JSON.parse(readFileSync(decidedPath, "utf8")) as ApprovalItem;
    (raw.action.input as { command: string }).command = "./scripts/deploy.sh production --skip-checks";
    writeFileSync(decidedPath, `${JSON.stringify(raw, null, 2)}\n`);

    let runnerCalls = 0;
    const outcomes = await executeApprovedReleases({
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      commandRunner: async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
    });

    // The detector fires: the grant no longer matches the changed bytes, the
    // episode's approval step fails closed, and the runner is never invoked.
    expect(runnerCalls).toBe(0);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("failed");
    const after = await walk.store.show(approvalId);
    expect(after.item.execution?.state).not.toBe("executed");
  });

  it("executes an RQ-1 tag as an exact annotated envelope and pushes it once", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-08-04T20:00:00.000Z");
    const revision = gitIn(walk.managedClone, "rev-parse", "HEAD");
    const attestation = rq1Attestation(revision);
    const attestationSha = digestJson(attestation);
    const attestationDir = join(walk.org.stateHome, "releases", "attestations");
    mkdirSync(attestationDir, { recursive: true });
    writeFileSync(join(attestationDir, `${attestationSha}.json`), `${JSON.stringify(attestation)}\n`);
    const raised = await walk.store.raise({
      app: APP,
      role: "orchestrator",
      rule: "production-deploy",
      action: { tool: "bash", input: { command: `cormidia-internal rq1-tag ${attestationSha}` } },
      ticketRef: `#${walk.issueNumber}`,
      justification: `RQ-1 attestation ${attestationSha}`,
      now: clock.nowDate(),
    });
    await walk.store.decide(raised.id, {
      decision: "approved",
      reason: "Exact packet and action reviewed",
      decidedBy: { kind: "human", identity: "fixture-human" },
      now: clock.nowDate(),
    });
    const outcomes = await executeApprovedReleases({
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
      commandRunner: async () => {
        throw new Error("RQ-1 tag must not enter the shell command runner");
      },
    });
    expect(outcomes).toMatchObject([{ status: "completed", approvalId: raised.id }]);
    expect(gitIn(walk.managedClone, "rev-parse", "v0.1.2^{}")).toBe(revision);
    expect(gitIn(walk.remote, "rev-parse", "refs/tags/v0.1.2^{}")).toBe(revision);
    const envelope = parseReleaseTagMessage(
      gitIn(walk.managedClone, "for-each-ref", "--format=%(contents)", "refs/tags/v0.1.2"),
    );
    expect(envelope.approval).toMatchObject({ approved_by: "fixture-human", attestation_sha256: attestationSha });
    expect(
      await executeApprovedReleases({
        stateHome: walk.org.stateHome,
        orgHome: walk.org.orgHome,
        appsFile: walk.appsFile,
        now: clock.dateFn,
        ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
      }),
    ).toEqual([]);
  });

  it("negative control: a lost RQ-1 push response reconciles the exact remote tag marker", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-08-04T20:00:00.000Z");
    const revision = gitIn(walk.managedClone, "rev-parse", "HEAD");
    const attestation = rq1Attestation(revision);
    const attestationSha = digestJson(attestation);
    const attestationDir = join(walk.org.stateHome, "releases", "attestations");
    mkdirSync(attestationDir, { recursive: true });
    writeFileSync(join(attestationDir, `${attestationSha}.json`), `${JSON.stringify(attestation)}\n`);
    const raised = await walk.store.raise({
      app: APP,
      role: "orchestrator",
      rule: "production-deploy",
      action: { tool: "bash", input: { command: `cormidia-internal rq1-tag ${attestationSha}` } },
      ticketRef: `#${walk.issueNumber}`,
      now: clock.nowDate(),
    });
    await walk.store.decide(raised.id, {
      decision: "approved",
      decidedBy: { kind: "human", identity: "fixture-human" },
      now: clock.nowDate(),
    });
    const outcomes = await executeApprovedReleases({
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
      rq1GitRunner: async (cwd, args) => {
        const stdout = gitIn(cwd, ...args);
        if (args[0] === "push") return { exitCode: 1, stdout: "", stderr: "seeded lost response" };
        return { exitCode: 0, stdout, stderr: "" };
      },
    });
    expect(outcomes).toMatchObject([{ status: "completed", approvalId: raised.id }]);
    expect(outcomes[0]!.summary).toContain("exact remote tag marker reconciled");
    expect((await walk.store.show(raised.id)).item.execution?.state).toBe("executed");
    expect(gitIn(walk.remote, "rev-parse", "refs/tags/v0.1.2^{}")).toBe(revision);
  });

  it("negative control: refuses a modified RQ-1 attestation before consuming the approved grant", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-08-04T20:00:00.000Z");
    const revision = gitIn(walk.managedClone, "rev-parse", "HEAD");
    const attestation = rq1Attestation(revision);
    const attestationSha = digestJson(attestation);
    const attestationDir = join(walk.org.stateHome, "releases", "attestations");
    mkdirSync(attestationDir, { recursive: true });
    writeFileSync(join(attestationDir, `${attestationSha}.json`), `${JSON.stringify(attestation)}\n`);
    const raised = await walk.store.raise({
      app: APP,
      role: "orchestrator",
      rule: "production-deploy",
      action: { tool: "bash", input: { command: `cormidia-internal rq1-tag ${attestationSha}` } },
      ticketRef: `#${walk.issueNumber}`,
      now: clock.nowDate(),
    });
    await walk.store.decide(raised.id, {
      decision: "approved",
      decidedBy: { kind: "human", identity: "fixture-human" },
      now: clock.nowDate(),
    });
    writeFileSync(
      join(attestationDir, `${attestationSha}.json`),
      `${JSON.stringify({ ...attestation, tag: "v0.1.3" })}\n`,
    );
    const outcomes = await executeApprovedReleases({
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
    });
    expect(outcomes).toMatchObject([{ status: "failed", approvalId: raised.id }]);
    expect(gitIn(walk.managedClone, "tag", "--list")).toBe("");
    expect((await walk.store.show(raised.id)).grant?.uses).toBe(1);
  });

  // Revocation below is the RATIFIED disposition (revokeGrantSync
  // terminalizes an unused single-use grant's execution record). The sibling
  // F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history.
  // Its dedicated disposition cases remain outside this revocation ticket.
  it("a revoked grant terminalizes the approved release before any execution", async () => {
    const walk = await makeWalk();
    const clock = makeTestClock("2026-07-31T09:00:00.000Z");
    const [queued] = await queueReleaseApprovals(walk.org.stateHome, APP, [mergedItem(walk.issueNumber)], clock.dateFn);
    const approvalId = queued!.approvalId;
    const decided = await walk.store.decide(approvalId, { decision: "approved", now: clock.nowDate() });
    walk.store.revokeGrantSync(decided.grantId!, clock.nowDate());

    let runnerCalls = 0;
    const outcomes = await executeApprovedReleases({
      stateHome: walk.org.stateHome,
      orgHome: walk.org.orgHome,
      appsFile: walk.appsFile,
      now: clock.dateFn,
      commandRunner: async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      ghFor: () => new GhCliOps(walk.handle.repo, walk.handle.exec),
    });
    expect(runnerCalls).toBe(0);
    expect(outcomes).toEqual([]); // revoked grant → nothing claimable
    const after = await walk.store.show(approvalId);
    // Revoking an unused single-use grant terminalizes its execution record.
    expect(after.item.execution?.state).toBe("failed");
    expect(after.item.execution?.failureCause).toBe("grant_revoked");
    expect(existsSync(join(walk.org.stateHome, "releases", `${approvalId}.json`))).toBe(false);
  });
});

function rq1Attestation(revision: string): ReleaseAttestationV1 {
  const releaseAction = {
    kind: "npm_publish" as const,
    package_name: "cormidia",
    version: "0.1.2",
    tag: "v0.1.2",
    dist_tag: "latest",
    registry: "https://registry.npmjs.org",
  };
  return {
    schema_version: 1,
    contract_id: "RQ-1",
    qualification_id: "a".repeat(64),
    prepared_commit: revision,
    release_commit: revision,
    tag: "v0.1.2",
    package_name: "cormidia",
    package_version: "0.1.2",
    tarball_sha256: "b".repeat(64),
    tarball_integrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}`,
    qualification_report_sha256: "c".repeat(64),
    qualification_dispositions_sha256: "d".repeat(64),
    packet_files: [
      { path: "qualification-report.json", size: 1, sha256: "e".repeat(64) },
      { path: "release-manifest.json", size: 1, sha256: "f".repeat(64) },
    ],
    release_action: releaseAction,
    release_action_sha256: digestJson(releaseAction),
    created_at: "2026-08-04T19:59:00.000Z",
  };
}
