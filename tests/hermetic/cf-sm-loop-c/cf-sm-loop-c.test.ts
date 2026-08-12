// Traceability: CF-SM-LOOP-C · HB-146 · case-catalog.md §2 loop machine; contracts/OP-loop.md §1; system-map.md §2.2.

// CF-SM-LOOP-C — the loop transition crash dimension. CF-J04-I already owns
// the identical real-SIGKILL claim/PR/review/merge boundaries, so this spec
// closes the one non-duplicate productive boundary: a kill after the durable
// build artifact and before gates. Recovery must retain `op:building`, reuse
// the committed artifact, and create the PR before projecting `op:in-review`.

import { readFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import {
  advanceGates,
  advanceReviewing,
  claimTicket,
  itemFromIssue,
  parseAcceptanceCriteria,
  type LoopItem,
} from "../../../src/loop/loop.js";
import { rehydrateTicketState } from "../../../src/loop/rehydrate.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import { J04_CONTRACT, j04Git, makeJ04World, type J04World } from "../cf-j04-i-cf-j04-r-cf-j04-s/support.js";

const PRODUCTIVE_TRANSITION_KILL_POINTS = [
  ["ready→building", "CF-J04-I claim boundary"],
  ["building→gates", "CF-SM-LOOP-C build-artifact boundary"],
  ["gates→reviewing", "CF-J04-I PR boundary"],
  ["reviewing→shipping", "CF-J04-I review boundary"],
  ["shipping→merged", "CF-J04-I merge boundary"],
] as const;

interface BuildCheckpoint {
  item: LoopItem;
  head: string;
}

function buildThenStopSource(): string {
  return `
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(process.env.CF_SM_LOOP_C_INPUT);
const item = input.item;
const git = (...args) => execFileSync("git", args, {
  cwd: item.worktree,
  encoding: "utf8",
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: ${JSON.stringify(devNull)},
  },
}).trim();

writeFileSync(join(item.worktree, "delivery.md"), "# Durable before gates\\n");
git("add", "--", "delivery.md");
git("commit", "--no-gpg-sign", "-m", "build: persist pre-gate artifact");
const checkpoint = {
  item: {
    ...item,
    contract: input.contract,
    criterionTests: { AC1: ["cf-sm-loop-c.test.ts"] },
  },
  head: git("rev-parse", "HEAD"),
};
writeFileSync(join(process.env.KP_SCRATCH, "checkpoint.json"), JSON.stringify(checkpoint, null, 2) + "\\n");
await kp("building-gates");
`;
}

function assertPrBeforeReviewLabel(world: J04World): void {
  const ops = world.github.callLog().map((entry) => {
    if (entry.op === "issue.edit" && entry.argv.join(" ").includes("op:in-review")) return "label.in-review";
    return entry.op;
  });
  const pr = ops.indexOf("pr.create");
  const label = ops.indexOf("label.in-review");
  if (pr < 0 || label < 0 || pr >= label) {
    throw new Error(`torn loop transition: PR must precede op:in-review; got ${ops.join(" -> ")}`);
  }
}

describe("CF-SM-LOOP-C — productive transition crash sweep", () => {
  const worlds: J04World[] = [];
  const results: KillPointResult[] = [];

  afterEach(async () => {
    for (const result of results.splice(0).reverse()) await result.cleanup();
    for (const world of worlds.splice(0).reverse()) await world.cleanup();
  });

  it("enumerates every productive boundary and assigns the sole non-duplicate kill point", () => {
    expect(PRODUCTIVE_TRANSITION_KILL_POINTS).toHaveLength(5);
    expect(PRODUCTIVE_TRANSITION_KILL_POINTS.map(([transition]) => transition)).toEqual([
      "ready→building",
      "building→gates",
      "gates→reviewing",
      "reviewing→shipping",
      "shipping→merged",
    ]);
    expect(PRODUCTIVE_TRANSITION_KILL_POINTS.filter(([, owner]) => owner.startsWith("CF-SM-LOOP-C"))).toEqual([
      ["building→gates", "CF-SM-LOOP-C build-artifact boundary"],
    ]);
  });

  it("SIGKILL between the committed build artifact and gates preserves the predecessor and resumes forward", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const building = await claimTicket(world.issue, {
      gh: world.gh,
      targetRepo: world.github.repo,
      localRepo: world.repo.dir,
      worktreeRoot: world.worktreeRoot,
      base: world.base,
    });

    const result = await runKillPointScenario({
      source: buildThenStopSource(),
      killAt: "building-gates",
      env: {
        CF_SM_LOOP_C_INPUT: JSON.stringify({ item: building, contract: J04_CONTRACT }),
      },
    });
    results.push(result);
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe("building-gates");
    expect(result.markers).toEqual(["building-gates"]);

    const checkpoint = JSON.parse(await readFile(join(result.stateDir, "checkpoint.json"), "utf8")) as BuildCheckpoint;
    expect(checkpoint.item.phase).toBe("building");
    expect(checkpoint.head).toBe(j04Git(checkpoint.item.worktree!, "rev-parse", "HEAD"));
    expect(checkpoint.head).not.toBe(j04Git(world.repo.dir, "rev-parse", world.base.ref));
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:building"]);
    expect(world.github.readState().prs).toEqual({});

    // The GitHub double is deliberately separate from the file remote. Mirror
    // the already-committed head before the ordinary gate path pushes it.
    world.github.setBranchHead(checkpoint.item.branch!, checkpoint.head);
    const reviewing = await advanceGates(checkpoint.item, {
      gh: world.gh,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: world.base,
      criteria: parseAcceptanceCriteria(checkpoint.item.body),
      criterionTests: checkpoint.item.criterionTests ?? {},
    });

    expect(reviewing.phase).toBe("reviewing");
    expect(reviewing.prNumber).toBeDefined();
    expect(j04Git(reviewing.worktree!, "rev-parse", "HEAD")).toBe(checkpoint.head);
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:in-review"]);
    expect(world.github.callLog().filter((entry) => entry.op === "pr.create")).toHaveLength(1);
    assertPrBeforeReviewLabel(world);
  });

  it("negative control: a seeded successor label without its PR is rejected as a torn transition", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const building = await claimTicket(world.issue, {
      gh: world.gh,
      targetRepo: world.github.repo,
      localRepo: world.repo.dir,
      worktreeRoot: world.worktreeRoot,
      base: world.base,
    });
    await world.gh.swapLabel(world.issue.number, "op:building", "op:in-review");

    const observed = await world.gh.readIssue(world.issue.number);
    const torn = {
      ...itemFromIssue(observed, world.github.repo),
      branch: building.branch!,
      worktree: building.worktree!,
    };
    expect(torn.phase).toBe("reviewing");
    const recovered = await rehydrateTicketState(
      { issueNumber: torn.issueNumber, body: torn.body },
      { gh: world.gh, branch: torn.branch! },
    );
    expect(recovered.prNumber).toBeUndefined();
    await expect(advanceReviewing(torn, { gh: world.gh })).rejects.toThrow(/missing prNumber/);
    expect(world.github.readState().prs).toEqual({});
  });
});
