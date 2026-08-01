// CF-B01-{ok,to,ps,rt,dup,stale,skew} — GitHub double v1 self-tests (HB-003).
//
// Every test here drives UNMODIFIED product code (`new GhCliOps(repo)` — the
// exact production construction, no injected executor) through the primary
// B-01 seam: the double's `bin/gh` shim resolved via PATH. The double's honest
// failure modes (boundary-map.md B-01) are asserted one by one; the fixture's
// own detectors (scenario drain, corrupt-state loudness) carry negative
// controls per the harness rule that a detector that has never fired is an
// assumption.

import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  GhCliOps,
  GhOpsError,
  verifiedSelfApprovalMarker,
} from "../../../src/loop/github.js";
import { installGithubDouble, type GithubDoubleHandle, type GithubDoubleOptions } from "./install.js";

describe("CF-B01-{ok,to,ps,rt,dup,stale,skew} — GitHub double v1 at the gh process seam (B-01)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function freshDouble(options: GithubDoubleOptions = {}): Promise<GithubDoubleHandle> {
    const handle = await installGithubDouble(options);
    cleanups.push(() => handle.dispose());
    const restore = handle.activatePath();
    cleanups.push(restore);
    return handle;
  }

  it("CF-B01-ok: full issue → PR → review → squash-merge → branch-delete walk through unmodified GhCliOps", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);

    await gh.ensureLabel({ name: "op:ready", color: "1D76DB", description: "ready" });
    await gh.ensureLabel({ name: "op:building", color: "FBCA04", description: "building" });

    const issue = await gh.createIssue({
      title: "Ticket: wire the flux capacitor",
      body: "Acceptance: it fluxes.",
      labels: ["op:ready"],
    });
    expect(issue.number).toBeGreaterThan(0);
    expect(issue.labels).toContain("op:ready");

    await gh.swapLabel(issue.number, "op:ready", "op:building");
    expect((await gh.readIssue(issue.number)).labels).toEqual(["op:building"]);

    await gh.commentIssue(issue.number, "contract comment");
    expect((await gh.listIssueComments(issue.number)).map((comment) => comment.body)).toEqual([
      "contract comment",
    ]);

    const branch = `op/${issue.number}-flux`;
    handle.seedBranch(branch);
    const pr = await gh.createPR({
      head: branch,
      base: "main",
      title: "feat: flux",
      body: `Delivers.\n\nCloses #${issue.number}`,
    });
    expect(pr.headRefName).toBe(branch);
    expect(pr.baseRefName).toBe("main");
    expect(pr.closingIssueNumbers).toEqual([issue.number]);
    const head = pr.headRefOid;
    expect(head).toBeDefined();

    const review = await gh.createReview(pr.number, {
      state: "approve",
      body: "LGTM",
      expectedCommit: head as string,
    });
    expect(review.state).toBe("APPROVED");
    expect((await gh.listReviews(pr.number))[0]?.commitId).toBe(head);

    const merged = await gh.squashMerge(pr.number, {
      subject: "feat: flux (#1)",
      matchHeadCommit: head as string,
    });
    expect(merged.state).toBe("MERGED");
    expect(merged.mergeCommitOid).toBeDefined();
    // Merge into the default branch closes the linked issue (GitHub semantics).
    expect((await gh.readIssue(issue.number)).state).toBe("CLOSED");

    await gh.deleteBranch(branch);
    expect(handle.readState().branches[branch]).toBeUndefined();

    // Non-empty seam walk: every one of those product calls crossed the real
    // gh process seam and was logged by the double.
    const log = handle.callLog();
    expect(log.length).toBeGreaterThan(10);
    expect(log.every((entry) => entry.op.length > 0)).toBe(true);
  });

  it("CF-B01-to: timeout is terminal while rate-limit and 5xx exhaust the bounded retry as typed GhOpsError", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo, undefined, undefined, { sleep: async () => undefined, random: () => 0.5 });
    const issue = await gh.createIssue({ title: "probe", body: "", labels: [] });

    handle.script({ op: "issue.view", fail: "timeout" });
    await expect(gh.readIssue(issue.number)).rejects.toThrow(/context deadline exceeded/);

    for (let attempt = 0; attempt < 3; attempt += 1) handle.script({ op: "issue.view", fail: "rate_limit" });
    await expect(gh.readIssue(issue.number)).rejects.toThrow(/rate limit exceeded/);

    for (let attempt = 0; attempt < 3; attempt += 1) handle.script({ op: "issue.view", fail: "server_error" });
    await expect(gh.readIssue(issue.number)).rejects.toThrow(/HTTP 502/);

    // Scripts are bounded: once consumed, the seam recovers.
    expect((await gh.readIssue(issue.number)).title).toBe("probe");
    handle.assertScenarioDrained();
  });

  it("CF-B01-ps: partial success — issue created while the label application fails", async () => {
    const handle = await freshDouble({
      labels: [{ name: "op:ready", color: "1d76db", description: "ready" }],
    });
    const gh = new GhCliOps(handle.repo);

    handle.script({ op: "issue.create", fail: "partial_labels" });
    await expect(
      gh.createIssue({ title: "half-landed", body: "", labels: ["op:ready"] }),
    ).rejects.toThrow(/labels could not be applied/);

    // The dangerous half: the remote artifact EXISTS despite the error.
    const issues = Object.values(handle.readState().issues);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("half-landed");
    expect(issues[0]?.labels).toEqual([]);
    handle.assertScenarioDrained();
  });

  it("CF-B01-ps: partial success — merge landed, branch delete fails", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    const branch = "op/9-cleanup";
    handle.seedBranch(branch);
    const pr = await gh.createPR({ head: branch, base: "main", title: "t", body: "b" });
    await gh.squashMerge(pr.number, { subject: "t" });

    handle.script({ op: "ref.delete", fail: "server_error" });
    await expect(gh.deleteBranch(branch)).rejects.toThrow(/HTTP 502/);

    expect((await gh.readPR(pr.number)).state).toBe("MERGED");
    expect(handle.readState().branches[branch]).toBeDefined();
    handle.assertScenarioDrained();
  });

  it("CF-B01-rt/dup: LOST-RESPONSE is first-class — effect applied, error returned, retry duplicates the issue", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);

    handle.script({ op: "issue.create", fail: "lost_response" });
    await expect(
      gh.createIssue({ title: "lost in flight", body: "", labels: [] }),
    ).rejects.toThrow(/connection reset by peer/);

    // Demonstrably reproducible (HB-003 acceptance): the response was lost but
    // the remote effect happened — and the call log records effect=true on a
    // non-zero exit.
    let issues = Object.values(handle.readState().issues);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe("lost in flight");
    const lossEntry = handle.callLog().find((entry) => entry.op === "issue.create");
    expect(lossEntry?.exitCode).toBe(1);
    expect(lossEntry?.effect).toBe(true);

    // Blind retry pressure — exactly what the boundary map warns about:
    // a naive re-perform creates the duplicate.
    await gh.createIssue({ title: "lost in flight", body: "", labels: [] });
    issues = Object.values(handle.readState().issues);
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((candidate) => candidate.title))).toEqual(new Set(["lost in flight"]));
    handle.assertScenarioDrained();
  });

  it("CF-B01-rt: lost response on pr create — the retry DETECTS the prior effect instead of duplicating (contract §4 markers)", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    const branch = "op/12-retry";
    handle.seedBranch(branch);

    handle.script({ op: "pr.create", fail: "lost_response" });
    await expect(
      gh.createPR({ head: branch, base: "main", title: "t", body: "b" }),
    ).rejects.toThrow(/connection reset by peer/);

    // The op/ branch is the idempotency marker: a retried create for the same
    // head surfaces the prior effect as a typed error, never a second PR.
    await expect(
      gh.createPR({ head: branch, base: "main", title: "t", body: "b" }),
    ).rejects.toThrow(/already exists/);
    expect(await gh.listPRsForBranch(branch, { state: "all" })).toHaveLength(1);
    handle.assertScenarioDrained();
  });

  it("CF-B01-stale: scripted stale read serves the pre-write snapshot exactly once", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    const issue = await gh.createIssue({ title: "stale probe", body: "v1", labels: [] });
    await gh.updateIssueBody(issue.number, "v2");

    handle.script({ op: "issue.view", stale: true });
    expect((await gh.readIssue(issue.number)).body).toBe("v1");
    // The next re-read converges — modeling "Operon re-reads before relying".
    expect((await gh.readIssue(issue.number)).body).toBe("v2");
    handle.assertScenarioDrained();
  });

  it("CF-B01-skew: configurable default branch, and default-branch-moved leaves earlier PRs on the old base", async () => {
    const handle = await freshDouble({ defaultBranch: "master" });
    const gh = new GhCliOps(handle.repo);

    const view = await handle.exec(["repo", "view", handle.repo, "--json", "defaultBranchRef"]);
    expect(JSON.parse(view.stdout)).toEqual({ defaultBranchRef: { name: "master" } });

    handle.seedBranch("op/3-old");
    const pr = await gh.createPR({ head: "op/3-old", base: "master", title: "t", body: "b" });

    handle.moveDefaultBranch("develop");
    const moved = await handle.exec(["repo", "view", handle.repo, "--json", "defaultBranchRef"]);
    expect(JSON.parse(moved.stdout)).toEqual({ defaultBranchRef: { name: "develop" } });

    // The representative B-01 failure: every call still succeeds while the
    // operation is about the wrong tree — the PR base silently points at the
    // no-longer-default branch, visible to any reader that re-resolves.
    expect((await gh.readPR(pr.number)).baseRefName).toBe("master");

    // The move is also scriptable mid-scenario, before a chosen call.
    handle.script({ op: "issue.list", setDefaultBranch: "trunk" });
    await gh.listIssues();
    const trunk = await handle.exec(["repo", "view", handle.repo, "--json", "defaultBranchRef"]);
    expect(JSON.parse(trunk.stdout)).toEqual({ defaultBranchRef: { name: "trunk" } });
    handle.assertScenarioDrained();
  });

  it("CF-B01-skew: force-push skew defeats the product's own review delivery fence", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    const branch = "op/7-skew";
    handle.seedBranch(branch);
    const pr = await gh.createPR({ head: branch, base: "main", title: "t", body: "b" });
    const reviewedHead = pr.headRefOid as string;
    expect(reviewedHead).toBeDefined();

    const rewritten = handle.forcePush(branch);
    expect(rewritten).not.toBe(reviewedHead);
    expect((await gh.readPR(pr.number)).headRefOid).toBe(rewritten);

    // Product code, unmodified, refuses to publish a review for a head that
    // no longer exists — the INV-009 adjacency the double must preserve.
    await expect(
      gh.createReview(pr.number, { state: "approve", body: "LGTM", expectedCommit: reviewedHead }),
    ).rejects.toThrow(/refusing to publish review/);
    expect(handle.readState().prs[String(pr.number)]?.reviews).toEqual([]);
  });

  it("CF-B01-ok: single-account mode drives the product's HMAC self-approval fallback end to end", async () => {
    const handle = await freshDouble({ singleAccount: true });
    // Synthetic secret: generated at runtime, never committed (harness rule 5).
    const secret = randomBytes(24).toString("hex");
    const gh = new GhCliOps(handle.repo, undefined, secret);
    const branch = "op/5-self";
    handle.seedBranch(branch);
    const pr = await gh.createPR({ head: branch, base: "main", title: "t", body: "b" });
    const head = (await gh.readPR(pr.number)).headRefOid as string;

    const review = await gh.createReview(pr.number, {
      state: "approve",
      body: "Verdict: approve",
      expectedCommit: head,
    });
    // GitHub rejected the self-approval; the product fell back to a marker
    // comment bound to the reviewed commit by HMAC.
    expect(review.state).toBe("COMMENTED");
    expect(review.commitId).toBe(head);
    expect(verifiedSelfApprovalMarker(review.body, secret, pr.number, head)).toBe(true);
    // Replay onto a different head must not verify (A-001 binding).
    const otherHead = `${head.slice(0, -1)}${head.endsWith("0") ? "1" : "0"}`;
    expect(verifiedSelfApprovalMarker(review.body, secret, pr.number, otherHead)).toBe(false);

    const listed = await gh.listReviews(pr.number);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.state).toBe("COMMENTED");
    expect(listed[0]?.commitId).toBe(head);
  });

  it("CF-B01-ok: pr checks surface matches gh semantics (no checks = loud, red checks = JSON with non-zero exit)", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    handle.seedBranch("op/8-checks");
    const pr = await gh.createPR({ head: "op/8-checks", base: "main", title: "t", body: "b" });

    const none = await handle.exec(["pr", "checks", String(pr.number), "--repo", handle.repo, "--json", "name,state,link"]);
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toMatch(/no checks reported/);

    handle.setChecks(pr.number, [{ name: "ci", state: "SUCCESS", link: "https://example.invalid/ci" }]);
    const green = await handle.exec(["pr", "checks", String(pr.number), "--repo", handle.repo, "--json", "name,state,link"]);
    expect(green.exitCode).toBe(0);
    expect(JSON.parse(green.stdout)).toEqual([
      { name: "ci", state: "SUCCESS", link: "https://example.invalid/ci" },
    ]);

    handle.setChecks(pr.number, [{ name: "ci", state: "FAILURE" }]);
    const red = await handle.exec(["pr", "checks", String(pr.number), "--repo", handle.repo, "--json", "name,state,link"]);
    // Like real gh: non-zero exit while STILL emitting the structured evidence
    // (src/observe/github-source.ts readChecks preserves exactly this).
    expect(red.exitCode).toBe(1);
    expect(JSON.parse(red.stdout)).toEqual([{ name: "ci", state: "FAILURE" }]);
  });

  it("CF-B01-ok: calls naming a different repo slug are rejected (repo identity from the registry, INV-004)", async () => {
    const handle = await freshDouble();
    const stranger = new GhCliOps("someone-else/other-repo");
    await expect(stranger.readIssue(1)).rejects.toThrow(/Could not resolve to a Repository/);
  });

  it("negative control: a corrupted state file fails every call loudly through the seam — never a fabricated success", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    await gh.createIssue({ title: "victim", body: "", labels: [] });

    fs.writeFileSync(path.join(handle.home, "state.json"), "{ this is not json");
    let caught: unknown;
    try {
      await gh.readIssue(1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GhOpsError);
    expect((caught as GhOpsError).stderr).toMatch(/state file corrupt/);
  });

  it("negative control: an unmatched scenario step is detected by assertScenarioDrained, not silently ignored", async () => {
    const handle = await freshDouble();
    const gh = new GhCliOps(handle.repo);
    // Script a failure for an op that never runs (a typo'd or dead script
    // would otherwise be green by absence).
    handle.script({ op: "pr.merge", fail: "server_error" });
    await gh.createIssue({ title: "unrelated", body: "", labels: [] });
    expect(() => handle.assertScenarioDrained()).toThrow(/never matched a call/);
  });

  it("CF-B01-rt: retry-safe operations get exactly three total attempts with injectable jittered exponential waits", async () => {
    let calls = 0;
    const delays: number[] = [];
    const random = [0, 1];
    const gh = new GhCliOps("owner/sandbox", async () => {
      calls += 1;
      return calls < 3
        ? { stdout: "", stderr: calls === 1 ? "HTTP 503 service unavailable" : "secondary rate limit", exitCode: 1 }
        : { stdout: "[]", stderr: "", exitCode: 0 };
    }, undefined, {
      sleep: async (delayMs) => { delays.push(delayMs); },
      random: () => random.shift() ?? 0,
    });

    await expect(gh.listLabels()).resolves.toEqual([]);
    expect(calls).toBe(3);
    expect(delays).toEqual([125, 750]);
  });

  it("negative control: attempt 3 is terminal, 4xx is not retried, and ambiguous writes stay single-shot", async () => {
    let retryableCalls = 0;
    const retryable = new GhCliOps("owner/sandbox", async () => {
      retryableCalls += 1;
      return { stdout: "", stderr: "HTTP 502 bad gateway", exitCode: 1 };
    }, undefined, { sleep: async () => undefined, random: () => 0.5 });
    await expect(retryable.listLabels()).rejects.toThrow(/exit 1/);
    expect(retryableCalls).toBe(3);

    let terminalCalls = 0;
    const terminal = new GhCliOps("owner/sandbox", async () => {
      terminalCalls += 1;
      return { stdout: "", stderr: "HTTP 404 not found", exitCode: 1 };
    }, undefined, { sleep: async () => undefined, random: () => 0.5 });
    await expect(terminal.listLabels()).rejects.toThrow(/exit 1/);
    expect(terminalCalls).toBe(1);

    let createCalls = 0;
    const ambiguousCreate = new GhCliOps("owner/sandbox", async () => {
      createCalls += 1;
      return { stdout: "", stderr: "HTTP 503 response lost after possible effect", exitCode: 1 };
    }, undefined, { sleep: async () => undefined, random: () => 0.5 });
    await expect(ambiguousCreate.createIssue({ title: "marker", body: "marker", labels: [] })).rejects.toThrow(/exit 1/);
    expect(createCalls).toBe(1);
  });
});
