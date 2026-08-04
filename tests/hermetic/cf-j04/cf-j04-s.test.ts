// CF-J04-S — full ready→merged walk on the GitHub + Claude doubles, with
// labels-after-artifacts checked at every consequential stage (L2, E3; HB-031).

import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../../src/loop/driver.js";
import { type LoopItem } from "../../../src/loop/loop.js";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import {
  J04_APP,
  J04_CONTRACT,
  buildJ04Item,
  j04Git,
  makeJ04World,
  type J04World,
} from "./support.js";

function assertArtifactOrder(ops: readonly string[]): void {
  const requireBefore = (first: string, second: string): void => {
    const left = ops.indexOf(first);
    const right = ops.indexOf(second);
    if (left < 0 || right < 0 || left >= right) {
      throw new Error(`delivery order violation: ${first} must precede ${second}; got ${ops.join(" -> ")}`);
    }
  };
  requireBefore("pr.create", "label.in-review");
  requireBefore("pr.review", "pr.merge");
  requireBefore("pr.merge", "ref.delete");
}

describe("CF-J04-S — full ready→merged delivery walk", () => {
  const worlds: J04World[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0).reverse()) await world.cleanup();
  });

  it("uses scripted adapter turns and reaches merged with every label behind its artifact", async () => {
    const world = await makeJ04World();
    worlds.push(world);
    const adapter = claudeDouble([
      script.turn({
        sessionId: "j04-contract",
        outcome: script.success(J04_CONTRACT, { usage: { inputTokens: 200, outputTokens: 80 } }),
      }),
      script.turn({
        sessionId: "j04-build",
        outcome: script.success("# Adapter-delivered artifact\n", {
          usage: { inputTokens: 300, outputTokens: 100 },
        }),
      }),
    ]);

    const result = await runLoopOnce({
      app: J04_APP,
      repo: world.github.repo,
      gh: world.gh,
      localRepo: world.repo.dir,
      worktreeRoot: world.worktreeRoot,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: world.base,
      maxConcurrent: 1,
      afterClaim: async (item): Promise<LoopItem> => {
        const hooks = { gate: () => ({ allow: true }) as const };
        const contract = await adapter.runtime.runTurn(
          doubleTurnRequest({ workdir: item.worktree!, role: doubleRole({ name: "builder" }), task: "contract" }),
          hooks,
        );
        const build = await adapter.runtime.runTurn(
          doubleTurnRequest({ workdir: item.worktree!, role: doubleRole({ name: "builder" }), task: "build" }),
          hooks,
        );
        await writeFile(`${item.worktree}/delivery.md`, build.summary);
        j04Git(item.worktree!, "add", "--", "delivery.md");
        j04Git(item.worktree!, "commit", "--no-gpg-sign", "-m", "build: adapter delivery");
        world.github.setBranchHead(item.branch!, j04Git(item.worktree!, "rev-parse", "HEAD"));
        return {
          ...item,
          contract: contract.summary,
          criterionTests: { AC1: ["cf-j04-s.test.ts"] },
        };
      },
      injectReview: async (item) => {
        await world.gh.createReview(item.prNumber!, {
          state: "approve",
          body: "independent exact-head approval",
          expectedCommit: j04Git(item.worktree!, "rev-parse", "HEAD"),
        });
      },
    });

    expect(result.items).toHaveLength(1);
    const merged = result.items[0]!;
    expect(merged.phase).toBe("merged");
    expect(adapter.recorder.turns).toHaveLength(2);
    expect((await world.gh.readPR(merged.prNumber!)).state).toBe("MERGED");
    expect((await world.gh.readIssue(merged.issueNumber))).toMatchObject({ state: "CLOSED", labels: [] });
    expect(world.github.readState().branches[merged.branch!]).toBeUndefined();

    const calls = world.github.callLog();
    const ops = calls.map((entry) => {
      if (entry.op === "issue.edit" && entry.argv.join(" ").includes("op:in-review")) return "label.in-review";
      return entry.op;
    });
    assertArtifactOrder(ops);
    expect(j04Git(world.remoteDir, "rev-parse", `refs/heads/${merged.branch}`)).toBeDefined();
  });

  it("negative control: the ordering detector fires when a label is seeded before its PR", () => {
    expect(() => assertArtifactOrder(["label.in-review", "pr.create", "pr.review", "pr.merge", "ref.delete"]))
      .toThrow(/delivery order violation/);
  });
});
