// Traceability: CF-J04-S · HB-005; CF-J04-R · HB-031; CF-J04-I · HB-023; CF-J04-A · HB-103; CF-INV-005 · HB-021; CF-INV-016 · HB-100; CF-C-OPLOOP · HB-103 · contracts/journey-acceptance.md J-04; invariants.md INV-005/016; contracts/OP-loop.md.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GhIssue, GhOps } from "../../../src/loop/github.js";
import { claimDeliveryUnitIssues, claimTicket, deliveryUnitClosingReferences } from "../../../src/loop/loop.js";
import { stableHash } from "../../../src/loop/episode-plan.js";
import { issueContentHash } from "../../../src/loop/issue-snapshot.js";
import type { LoopDeliveryUnit } from "../../../src/loop/types.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("HB-103 — delivery-unit loop atomicity", () => {
  it("claims two members into one branch/PR projection and preserves the one-member branch", async () => {
    const repo = await repository();
    const worktrees = await temporaryDirectory();
    const gh = new UnitGh([issue(31), issue(32), issue(33)]);
    const unit = deliveryUnit("cohesive-change", [31, 32]);
    const item = await claimDeliveryUnitIssues([issue(31), issue(32)], {
      gh: gh as unknown as GhOps,
      targetRepo: "fixture/repo",
      localRepo: repo.dir,
      worktreeRoot: worktrees,
      base: { ref: "HEAD", defaultBranch: repo.defaultBranch },
      unit,
    });

    expect(item.branch).toBe(`op/unit-cohesive-change-${unit.membershipHash.slice(0, 12)}`);
    expect(item.deliveryUnit?.members.map((member) => member.issueNumber)).toEqual([31, 32]);
    expect(deliveryUnitClosingReferences(item)).toEqual(["Closes #31", "Closes #32"]);
    expect(gh.labels(31)).toContain("op:building");
    expect(gh.labels(32)).toContain("op:building");
    const compatible = await claimTicket(issue(33), {
      gh: gh as unknown as GhOps,
      targetRepo: "fixture/repo",
      localRepo: repo.dir,
      worktreeRoot: worktrees,
      base: { ref: "HEAD", defaultBranch: repo.defaultBranch },
    });
    expect(compatible.branch).toBe("op/33-member-33");
    expect(deliveryUnitClosingReferences(compatible)).toEqual(["Closes #33"]);
  });

  it("rolls every member back when a seeded subset label transition fails", async () => {
    const repo = await repository();
    const worktrees = await temporaryDirectory();
    const gh = new UnitGh([issue(41), issue(42)]);
    gh.failNextSwapFor = 42;
    await expect(
      claimDeliveryUnitIssues([issue(41), issue(42)], {
        gh: gh as unknown as GhOps,
        targetRepo: "fixture/repo",
        localRepo: repo.dir,
        worktreeRoot: worktrees,
        base: { ref: "HEAD", defaultBranch: repo.defaultBranch },
        unit: deliveryUnit("seeded-subset-failure", [41, 42]),
      }),
    ).rejects.toThrow("seeded label failure");

    expect(gh.labels(41)).toContain("op:ready");
    expect(gh.labels(41)).not.toContain("op:building");
    expect(gh.labels(42)).toContain("op:ready");
  });

  it("refuses the complete unit when one member changes after admission", async () => {
    const repo = await repository();
    const worktrees = await temporaryDirectory();
    const gh = new UnitGh([issue(51), issue(52)]);
    const unit = deliveryUnit("seeded-member-change", [51, 52]);
    gh.issues.get(52)!.body += "\nchanged after admission";

    await expect(
      claimDeliveryUnitIssues([issue(51), issue(52)], {
        gh: gh as unknown as GhOps,
        targetRepo: "fixture/repo",
        localRepo: repo.dir,
        worktreeRoot: worktrees,
        base: { ref: "HEAD", defaultBranch: repo.defaultBranch },
        unit,
      }),
    ).rejects.toThrow("member #52 changed after admission");
    expect(gh.labels(51)).toContain("op:ready");
    expect(gh.labels(52)).toContain("op:ready");
  });
});

class UnitGh {
  readonly issues = new Map<number, GhIssue>();
  failNextSwapFor: number | undefined;

  constructor(issues: GhIssue[]) {
    for (const value of issues) this.issues.set(value.number, structuredClone(value));
  }

  async readIssue(number: number): Promise<GhIssue> {
    const value = this.issues.get(number);
    if (value === undefined) throw new Error(`missing #${number}`);
    return structuredClone(value);
  }

  async swapLabel(number: number, from: string, to: string): Promise<void> {
    if (this.failNextSwapFor === number) {
      this.failNextSwapFor = undefined;
      throw new Error("seeded label failure");
    }
    const value = this.issues.get(number)!;
    if (!value.labels.includes(from)) throw new Error(`#${number} lacks ${from}`);
    value.labels = value.labels.map((label) => (label === from ? to : label));
  }

  labels(number: number): string[] {
    return [...this.issues.get(number)!.labels];
  }
}

function issue(number: number): GhIssue {
  return {
    number,
    title: `Member ${number}`,
    body: `## Goal\nDeliver member ${number}.\n\n## Acceptance criteria\n- [ ] complete`,
    labels: ["op:ready", "op:tier-standard"],
    state: "OPEN",
  };
}

function deliveryUnit(unitId: string, issueNumbers: number[]): LoopDeliveryUnit {
  return {
    unitId,
    membershipHash: stableHash(issueNumbers),
    members: issueNumbers.map((number) => ({
      issueNumber: number,
      ticketRef: `#${number}`,
      contentHash: issueContentHash(issue(number)),
      title: `Member ${number}`,
      body: issue(number).body,
      labels: issue(number).labels,
    })),
  };
}

async function repository(): Promise<TempGitRepo> {
  const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
  cleanups.push(repo.cleanup);
  return repo;
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "cormidia-hb103-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
