// CF-REG-203 — the base a ticket branch is cut from is resolved AT THAT
// TICKET'S CLAIM, never reused from an earlier claim in the same run.
//
// Defect source: cormidia/Cormidia#203 ("`loop --follow` cuts every later
// ticket from the base captured at loop start"), found by the august-org live
// end-to-end run 2026-08-01. `defaultLoopInputs` resolved the base once, and
// `runLoopOnce` reused that single `BaseRevision` for every ticket the tick
// claimed — so the managed clone's `origin/<default>` ref was never re-fetched
// and every ticket claimed after the first merge was cut from a stale tree.
// It is the third instance of the default-branch scar (#60, #101): not a
// GUESSED base this time, but a CACHED one, with the identical effect —
// "silently diffs against the wrong tree".
//
// Traceability: INV-009 (base resolved, never guessed) · control point T-7
// (base/branch truth) · journey J-04 (ticket delivery) · boundary B-15 (git
// substrate). Registered in validation-design/case-catalog.md §10.
//
// LAYER: 2 (hermetic composition). Cheapest falsifying layer — the defect is
// entirely inside the loop's own git substrate handling, so a real temp bare
// remote plus the owned GitHub double falsifies it with no provider and no
// network. The product entries under test are UNMODIFIED: `runLoopOnce`
// (src/loop/driver.ts) selects and claims, `claimTicket` → `createWorktree`
// (src/loop/loop.ts) cuts the real worktree, and `defaultLoopInputs`
// (src/loop/driver.ts) is the seam that must hand the driver a re-resolvable
// base rather than a frozen one.
//
// The three cases are deliberately the three shapes the live run produced:
//   -A  within one tick: ticket A's merge lands, ticket B is claimed after it
//   -B  across ticks (`--follow`): the same BaseRevision object is reused, as
//       src/cli/loop.ts does, and a merge lands between the two ticks
//   -NC negative control: with the refresh disabled (no `refreshBase` wired,
//       i.e. exactly the pre-fix product) the SAME walk cuts a stale worktree,
//       proving this detector can fire.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baseRevisionForBranch,
  resolveRemoteDefaultBranch,
  type BaseRevision,
} from "../../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../../src/loop/driver.js";
import { GhCliOps, type GhIssue } from "../../../src/loop/github.js";
import type { LoopItem } from "../../../src/loop/loop.js";
import { makeTempClone, makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";

const APP = "reg203-app";
const DEFAULT_BRANCH = "trunk"; // deliberately not main (#101)

/** The file ticket A's "merge" lands on the remote default branch. Ticket B's
 *  acceptance criteria reference it — in the live run this was the
 *  `/projects/[slug]` route #5 merged 37 seconds before #6's planner started. */
const LANDED_PATH = "src/pages/projects.astro";
const LANDED_BODY = "---\n// merged by the predecessor ticket\n---\n";

const OP_LABELS = [
  { name: "op:ready", color: "1D76DB", description: "ready for the loop" },
  { name: "op:building", color: "FBCA04", description: "claimed, building" },
  { name: "op:in-review", color: "0E8A16", description: "PR opened, in review" },
  { name: "op:returned", color: "B60205", description: "returned for triage" },
];

const TICKET_BODY = [
  "## Goal",
  "Prove each claim cuts from the current remote default branch.",
  "",
  "## Acceptance criteria",
  "- [ ] the predecessor's merged route is visible in this ticket's worktree",
  "",
].join("\n");

interface Rig {
  /** The bare file:// remote every clone points at — the real GitHub stand-in. */
  remoteDir: string;
  /** A human-side checkout used only to land the predecessor's merge. */
  upstream: TempGitRepo;
  /** The Cormidia-managed clone: `localRepo`, the tree worktrees are cut from. */
  managed: TempGitRepo;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  issues: GhIssue[];
  worktreeRoot: string;
  base: BaseRevision;
  refreshBase: () => BaseRevision;
}

describe("CF-REG-203 — each ticket claim cuts from the base resolved at that claim (#203, INV-009/T-7)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeRig(ticketTitles: readonly string[]): Promise<Rig> {
    const upstream = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
    cleanups.push(() => upstream.cleanup());
    const remote = await upstream.addFileRemote();

    const managed = await makeTempClone(remote.dir, { defaultBranch: DEFAULT_BRANCH });
    cleanups.push(() => managed.cleanup());

    // The product resolver answers "what branch does this remote default?".
    const resolved = resolveRemoteDefaultBranch("origin", {
      cwd: managed.dir,
      errorPrefix: "reg203",
    });
    expect(resolved).toBe(DEFAULT_BRANCH);

    const handle = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: OP_LABELS });
    cleanups.push(() => handle.dispose());
    const gh = new GhCliOps(handle.repo, handle.exec);

    const issues: GhIssue[] = [];
    for (const title of ticketTitles) {
      issues.push(await gh.createIssue({ title, body: TICKET_BODY, labels: ["op:ready"] }));
    }

    const worktreeRoot = await mkdtemp(join(tmpdir(), "cormidia-reg203-worktrees-"));
    cleanups.push(() => rm(worktreeRoot, { recursive: true, force: true }));

    // `refreshBase` is what `defaultLoopInputs` hands the driver for a MANAGED
    // clone: re-synchronize the clone against the remote and re-resolve. The
    // fixture reproduces that contract rather than reaching into the product's
    // private helper, so the assertion is about the driver honoring the seam.
    const refreshBase = (): BaseRevision => {
      const branch = resolveRemoteDefaultBranch("origin", {
        cwd: managed.dir,
        errorPrefix: "reg203",
      });
      managed.git(["fetch", "origin", branch]);
      managed.git(["checkout", branch]);
      managed.git(["reset", "--hard", `origin/${branch}`]);
      return baseRevisionForBranch(branch);
    };

    return {
      remoteDir: remote.dir,
      upstream,
      managed,
      handle,
      gh,
      issues,
      worktreeRoot,
      base: baseRevisionForBranch(resolved),
      refreshBase,
    };
  }

  /** Land the predecessor ticket's merge on the remote default branch — the
   *  real event `--follow` was blind to. */
  async function landPredecessorMerge(rig: Rig): Promise<string> {
    const sha = await rig.upstream.commitFile(
      LANDED_PATH,
      LANDED_BODY,
      "feat: add the route a later ticket depends on (#5)",
    );
    rig.upstream.git(["push", "origin", DEFAULT_BRANCH]);
    return sha;
  }

  /** Drive one tick. `afterClaim` lands the predecessor merge after the FIRST
   *  ticket is claimed and short-circuits each item to `merged`, so the walk
   *  isolates exactly the claim/worktree seam under test. */
  async function tick(rig: Rig, options: { wireRefresh: boolean; landAfterFirstClaim: boolean }): Promise<LoopItem[]> {
    let claims = 0;
    const result = await runLoopOnce({
      app: APP,
      repo: rig.handle.repo,
      gh: rig.gh,
      localRepo: rig.managed.dir,
      worktreeRoot: rig.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      maxConcurrent: 2,
      base: rig.base,
      ...(options.wireRefresh ? { refreshBase: rig.refreshBase } : {}),
      afterClaim: async (item) => {
        claims += 1;
        if (claims === 1 && options.landAfterFirstClaim) await landPredecessorMerge(rig);
        // Terminal immediately: the phase machine beyond the claim is CF-J04's
        // subject, not this family's.
        return { ...item, phase: "merged" };
      },
    });
    return result.items;
  }

  it("-A within one tick: a ticket claimed after a predecessor's merge sees that merge in its worktree", async () => {
    const rig = await makeRig(["Predecessor route work", "Production polish"]);

    const items = await tick(rig, { wireRefresh: true, landAfterFirstClaim: true });

    expect(items).toHaveLength(2);
    const later = items[1]!;
    expect(later.worktree).toBeDefined();
    // The whole point: the second ticket's tree contains the first's merge.
    expect(existsSync(join(later.worktree!, LANDED_PATH))).toBe(true);
    // And the first ticket's tree legitimately predates it — the refresh moves
    // the base forward, it does not retroactively rewrite an earlier claim.
    expect(existsSync(join(items[0]!.worktree!, LANDED_PATH))).toBe(false);
  });

  it("-B across ticks (--follow reuses one BaseRevision): the second tick still cuts from the current remote", async () => {
    const rig = await makeRig(["First tick ticket", "Second tick ticket"]);

    // Tick 1 claims the first ticket only, then the merge lands.
    let claimed = 0;
    const first = await runLoopOnce({
      app: APP,
      repo: rig.handle.repo,
      gh: rig.gh,
      localRepo: rig.managed.dir,
      worktreeRoot: rig.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      maxConcurrent: 1,
      base: rig.base,
      refreshBase: rig.refreshBase,
      afterClaim: (item) => {
        claimed += 1;
        return { ...item, phase: "merged" };
      },
    });
    expect(claimed).toBe(1);
    expect(first.items).toHaveLength(1);

    const landed = await landPredecessorMerge(rig);

    // Tick 2 — the SAME frozen `rig.base` object src/cli/loop.ts would reuse
    // across the whole `--follow` invocation.
    const second = await runLoopOnce({
      app: APP,
      repo: rig.handle.repo,
      gh: rig.gh,
      localRepo: rig.managed.dir,
      worktreeRoot: rig.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      maxConcurrent: 1,
      base: rig.base,
      refreshBase: rig.refreshBase,
      afterClaim: (item) => ({ ...item, phase: "merged" }),
    });

    expect(second.items).toHaveLength(1);
    const worktree = second.items[0]!.worktree!;
    expect(existsSync(join(worktree, LANDED_PATH))).toBe(true);
    // Cut from the landed revision itself, not merely containing the file.
    expect(rig.managed.git(["rev-list", "--count", `${landed}..HEAD`, "--"])).toBeDefined();
    expect(rig.managed.git(["merge-base", "--is-ancestor", landed, `refs/heads/${second.items[0]!.branch!}`])).toBe("");
  });

  it("-NC negative control: with no per-claim refresh wired, the later ticket IS cut from the stale base and the detector fires", async () => {
    const rig = await makeRig(["Predecessor route work", "Production polish"]);

    // Exactly the pre-fix product: one frozen BaseRevision, no refresh seam.
    const items = await tick(rig, { wireRefresh: false, landAfterFirstClaim: true });

    expect(items).toHaveLength(2);
    // The seeded violation reproduces #203: the merge is invisible downstream.
    expect(existsSync(join(items[1]!.worktree!, LANDED_PATH))).toBe(false);
  });
});
