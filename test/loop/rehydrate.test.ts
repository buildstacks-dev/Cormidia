// Tests ticket-lifetime rehydration in src/loop/rehydrate.ts (Stage 2 of
// docs/proportionality-review.md).
// Covers contract marker/hash reuse and invalidation, the findings ledger
// (raise/resolve/reopen/silent-drop semantics), review-cycle counting, open-PR
// detection, cross-claim state persistence, and the parked digest.
// Uses FakeGhOps and temp dirs; no network, auth, real GitHub state, or
// wall-clock time is required.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contractMarker,
  hashTicketBody,
  openFindings,
  parkedDigestComment,
  readTicketClaimState,
  rehydrateTicketState,
  renderFixResolutionsComment,
  ticketStatePath,
  writeTicketClaimState,
} from "../../src/loop/rehydrate.js";
import type { Finding } from "../../src/loop/verdicts.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

const BODY = "## Goal\nShip the fixture.\n\n## Acceptance criteria\n- [ ] works\n";

function finding(location: string, description = "missing coverage"): Finding {
  return { category: "testing", severity: "major", location, description, action: "add the regression" };
}

const VERDICT_COMMENT = (lines: string[]) =>
  ["## Structured review verdict", "", ...lines, "Verdict: findings"].join("\n");

describe("contract reuse", () => {
  it("hash is stable under CRLF and trailing-whitespace churn", () => {
    expect(hashTicketBody("a\r\nb\n\n")).toBe(hashTicketBody("a\nb"));
    expect(hashTicketBody("a\nb")).not.toBe(hashTicketBody("a\nc"));
  });

  it("rehydrates a contract whose marker matches the current body", async () => {
    const gh = new FakeGhOps({ issues: [{ number: 1, title: "T", body: BODY, labels: ["op:ready"] }] });
    const contract = `## Implementation contract\n\nstuff\n\n${contractMarker(hashTicketBody(BODY))}`;
    await gh.commentIssue(1, contract);

    const state = await rehydrateTicketState({ issueNumber: 1, body: BODY }, { gh, branch: "op/1-t" });
    expect(state.contract).toBe(contract);
    expect(state.cycles).toBe(0);
  });

  it("re-derives when the ticket body changed since the contract", async () => {
    const gh = new FakeGhOps({ issues: [{ number: 1, title: "T", body: BODY, labels: ["op:ready"] }] });
    await gh.commentIssue(1, `contract\n\n${contractMarker(hashTicketBody("older body"))}`);

    const state = await rehydrateTicketState({ issueNumber: 1, body: BODY }, { gh, branch: "op/1-t" });
    expect(state.contract).toBeUndefined();
  });

  it("the latest contract comment wins, even when stale (no fallback to older)", async () => {
    const gh = new FakeGhOps({ issues: [{ number: 1, title: "T", body: BODY, labels: ["op:ready"] }] });
    await gh.commentIssue(1, `good\n\n${contractMarker(hashTicketBody(BODY))}`);
    await gh.commentIssue(1, `stale\n\n${contractMarker(hashTicketBody("edited body"))}`);

    const state = await rehydrateTicketState({ issueNumber: 1, body: BODY }, { gh, branch: "op/1-t" });
    // The newer contract superseded the older one; its staleness means
    // re-derive — resurrecting the superseded contract would be wrong.
    expect(state.contract).toBeUndefined();
  });
});

describe("findings ledger", () => {
  it("a resolution closes a finding; a later round re-raising it reopens it", () => {
    const open = openFindings([
      { kind: "raise", findings: [finding("src/a.ts:1"), finding("src/b.ts:2")] },
      { kind: "resolve", resolutions: [{ outcome: "fixed", location: "src/a.ts:1", note: "commit abc" }] },
      { kind: "raise", findings: [finding("src/a.ts:1", "regressed again")] },
    ]);
    expect(open.map((f) => f.location).sort()).toEqual(["src/a.ts:1", "src/b.ts:2"]);
    expect(open.find((f) => f.location === "src/a.ts:1")?.description).toBe("regressed again");
  });

  it("a finding a later round silently drops stays open (the episode's lost finding)", () => {
    const open = openFindings([
      { kind: "raise", findings: [finding("ci.yml:4", "pin actions to immutable SHAs")] },
      { kind: "raise", findings: [finding("src/new.ts:9", "different finding")] },
    ]);
    expect(open).toHaveLength(2);
  });

  it("rebuttals close findings just like fixes", () => {
    const open = openFindings([
      { kind: "raise", findings: [finding("src/a.ts:1")] },
      { kind: "resolve", resolutions: [{ outcome: "rebutted", location: "src/a.ts:1", note: "spec says so" }] },
    ]);
    expect(open).toHaveLength(0);
  });
});

describe("rehydrateTicketState", () => {
  it("merges verdict rounds and fix resolutions from durable comments, counts cycles, finds the PR", async () => {
    const gh = new FakeGhOps({ issues: [{ number: 2, title: "T", body: BODY, labels: ["op:ready"] }] });
    await gh.commentIssue(2, VERDICT_COMMENT([
      "- testing/major src/a.ts:1 -- missing coverage -> add the regression",
      "- security/critical ci.yml:4 -- mutable action tags -> pin to SHAs",
    ]));
    await gh.commentIssue(2, renderFixResolutionsComment([
      { outcome: "fixed", location: "src/a.ts:1", note: "commit abc + test" },
    ]));
    await gh.commentIssue(2, VERDICT_COMMENT([
      "- testing/minor src/c.ts:7 -- flaky sleep -> use fake clock",
    ]));
    const pr = await gh.createPR({ head: "op/2-t", base: "main", title: "t", body: "b", draft: false });

    const state = await rehydrateTicketState({ issueNumber: 2, body: BODY }, { gh, branch: "op/2-t" });
    expect(state.cycles).toBe(2);
    expect(state.prNumber).toBe(pr.number);
    // a.ts fixed; ci.yml silently dropped by round 2 → still open; c.ts new.
    expect(state.findings.map((f) => f.location).sort()).toEqual(["ci.yml:4", "src/c.ts:7"]);
  });
});

describe("cross-claim state", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("round-trips claims and outcomes; tolerates a torn file", () => {
    root = mkdtempSync(join(tmpdir(), "operon-rehydrate-"));
    expect(readTicketClaimState(root, "app", 5)).toEqual({ claims: 0, outcomes: [] });

    writeTicketClaimState(root, "app", 5, { claims: 2, lastClaimAt: "2026-07-10T10:00:00Z", outcomes: ["claim 1: ended returned"] });
    expect(readTicketClaimState(root, "app", 5)).toMatchObject({ claims: 2, outcomes: ["claim 1: ended returned"] });

    const path = ticketStatePath(root, "app", 6);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{torn", "utf8");
    expect(() => readTicketClaimState(root, "app", 6)).toThrow("ticket claim state is unreadable");
  });
});

describe("parkedDigestComment", () => {
  it("assembles the evidence a human needs: claims, outcomes, PR, open findings", () => {
    const digest = parkedDigestComment({
      app: "marketplace",
      issueNumber: 42,
      claims: 3,
      maxClaims: 3,
      outcomes: ["claim 1: ended returned", "claim 2: ended blocked (PR #23)"],
      prNumber: 23,
      openFindings: [finding("ci.yml:4", "pin actions to immutable SHAs")],
      hasContract: true,
    });
    expect(digest).toContain("## Parked after 3 claims");
    expect(digest).toContain("claim 2: ended blocked (PR #23)");
    expect(digest).toContain("**Open PR:** #23");
    expect(digest).toContain("ci.yml:4 — pin actions to immutable SHAs");
    expect(digest).toContain("derived and still applicable");
  });
});
