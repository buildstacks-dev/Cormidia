// CF-REG-205 — an undecided approval has a bounded lifetime. This detector
// was landed red-before-green against #205: before the repair reconcile()
// left the item pending forever.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapFromRecoveredAnswers,
  verifyApp,
  type RuntimeReadinessInspector,
} from "../../../src/org/app-lifecycle.js";
import { ApprovalStore, type ApprovalItem } from "../../../src/org/approvals.js";
import { releaseExpiredTicketApprovalClaim } from "../../../src/org/ticket-episode-approval.js";
import {
  readTicketClaimState,
  writeTicketClaimState,
} from "../../../src/loop/rehydrate.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { initWorldOrg, makeInitWorld, type InitWorld } from "../cf-j01/support.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const worlds: InitWorld[] = [];
const repos: TempGitRepo[] = [];

afterEach(async () => {
  for (const repo of repos.splice(0).reverse()) await repo.cleanup();
  for (const world of worlds.splice(0).reverse()) await world.cleanup();
});

const runtimeReady: RuntimeReadinessInspector = async () => [];

function assertExpiredDetector(item: ApprovalItem): void {
  if (item.status !== "expired") {
    throw new Error(`approval-expiry detector fired: ${item.id} remained ${item.status}`);
  }
}

async function makeWorld(): Promise<{ world: InitWorld; source: TempGitRepo }> {
  const world = await makeInitWorld();
  worlds.push(world);
  await initWorldOrg(world, "cf-reg-205");
  const source = await makeTempGitRepo({
    defaultBranch: "trunk",
    seedFiles: [{ path: "README.md", contents: "# expiry-app\n", message: "fixture app" }],
  });
  repos.push(source);
  await source.addFileRemote();
  await bootstrapFromRecoveredAnswers(
    source.dir,
    {
      product: "A fixture app for approval expiry.",
      good: "Expired approval turns unblock verification without losing evidence.",
      roles: ["builder"],
    },
    { orgHome: world.target, stateHome: world.stateHome, appName: "expiry-app" },
  );
  return { world, source };
}

describe("CF-REG-205 — pending approval expiry", () => {
  it("expires the raising turn, releases its claim, preserves evidence, and unblocks app verify", async () => {
    const { world } = await makeWorld();
    const store = new ApprovalStore(world.stateHome);
    const raisedAt = new Date("2026-08-03T00:00:00.000Z");
    const worktree = join(world.stateHome, "worktrees", "expiry-app", "op-205");
    const artifact = join(world.stateHome, "runs", "expiry-app", "turn-expiry", "evidence.txt");
    await mkdir(worktree, { recursive: true });
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(join(worktree, "candidate.txt"), "preserve candidate bytes\n", "utf8");
    await writeFile(artifact, "preserve turn evidence\n", "utf8");
    const raised = await store.raise({
      app: "expiry-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid" } },
      turnId: "turn-expiry",
      ticketRef: "#205",
      workdir: worktree,
      now: raisedAt,
    });
    writeTicketClaimState(world.stateHome, "expiry-app", 205, {
      claims: 1,
      lastClaimAt: raisedAt.toISOString(),
      outcomes: [],
      continuation: {
        pipeline: "build",
        pass: "builder",
        role: "builder",
        session: { runtime: "codex", id: "session-expiry" },
        completedPasses: [],
        contextFingerprint: "context-expiry",
        workFingerprint: "work-expiry",
        runId: "turn-expiry",
        pausedAt: raisedAt.toISOString(),
        decisions: [],
        status: "waiting_approval",
        claimNumber: 1,
        pauseCount: 1,
        pauseCostUsd: 0.25,
      },
    });

    const expiredAt = new Date(raisedAt.getTime() + DAY_MS + 1);
    const expired = await store.reconcile(expiredAt);
    expect(expired.map((item) => item.id)).toEqual([raised.id]);
    expect(await releaseExpiredTicketApprovalClaim(world.stateHome, expired[0]!, expiredAt)).toBe(true);

    const durable = (await store.show(raised.id)).item;
    assertExpiredDetector(durable);
    expect(durable).toMatchObject({
      id: raised.id,
      status: "expired",
      expiredAt: expiredAt.toISOString(),
      expiryReason: expect.stringMatching(/configured 86400000ms pending TTL/),
    });
    expect(await store.listPending()).toEqual([]);
    expect((await store.listDecided()).map((item) => item.id)).toContain(raised.id);
    expect((await store.readLog()).filter((event) => event.type === "expired")).toHaveLength(1);

    const claim = readTicketClaimState(world.stateHome, "expiry-app", 205);
    expect(claim.claims).toBe(1);
    expect(claim.continuation).toBeUndefined();
    expect(claim.outcomes.at(-1)).toMatch(/blocked.*no failure-claim consumption/);
    expect(claim.events?.at(-1)).toMatchObject({
      kind: "claim_terminal",
      claimNumber: 1,
      repeatedCostUsd: 0,
    });
    expect(await readFile(join(worktree, "candidate.txt"), "utf8")).toBe("preserve candidate bytes\n");
    expect(await readFile(artifact, "utf8")).toBe("preserve turn evidence\n");

    const verification = await verifyApp({
      orgHome: world.target,
      stateHome: world.stateHome,
      appName: "expiry-app",
      synchronize: false,
      runChecks: false,
      writeReadiness: false,
      recordEvidence: false,
      runtimeReadiness: runtimeReady,
    });
    expect(verification.checks.find((check) => check.id === "approvals")).toMatchObject({
      status: "pass",
      detail: "no pending app approvals",
    });
  });

  it("derives pending lifetime from policy configuration rather than a second source constant", async () => {
    const world = await makeInitWorld();
    worlds.push(world);
    const raisedAt = new Date("2026-08-03T00:00:00.000Z");
    const inherited = new ApprovalStore(world.stateHome, { policy: { grantTtlMs: 2 * DAY_MS } });
    const raised = await inherited.raise({
      app: "expiry-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: { command: "curl https://example.invalid" } },
      now: raisedAt,
    });

    await inherited.reconcile(new Date(raisedAt.getTime() + DAY_MS + 1));
    expect((await inherited.show(raised.id)).item.status).toBe("pending");
    await inherited.reconcile(new Date(raisedAt.getTime() + 2 * DAY_MS + 1));
    expect((await inherited.show(raised.id)).item.status).toBe("expired");
  });

  it("negative control: the detector fires on a seeded orphan that remains pending", () => {
    const pending = {
      id: "seeded-old-behavior",
      app: "expiry-app",
      role: "builder",
      rule: "outbound-network",
      action: { tool: "Bash", input: {} },
      raisedAt: "2026-08-03T00:00:00.000Z",
      status: "pending",
    } satisfies ApprovalItem;
    expect(() => assertExpiredDetector(pending)).toThrow(/remained pending/);
  });
});
