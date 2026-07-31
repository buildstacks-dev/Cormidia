// CF-J04-S skeleton — op:ready → claim → scripted build → PR opened on the
// fake GitHub, labels flip only after artifacts (L2 reduced walk; HB-005c).
//
// HONEST REDUCTION (the full CF-J04-S ready→merged walk is Wave 1+): this
// skeleton drives the smallest REAL product entries that perform ready→PR —
// - selection through the real driver: `runLoopOnce(planOnly)` (src/loop/driver.ts)
//   fetches the op:ready issue from the fake and plans the claim;
// - claim accounting: `beginTicketClaim`/`markTicketClaimed`/`finishTicketClaim`
//   (src/loop/claim-recovery.ts) — the durable claim artifact is observed to
//   exist at the moment the external label flips;
// - the claim itself: `claimTicket` (src/loop/loop.ts) — label swap + real git
//   worktree cut from the base resolved by the product's own
//   `resolveRemoteDefaultBranch` (#101: default branch is "trunk", never an
//   assumed main);
// - the build: two scripted provider turns through the REAL ClaudeRuntime
//   (claude double) — a structured contract verdict parsed by the real
//   product parser (`criterionTestMapFromContractText`) and the implement
//   output committed to the ticket worktree;
// - gates → push → PR → label flip: `advanceGates` (src/loop/loop.ts) runs
//   the real gate set, pushes to a real file:// origin, and opens the PR on
//   the github-double through UNMODIFIED GhCliOps at the gh process seam.
// NOT exercised here: the EpisodePlan engine path (planTicket/executeTicketPlan),
// provider passes inside executePipeline, review/ship stages.
//
// The double models remote branch heads abstractly, so the test mirrors the
// push by setting the fake's branch tip to the worktree's exact HEAD sha —
// and the negative control seeds the OPPOSITE (a skewed remote tip) to prove
// the product's evidence-binding detector fires and the label never flips
// (INV-008: no label without its artifact).

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginTicketClaim,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
} from "../../src/loop/claim-recovery.js";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../src/loop/driver.js";
import { GhCliOps, type GhIssue } from "../../src/loop/github.js";
import {
  advanceGates,
  branchNameForIssue,
  claimTicket,
  criterionTestMapFromContractText,
  parseAcceptanceCriteria,
  type LoopItem,
} from "../../src/loop/loop.js";
import { readTicketClaimState, type TicketClaimState } from "../../src/loop/rehydrate.js";
import { claudeDouble, doubleRole, doubleTurnRequest, type ClaudeDouble } from "../fixtures/adapters/claude-double.js";
import { script } from "../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../fixtures/github-double/install.js";

const APP = "skeleton-app";
const DEFAULT_BRANCH = "trunk"; // deliberately not main (#101)

const OP_LABELS = [
  { name: "op:ready", color: "1D76DB", description: "ready for the loop" },
  { name: "op:building", color: "FBCA04", description: "claimed, building" },
  { name: "op:in-review", color: "0E8A16", description: "PR opened, in review" },
  { name: "op:returned", color: "B60205", description: "returned for triage" },
];

const TICKET_BODY = [
  "## Goal",
  "Prove the ready → PR walk end to end on owned fakes.",
  "",
  "## Acceptance criteria",
  "- [ ] delivery.md documents the skeleton walk",
  "",
].join("\n");

/** Scripted contract-pass output: a structured ContractVerdict the REAL
 *  product parser recovers the criterion→test mapping from. */
const CONTRACT_JSON = JSON.stringify({
  files: ["delivery.md"],
  approach: "Write the delivery note the ticket asks for.",
  tests: [{ criterionId: "AC1", tests: ["skeleton-j04-ready-to-pr.test.ts asserts the walk"] }],
  risks: "none — deterministic fixture walk",
  complexity: "low",
});

const DELIVERY_NOTE = "# Delivery note\n\nScripted builder output for the HB-005 skeleton walk.\n";

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

/** Mirror a real git push into the double's remote model: the fake's branch
 *  tip becomes the worktree's exact HEAD oid (install.ts models pushes via
 *  synthetic oids; the J04 walk needs the true one for evidence binding). */
function setDoubleBranchHead(handle: GithubDoubleHandle, branch: string, oid: string): void {
  const statePath = join(handle.home, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    branches: Record<string, { oid: string }>;
  };
  state.branches[branch] = { oid };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

interface Walk {
  repo: TempGitRepo;
  remoteDir: string;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  issue: GhIssue;
  branch: string;
  base: ReturnType<typeof baseRevisionForBranch>;
  worktreeRoot: string;
  runlogRoot: string;
  dbl: ClaudeDouble;
  commands: { testCommand: string };
}

describe("CF-J04-S skeleton — ready → claim → scripted build → PR on the fake GitHub (L2 reduced walk, HB-005c)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeWalk(): Promise<Walk> {
    const repo = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
    cleanups.push(() => repo.cleanup());
    const remote = await repo.addFileRemote();

    // The product resolver answers "what branch does this remote default?" —
    // never an assumed main (#101).
    const resolved = resolveRemoteDefaultBranch("origin", { cwd: repo.dir, errorPrefix: "hb005" });
    expect(resolved).toBe(DEFAULT_BRANCH);
    const base = baseRevisionForBranch(resolved);

    const handle = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: OP_LABELS });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);

    const issue = await gh.createIssue({
      title: "Skeleton delivery note",
      body: TICKET_BODY,
      labels: ["op:ready"],
    });

    const worktreeRoot = await mkdtemp(join(tmpdir(), "operon-hb005-worktrees-"));
    cleanups.push(() => rm(worktreeRoot, { recursive: true, force: true }));
    const runlogRoot = await mkdtemp(join(tmpdir(), "operon-hb005-runlog-"));
    cleanups.push(() => rm(runlogRoot, { recursive: true, force: true }));

    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-contract-1",
        outcome: script.success(CONTRACT_JSON, {
          usage: { inputTokens: 800, outputTokens: 150 },
          costUsd: 0.05,
        }),
      }),
      script.turn({
        sessionId: "sess-implement-1",
        outcome: script.success(DELIVERY_NOTE, {
          usage: { inputTokens: 1500, outputTokens: 400 },
          costUsd: 0.21,
        }),
      }),
    ]);

    return {
      repo,
      remoteDir: remote.dir,
      handle,
      gh,
      issue,
      branch: branchNameForIssue(issue),
      base,
      worktreeRoot,
      runlogRoot,
      dbl,
      commands: { testCommand: "true" },
    };
  }

  /** The scripted build: contract turn + implement turn through the real
   *  ClaudeRuntime, output committed to the ticket worktree. Returns the
   *  contract text and the commit sha. */
  async function scriptedBuild(walk: Walk, worktree: string): Promise<{ contract: string; sha: string }> {
    const hooks = { gate: () => ({ allow: true }) as const };
    const contractTurn = await walk.dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: worktree,
        role: doubleRole({ name: "builder" }),
        task: "contract pass: plan the delivery note",
      }),
      hooks,
    );
    expect(contractTurn.status).toBe("completed");
    const implementTurn = await walk.dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: worktree,
        role: doubleRole({ name: "builder" }),
        task: "implement pass: write the delivery note",
      }),
      hooks,
    );
    expect(implementTurn.status).toBe("completed");

    await writeFile(join(worktree, "delivery.md"), implementTurn.summary, "utf8");
    gitIn(worktree, "add", "--", "delivery.md");
    gitIn(worktree, "commit", "--no-gpg-sign", "-m", "build: delivery note (scripted)");
    return { contract: contractTurn.summary, sha: gitIn(worktree, "rev-parse", "HEAD") };
  }

  it("walks op:ready → op:building → gates → push → PR → op:in-review, labels flipping only after their artifacts", async () => {
    const walk = await makeWalk();
    const { gh, handle, issue } = walk;

    // Stage 0 — selection through the real driver (no mutation on a preview).
    const preview = await runLoopOnce({
      app: APP,
      repo: handle.repo,
      gh,
      localRepo: walk.repo.dir,
      worktreeRoot: walk.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: walk.commands,
      base: walk.base,
      maxConcurrent: 1,
      planOnly: true,
    });
    expect(preview.itemsPreviewed).toBe(1);
    expect(preview.lines.some((line) => line.includes("ready -> claim"))).toBe(true);
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:ready"]);
    expect(handle.callLog().some((entry) => entry.op === "issue.edit")).toBe(false);

    // Stage 1 — claim: the durable claim artifact exists BEFORE the external
    // label transition (labels never outrun the claim evidence).
    const begun = await beginTicketClaim({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      defaultAllowance: 3,
    });
    expect(begun.allowed).toBe(true);
    const lease = begun.lease!;

    let claimStateAtLabelFlip: TicketClaimState | undefined;
    let item: LoopItem = await claimTicket(issue, {
      gh,
      targetRepo: handle.repo,
      localRepo: walk.repo.dir,
      worktreeRoot: walk.worktreeRoot,
      base: walk.base,
      afterLabelTransition: () => {
        claimStateAtLabelFlip = readTicketClaimState(walk.runlogRoot, APP, issue.number);
      },
    });
    await markTicketClaimed({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      claimId: lease.claimId,
    });
    expect(claimStateAtLabelFlip?.active?.claimId).toBe(lease.claimId);
    expect(item.phase).toBe("building");
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:building"]);

    // Stage 2 — scripted build: real ClaudeRuntime turns; the contract text
    // is parsed by the REAL product parser into the criterion→test mapping.
    // The accounting commit point precedes the provider work, exactly as the
    // driver's beforeProviderTurn does — a claim consumes allowance only once
    // provider spend may have happened (CF-J04-RC).
    await markTicketProviderStarted({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      claimId: lease.claimId,
    });
    const built = await scriptedBuild(walk, item.worktree!);
    const criterionTests = criterionTestMapFromContractText(built.contract);
    expect(criterionTests).toEqual({ AC1: ["skeleton-j04-ready-to-pr.test.ts asserts the walk"] });
    setDoubleBranchHead(handle, walk.branch, built.sha); // the push, mirrored into the fake

    // Stage 3 — gates → push → PR → label flip, all product code.
    const advanced = await advanceGates(
      { ...item, contract: built.contract },
      {
        gh,
        policy: DEFAULT_LOOP_POLICY,
        commands: walk.commands,
        base: walk.base,
        criteria: parseAcceptanceCriteria(item.body),
        criterionTests,
      },
    );

    expect(advanced.phase).toBe("reviewing");
    expect(advanced.prNumber).toBeDefined();
    expect(advanced.gateResults.at(-1)?.status).toBe("pass");

    // Artifact: the branch really reached the git origin at the gated sha.
    expect(gitIn(walk.remoteDir, "rev-parse", `refs/heads/${walk.branch}`)).toBe(built.sha);

    // Artifact: the PR on the fake binds head, base, ticket, and evidence.
    const state = handle.readState();
    const pr = state.prs[String(advanced.prNumber)];
    expect(pr).toMatchObject({
      state: "OPEN",
      headRefName: walk.branch,
      headRefOid: built.sha,
      baseRefName: DEFAULT_BRANCH,
    });
    expect(pr?.closingIssueNumbers).toEqual([issue.number]);
    expect(pr?.body).toContain("<!-- operon:gate-evidence:start -->");
    expect(pr?.body).toContain(built.sha); // gate evidence bound to the exact revision

    // Label only after the artifact: the PR create precedes the op:in-review
    // flip in the fake's call log, and the final label is exactly op:in-review.
    const log = handle.callLog();
    const prCreateIdx = log.findIndex((entry) => entry.op === "pr.create");
    const inReviewIdx = log.findIndex(
      (entry) => entry.op === "issue.edit" && entry.argv.join(" ").includes("op:in-review"),
    );
    expect(prCreateIdx).toBeGreaterThanOrEqual(0);
    expect(inReviewIdx).toBeGreaterThanOrEqual(0);
    expect(prCreateIdx).toBeLessThan(inReviewIdx);
    expect(state.issues[String(issue.number)]?.labels).toEqual(["op:in-review"]);

    // Both scripted turns were consumed — the build really came from the
    // scripted adapter, and nothing over-called the double.
    expect(walk.dbl.recorder.turns).toHaveLength(2);

    // Close the claim ledger: one claim, terminal, no active lease left.
    await finishTicketClaim({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      claimId: lease.claimId,
      item: advanced,
    });
    const finalClaimState = readTicketClaimState(walk.runlogRoot, APP, issue.number);
    expect(finalClaimState.claims).toBe(1);
    expect(finalClaimState.active).toBeUndefined();
  });

  it("negative control: a skewed remote head between gates and PR — the evidence-binding detector FIRES and the label never flips", async () => {
    const walk = await makeWalk();
    const { gh, handle, issue } = walk;

    const begun = await beginTicketClaim({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      defaultAllowance: 3,
    });
    const item = await claimTicket(issue, {
      gh,
      targetRepo: handle.repo,
      localRepo: walk.repo.dir,
      worktreeRoot: walk.worktreeRoot,
      base: walk.base,
    });
    await markTicketClaimed({
      root: walk.runlogRoot,
      app: APP,
      issueNumber: issue.number,
      claimId: begun.lease!.claimId,
    });

    const built = await scriptedBuild(walk, item.worktree!);
    // SEEDED VIOLATION: the fake remote's branch tip is NOT the gated
    // revision (a rewrite/skew landed between gates and PR creation) — the
    // double invents a synthetic oid for the branch.
    handle.seedBranch(walk.branch);

    // The product detector fires: gate evidence is never published for a
    // revision the PR head does not match.
    await expect(
      advanceGates(
        { ...item, contract: built.contract },
        {
          gh,
          policy: DEFAULT_LOOP_POLICY,
          commands: walk.commands,
          base: walk.base,
          criteria: parseAcceptanceCriteria(item.body),
          criterionTests: criterionTestMapFromContractText(built.contract),
        },
      ),
    ).rejects.toThrow(/expected gated revision/);

    // And the label never outran the missing artifact binding: still
    // op:building, and no op:in-review flip ever crossed the seam.
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:building"]);
    expect(
      handle
        .callLog()
        .some((entry) => entry.op === "issue.edit" && entry.argv.join(" ").includes("op:in-review")),
    ).toBe(false);
  });
});
