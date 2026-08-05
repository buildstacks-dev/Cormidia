// CF-C-B01 — GitHub surface conformance suite (HB-003; contract
// CORMIDIA-C-B01-001; defends INV-008/INV-009 adjacency at the B-01 seam).
//
// ONE suite, TWO targets (boundary-map honest-fake rule: "one conformance
// suite runs against both fake and real dependency to prevent drift"):
//
//  - NOW (L2): the github-double via `makeGithubDoubleSurface` — see
//    conformance/double-surface.ts and cf-c-b01-conformance.test.ts.
//  - LATER (L3, CF-B01-L3 / HB-052): the real `gh` CLI on a sandbox repo. The
//    live wave supplies its own `GithubConformanceSurface` — `ops` is a plain
//    `new GhCliOps(sandboxSlug)` with real auth, `resolveDefaultBranch` reads
//    `gh repo view <slug> --json defaultBranchRef`, and `prepareBranch` /
//    `advanceBranch` push real commits from a sandbox clone. Nothing in this
//    file may depend on double-only powers (scripting, state files), so that
//    wiring needs no changes here.
//
// The suite is deliberately NOT a vitest file: it uses node:assert and returns
// a structured report so (a) the live campaign runner can execute it outside
// the per-commit lane, and (b) negative controls can assert that a lying fake
// FAILS it without wrapping vitest reporters.
//
// Read-back tolerance: the B-01 contract promises no per-entity
// read-after-write ("Cormidia re-reads before relying"). `readBackAttempts`
// exists for the real target's propagation delays; the fake runs with the
// strict default of 1 so it can never hide behind retries.

import assert from "node:assert/strict";

import type { GhOps } from "../../../../src/loop/github.js";

export interface GithubConformanceSurface {
  /** Human-readable target name for the report (e.g. "github-double:owner/repo"). */
  readonly label: string;
  /** The product client, running unmodified against the target. */
  readonly ops: GhOps;
  /** Ground truth default branch as the backend reports it. */
  resolveDefaultBranch(): Promise<string>;
  /** Create a fresh branch (with at least one commit on the real target) off
   *  the default tip; returns the branch name and its head oid. */
  prepareBranch(prefix: string): Promise<{ branch: string; headOid: string }>;
  /** Push one more commit to the branch; returns the new head oid. */
  advanceBranch(branch: string): Promise<string>;
}

export interface GithubConformanceOptions {
  /** Run only clauses the filter admits. An empty selection is an ERROR, not
   *  a pass (no green by absence). */
  clauseFilter?: (id: string) => boolean;
  /** Attempts for read-back assertions (default 1: strict; live may raise). */
  readBackAttempts?: number;
  readBackDelayMs?: number;
  labelSearchReadBackDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export interface ConformanceClauseFailure {
  id: string;
  name: string;
  classification: "violation" | "observation_inconclusive";
  code: string;
  error: string;
}

export interface GithubConformanceReport {
  target: string;
  total: number;
  passed: string[];
  failures: ConformanceClauseFailure[];
}

interface ClauseContext {
  surface: GithubConformanceSurface;
  ops: GhOps;
  tag: string;
  /** Retry `fn` up to readBackAttempts times for eventually-visible reads. */
  eventually<T>(fn: () => Promise<T>, delayMs?: number): Promise<T>;
  labelSearchReadBackDelayMs: number;
}

interface Clause {
  id: string;
  name: string;
  run(ctx: ClauseContext): Promise<void>;
}

class ObservationInconclusiveError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ObservationInconclusiveError";
  }
}

async function ensureConformanceLabel(ctx: ClauseContext, suffix: string): Promise<string> {
  const name = `op-conf-${ctx.tag}-${suffix}`;
  await ctx.ops.ensureLabel({ name, color: "1D76DB", description: "conformance" });
  return name;
}

async function openPrOnFreshBranch(
  ctx: ClauseContext,
  prefix: string,
  body: string,
): Promise<{ branch: string; headOid: string; prNumber: number }> {
  const base = await ctx.surface.resolveDefaultBranch();
  const { branch, headOid } = await ctx.surface.prepareBranch(prefix);
  const pr = await ctx.ops.createPR({
    head: branch,
    base,
    title: `Conformance ${prefix} ${ctx.tag}`,
    body,
  });
  return { branch, headOid, prNumber: pr.number };
}

const CLAUSES: Clause[] = [
  {
    id: "B01-CF-01",
    name: "ensureLabel is idempotent create-or-update, visible in listLabels",
    async run(ctx) {
      const name = `op-conf-${ctx.tag}-01`;
      await ctx.ops.ensureLabel({ name, color: "1D76DB", description: "conformance v1" });
      let found = (await ctx.ops.listLabels()).filter((label) => label.name === name);
      assert.equal(found.length, 1, `expected exactly one label ${name}`);
      await ctx.ops.ensureLabel({ name, color: "B60205", description: "conformance v2" });
      found = (await ctx.ops.listLabels()).filter((label) => label.name === name);
      assert.equal(found.length, 1, "re-ensure must update in place, never duplicate");
      assert.equal(found[0]?.color.toLowerCase(), "b60205");
      assert.equal(found[0]?.description, "conformance v2");
    },
  },
  {
    id: "B01-CF-02",
    name: "createIssue returns the created artifact identity and round-trips",
    async run(ctx) {
      const label = await ensureConformanceLabel(ctx, "02");
      const issue = await ctx.ops.createIssue({
        title: `Conformance issue ${ctx.tag}`,
        body: `body ${ctx.tag}`,
        labels: [label],
      });
      assert.ok(issue.number > 0, "created issue must carry its number (artifact-before-label, INV-008)");
      const reread = await ctx.eventually(async () => {
        const got = await ctx.ops.readIssue(issue.number);
        assert.equal(got.title, `Conformance issue ${ctx.tag}`);
        assert.equal(got.body, `body ${ctx.tag}`);
        assert.ok(got.labels.includes(label), "label applied at create");
        assert.equal(got.state, "OPEN");
        return got;
      });
      try {
        await ctx.eventually(async () => {
          const listed = await ctx.ops.listIssues({ labels: [label], state: "open" });
          assert.ok(
            listed.some((candidate) => candidate.number === reread.number),
            "label-filtered listIssues must find the created issue",
          );
        }, ctx.labelSearchReadBackDelayMs);
      } catch (error) {
        throw new ObservationInconclusiveError(
          "label_filtered_issue_search_not_observed",
          `bounded label-filtered search observation exhausted: ${errorMessage(error)}`,
        );
      }
    },
  },
  {
    id: "B01-CF-03",
    name: "label flips are idempotent (add twice, remove twice, swap)",
    async run(ctx) {
      const labelA = await ensureConformanceLabel(ctx, "03a");
      const labelB = await ensureConformanceLabel(ctx, "03b");
      const issue = await ctx.ops.createIssue({
        title: `Conformance flips ${ctx.tag}`,
        body: "",
        labels: [],
      });
      await ctx.ops.addLabel(issue.number, labelA);
      await ctx.ops.addLabel(issue.number, labelA);
      let got = await ctx.eventually(() => ctx.ops.readIssue(issue.number));
      assert.equal(got.labels.filter((name) => name === labelA).length, 1, "double add stays single");
      await ctx.ops.swapLabel(issue.number, labelA, labelB);
      got = await ctx.eventually(() => ctx.ops.readIssue(issue.number));
      assert.ok(!got.labels.includes(labelA), "swap removed the old label");
      assert.ok(got.labels.includes(labelB), "swap added the new label");
      await ctx.ops.removeLabel(issue.number, labelB);
      await ctx.ops.removeLabel(issue.number, labelB);
      got = await ctx.eventually(() => ctx.ops.readIssue(issue.number));
      assert.ok(!got.labels.includes(labelB), "double remove stays removed");
    },
  },
  {
    id: "B01-CF-04",
    name: "issue comments round-trip oldest-first",
    async run(ctx) {
      const issue = await ctx.ops.createIssue({
        title: `Conformance comments ${ctx.tag}`,
        body: "",
        labels: [],
      });
      await ctx.ops.commentIssue(issue.number, `first ${ctx.tag}`);
      await ctx.ops.commentIssue(issue.number, `second ${ctx.tag}`);
      await ctx.eventually(async () => {
        const comments = await ctx.ops.listIssueComments(issue.number);
        const ours = comments.map((comment) => comment.body).filter((body) => body.includes(ctx.tag));
        assert.deepEqual(ours, [`first ${ctx.tag}`, `second ${ctx.tag}`], "oldest first");
      });
    },
  },
  {
    id: "B01-CF-05",
    name: "updateIssueBody is visible on re-read",
    async run(ctx) {
      const issue = await ctx.ops.createIssue({
        title: `Conformance body ${ctx.tag}`,
        body: "before",
        labels: [],
      });
      await ctx.ops.updateIssueBody(issue.number, `after ${ctx.tag}`);
      await ctx.eventually(async () => {
        assert.equal((await ctx.ops.readIssue(issue.number)).body, `after ${ctx.tag}`);
      });
    },
  },
  {
    id: "B01-CF-06",
    name: "createPR lands on the RESOLVED default base with closing references",
    async run(ctx) {
      const issue = await ctx.ops.createIssue({
        title: `Conformance linked ${ctx.tag}`,
        body: "",
        labels: [],
      });
      const base = await ctx.surface.resolveDefaultBranch();
      const { branch, headOid } = await ctx.surface.prepareBranch("conf06");
      const pr = await ctx.ops.createPR({
        head: branch,
        base,
        title: `Conformance PR ${ctx.tag}`,
        body: `Conformance.\n\nCloses #${issue.number}`,
      });
      assert.ok(pr.number > 0);
      assert.equal(pr.headRefName, branch);
      assert.equal(pr.baseRefName, base, "base must be the backend-resolved default, never a guess (INV-009)");
      await ctx.eventually(async () => {
        const got = await ctx.ops.readPR(pr.number);
        assert.equal(got.headRefOid, headOid, "PR head must be the pushed commit");
        assert.ok(
          (got.closingIssueNumbers ?? []).includes(issue.number),
          "explicit closing reference must be reported",
        );
      });
      const forBranch = await ctx.ops.listPRsForBranch(branch);
      assert.ok(forBranch.some((candidate) => candidate.number === pr.number));
    },
  },
  {
    id: "B01-CF-07",
    name: "a duplicate PR create for the same head is detectable, not silent",
    async run(ctx) {
      const { branch } = await openPrOnFreshBranch(ctx, "conf07", "Conformance.");
      const base = await ctx.surface.resolveDefaultBranch();
      await assert.rejects(
        ctx.ops.createPR({ head: branch, base, title: `dup ${ctx.tag}`, body: "dup" }),
        "second create for the same head must surface the prior effect (contract §4)",
      );
      const all = await ctx.ops.listPRsForBranch(branch, { state: "all" });
      assert.equal(all.length, 1, "retry pressure must not duplicate the PR");
    },
  },
  {
    id: "B01-CF-08",
    name: "review delivery fence refuses a stale head BEFORE any write",
    async run(ctx) {
      const { branch, headOid, prNumber } = await openPrOnFreshBranch(ctx, "conf08", "Conformance.");
      const moved = await ctx.surface.advanceBranch(branch);
      assert.notEqual(moved, headOid);
      await assert.rejects(
        ctx.ops.createReview(prNumber, {
          state: "comment",
          body: `stale fence ${ctx.tag}`,
          expectedCommit: headOid,
        }),
        /refusing to publish review/,
      );
      const reviews = await ctx.ops.listReviews(prNumber);
      assert.equal(
        reviews.filter((review) => review.body.includes(ctx.tag)).length,
        0,
        "refusal must happen before any write (contract §1)",
      );
    },
  },
  {
    id: "B01-CF-09",
    name: "a published review is bound to the reviewed commit",
    async run(ctx) {
      const { prNumber } = await openPrOnFreshBranch(ctx, "conf09", "Conformance.");
      const head = (await ctx.ops.readPR(prNumber)).headRefOid;
      assert.ok(head !== undefined, "target must report headRefOid");
      const review = await ctx.ops.createReview(prNumber, {
        state: "approve",
        body: `LGTM ${ctx.tag}`,
        expectedCommit: head,
      });
      // Single-account targets fall back to a marker comment (state COMMENTED);
      // either way the review must be commit-bound and land at the head.
      assert.ok(review.state === "APPROVED" || review.state === "COMMENTED");
      assert.equal(review.commitId, head);
      await ctx.eventually(async () => {
        const reviews = await ctx.ops.listReviews(prNumber);
        const ours = reviews.find((candidate) => candidate.body.includes(ctx.tag));
        assert.ok(ours !== undefined, "review must be listed on re-read");
        assert.equal(ours.commitId, head, "backend stamps the review at the reviewed head");
      });
    },
  },
  {
    id: "B01-CF-10",
    name: "squash merge refuses a stale match-head precondition without merging",
    async run(ctx) {
      const { branch, headOid, prNumber } = await openPrOnFreshBranch(ctx, "conf10", "Conformance.");
      await ctx.surface.advanceBranch(branch);
      await assert.rejects(
        ctx.ops.squashMerge(prNumber, { subject: `stale merge ${ctx.tag}`, matchHeadCommit: headOid }),
        "merge preconditions must be verified at each attempt (contract §4, INV-009)",
      );
      const got = await ctx.ops.readPR(prNumber);
      assert.equal(got.state, "OPEN", "refused merge must leave the PR unmerged");
    },
  },
  {
    id: "B01-CF-11",
    name: "squash merge is recorded: MERGED + merge commit on re-read",
    async run(ctx) {
      const { prNumber } = await openPrOnFreshBranch(ctx, "conf11", "Conformance.");
      const head = (await ctx.ops.readPR(prNumber)).headRefOid;
      assert.ok(head !== undefined);
      const merged = await ctx.ops.squashMerge(prNumber, {
        subject: `Conformance merge ${ctx.tag}`,
        matchHeadCommit: head,
      });
      assert.equal(merged.state, "MERGED", "merge success must be RECORDED, not just reported");
      assert.ok(merged.mergeCommitOid !== undefined, "merge must expose the merge commit identity");
      await ctx.eventually(async () => {
        const got = await ctx.ops.readPR(prNumber);
        assert.equal(got.state, "MERGED");
        assert.ok(got.mergeCommitOid !== undefined);
      });
    },
  },
  {
    id: "B01-CF-12",
    name: "merging into the true default branch closes the linked issue",
    async run(ctx) {
      const issue = await ctx.ops.createIssue({
        title: `Conformance close-on-merge ${ctx.tag}`,
        body: "",
        labels: [],
      });
      const { prNumber } = await openPrOnFreshBranch(ctx, "conf12", `Closes #${issue.number}`);
      const head = (await ctx.ops.readPR(prNumber)).headRefOid;
      assert.ok(head !== undefined);
      await ctx.ops.squashMerge(prNumber, { subject: `close ${ctx.tag}`, matchHeadCommit: head });
      // Cross-check that catches a wrong-default-branch liar: GitHub closes
      // linked issues ONLY for merges into the actual default branch, so a
      // surface reporting a bogus default fails here semantically.
      await ctx.eventually(async () => {
        assert.equal(
          (await ctx.ops.readIssue(issue.number)).state,
          "CLOSED",
          "merge into the reported default did not close the linked issue — the reported default branch is not the real one",
        );
      });
    },
  },
  {
    id: "B01-CF-13",
    name: "post-merge branch delete succeeds once, then errors typed",
    async run(ctx) {
      const { branch, prNumber } = await openPrOnFreshBranch(ctx, "conf13", "Conformance.");
      const head = (await ctx.ops.readPR(prNumber)).headRefOid;
      assert.ok(head !== undefined);
      await ctx.ops.squashMerge(prNumber, { subject: `pre-delete ${ctx.tag}`, matchHeadCommit: head });
      await ctx.ops.deleteBranch(branch);
      await assert.rejects(
        ctx.ops.deleteBranch(branch),
        "deleting a missing ref must be a typed terminal error (contract §1)",
      );
    },
  },
  {
    id: "B01-CF-14",
    name: "unknown entities are typed terminal errors",
    async run(ctx) {
      await assert.rejects(ctx.ops.readIssue(99_999_983));
      await assert.rejects(ctx.ops.readPR(99_999_983));
    },
  },
  {
    id: "B01-CF-15",
    name: "closePullRequest is visible on re-read",
    async run(ctx) {
      const { prNumber } = await openPrOnFreshBranch(ctx, "conf15", "Conformance.");
      await ctx.ops.closePullRequest(prNumber);
      await ctx.eventually(async () => {
        assert.equal((await ctx.ops.readPR(prNumber)).state, "CLOSED");
      });
    },
  },
];

/** Total clause count, exported so callers can assert the walk size instead of
 *  trusting a green-by-absence zero. */
export const GITHUB_CONFORMANCE_CLAUSE_COUNT = CLAUSES.length;

let runSeq = 0;

export async function runGithubConformance(
  surface: GithubConformanceSurface,
  options: GithubConformanceOptions = {},
): Promise<GithubConformanceReport> {
  const filter = options.clauseFilter ?? (() => true);
  const selected = CLAUSES.filter((clause) => filter(clause.id));
  if (selected.length === 0) {
    throw new Error(
      "github conformance: empty clause walk — refusing to report a result over zero clauses",
    );
  }
  const attempts = Math.max(1, options.readBackAttempts ?? 1);
  const delayMs = options.readBackDelayMs ?? 250;
  const labelSearchReadBackDelayMs = options.labelSearchReadBackDelayMs ?? delayMs;
  const wait = options.wait ?? (async (durationMs: number) => {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  });
  const passed: string[] = [];
  const failures: ConformanceClauseFailure[] = [];
  for (const clause of selected) {
    runSeq += 1;
    const tag = `${Date.now().toString(36)}-${runSeq}`;
    const ctx: ClauseContext = {
      surface,
      ops: surface.ops,
      tag,
      labelSearchReadBackDelayMs,
      async eventually<T>(fn: () => Promise<T>, overrideDelayMs?: number): Promise<T> {
        let lastError: unknown;
        const activeDelayMs = overrideDelayMs ?? delayMs;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            return await fn();
          } catch (error) {
            lastError = error;
            if (attempt + 1 < attempts) {
              await wait(activeDelayMs);
            }
          }
        }
        throw lastError;
      },
    };
    try {
      await clause.run(ctx);
      passed.push(clause.id);
    } catch (error) {
      failures.push({
        id: clause.id,
        name: clause.name,
        classification: error instanceof ObservationInconclusiveError
          ? "observation_inconclusive"
          : "violation",
        code: error instanceof ObservationInconclusiveError ? error.code : "assertion_failed",
        error: errorMessage(error),
      });
    }
  }
  return { target: surface.label, total: selected.length, passed, failures };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
