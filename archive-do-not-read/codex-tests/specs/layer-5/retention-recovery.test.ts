import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppsFile } from "../../../src/org/apps.js";
import {
  runScheduledRetentionSweep,
  sweepStateRetention,
  type StateRetentionPolicy,
} from "../../../src/org/retention.js";
import type { ObserveGitHubSource } from "../../../src/observe/github-source.js";
import { ObserveService } from "../../../src/observe/live-source.js";
import {
  createControlledWorld,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

const minimumPolicy: StateRetentionPolicy = {
  runsDays: 1,
  telemetryDays: 1,
  efficiencyEpisodeDays: 1,
  invocationsDays: 1,
  tasksDays: 1,
  learningEventsDays: 1,
  schedulerEvidenceDays: 1,
  sweepRecordDays: 1,
  narrativeDays: 1,
  refusedDecompositionDays: 1,
};

describe("production retention and scheduled recovery composition", () => {
  it("prunes only provably aged projections and retains ambiguous/governed truth", async () => {
    world = await createControlledWorld("layer-5-retention");
    const oldInvocation = resolve(world.stateRoot, "invocations", "2026-01-01.jsonl");
    const oldLearningEvent = resolve(
      world.stateRoot,
      "learning",
      "events",
      "2026-01-01",
      "event.json",
    );
    const governedLearning = resolve(
      world.stateRoot,
      "learning",
      "bundle",
      "governed.md",
    );
    const lifecycleDecision = resolve(
      world.stateRoot,
      "lifecycle",
      "ratified-decision.json",
    );
    const ambiguousTask = resolve(world.stateRoot, "tasks", "ambiguous", "task.json");
    await Promise.all([
      mkdir(resolve(oldInvocation, ".."), { recursive: true }),
      mkdir(resolve(oldLearningEvent, ".."), { recursive: true }),
      mkdir(resolve(governedLearning, ".."), { recursive: true }),
      mkdir(resolve(lifecycleDecision, ".."), { recursive: true }),
      mkdir(resolve(ambiguousTask, ".."), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(oldInvocation, '{"kind":"controlled-old-invocation"}\n', "utf8"),
      writeFile(oldLearningEvent, '{"kind":"controlled-old-event"}\n', "utf8"),
      writeFile(governedLearning, "must never be swept\n", "utf8"),
      writeFile(lifecycleDecision, '{"decision":"ratified"}\n', "utf8"),
      writeFile(ambiguousTask, "{not valid json", "utf8"),
    ]);

    const result = await sweepStateRetention(
      world.stateRoot,
      new Date("2026-04-01T00:00:00.000Z"),
      minimumPolicy,
    );

    expect(result.errors).toEqual([]);
    expect(result.invocations).toMatchObject({ pruned: 1 });
    expect(result.learning_events).toMatchObject({ pruned: 1 });
    expect(result.tasks).toMatchObject({ kept: 1 });
    expect(existsSync(oldInvocation)).toBe(false);
    expect(existsSync(resolve(oldLearningEvent, ".."))).toBe(false);
    expect(existsSync(governedLearning)).toBe(true);
    expect(existsSync(lifecycleDecision)).toBe(true);
    expect(existsSync(ambiguousTask)).toBe(true);
  });

  it("admits exactly one scheduled sweep for a UTC day under contention", async () => {
    world = await createControlledWorld("layer-5-retention-contention");
    const now = new Date("2026-04-01T12:00:00.000Z");
    const contenders = await Promise.all(
      Array.from({ length: 12 }, () =>
        runScheduledRetentionSweep(world!.stateRoot, now, minimumPolicy),
      ),
    );

    expect(contenders.filter((result) => result !== undefined)).toHaveLength(1);
    expect(contenders.filter((result) => result === undefined)).toHaveLength(11);
  });

  it("rebuilds the read-only projection after observer loss without mutating durable work", async () => {
    world = await createControlledWorld("layer-5-observer-rebuild");
    const now = new Date("2026-04-01T12:00:00.000Z");
    const appsFile: AppsFile = {
      schemaVersion: 1,
      org: { name: "controlled-org", maxConcurrentTurns: 2 },
      defaults: { budgetUsdMonth: 100 },
      apps: [
        {
          name: "sample-app",
          repo: "example/sample-app",
          status: "live",
          budgetUsdMonth: 100,
          cadence: {},
        },
      ],
    };
    const githubSource: ObserveGitHubSource = {
      read: async (apps, observedAt) => ({
        apps: apps.map((app) => ({
          app: app.name,
          repo: app.repo,
          issues: [],
          pull_requests: [],
          observed_at: observedAt.toISOString(),
        })),
        health: {
          id: "github",
          status: "healthy",
          observed_at: observedAt.toISOString(),
          last_success_at: observedAt.toISOString(),
          detail: "controlled read-only source",
        },
      }),
    };
    const durableBefore = await treeFingerprint(world.stateRoot);

    const first = new ObserveService({
      orgName: "controlled-org",
      stateHome: world.stateRoot,
      appsFile,
      githubSource,
      clock: () => now,
      watchFiles: false,
    });
    await first.start();
    const firstSnapshot = first.snapshot();
    await first.stop();

    const second = new ObserveService({
      orgName: "controlled-org",
      stateHome: world.stateRoot,
      appsFile,
      githubSource,
      clock: () => now,
      watchFiles: false,
    });
    await second.start();
    const rebuiltSnapshot = second.snapshot();
    await second.stop();

    expect(rebuiltSnapshot).toEqual(firstSnapshot);
    expect(rebuiltSnapshot.org).toMatchObject({
      name: "controlled-org",
      read_only: true,
    });
    expect(await treeFingerprint(world.stateRoot)).toEqual(durableBefore);
  });
});

async function treeFingerprint(root: string): Promise<string[]> {
  const entries: string[] = [];
  await walk(root, "");
  return entries.sort();

  async function walk(directory: string, relativeDirectory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const relativePath =
        relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path, relativePath);
      } else {
        const metadata = await stat(path);
        entries.push(`${relativePath}:${metadata.size}:${metadata.mtimeMs}`);
      }
    }
  }
}
