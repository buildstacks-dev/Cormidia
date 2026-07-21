// Run-2 ISSUE-021/022 regression: app-owned gate commands have one canonical
// YAML location, and a reviewed config edit merged to the remote default branch
// advances the lifecycle pin without accepting arbitrary working-tree bytes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  planAppPromotion,
  readLifecycleRecord,
  verifyApp,
} from "../../src/org/app-lifecycle.js";
import type { LifecycleFaultPoint } from "../../src/org/lifecycle.js";
import {
  READY_RUNTIME_PROBE,
  bootstrapReachable,
  makeLifecycleTestWorld,
  type LifecycleTestWorld,
} from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });

const fixtureDir = join(import.meta.dirname, "..", "fixtures", "lifecycle");

function sha256File(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitRemoteChange(
  world: LifecycleTestWorld,
  name: string,
  editConfig: (text: string) => string,
  extraFiles: Record<string, string> = {},
): { commit: string; configSha256: string } {
  const writer = join(world.root, `remote-writer-${name}`);
  git(world.root, "clone", "--quiet", world.git.bare.root, writer);
  const configPath = join(writer, ".operon", "config.yaml");
  writeFileSync(configPath, editConfig(readFileSync(configPath, "utf8")), "utf8");
  for (const [rel, contents] of Object.entries(extraFiles)) {
    const path = join(writer, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }
  git(writer, "add", ".");
  execFileSync("git", [
    "-c", "user.name=Reviewed Config Fixture",
    "-c", "user.email=fixture@operon.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", `test: ${name}`,
  ], { cwd: writer, stdio: "ignore" });
  git(writer, "push", "--quiet", "origin", "HEAD:main");
  return {
    commit: git(writer, "rev-parse", "HEAD"),
    configSha256: sha256File(configPath),
  };
}

function withTopLevelTestCommand(text: string): string {
  return `${text.trimEnd()}\n\ntest_command: node -e \"\"\n`;
}

function configJournals(world: LifecycleTestWorld): Array<Record<string, unknown>> {
  const dir = join(world.stateHome, "lifecycle", "apps", "sparse", "config-ratifications");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>);
}

describe("run-2 config hash evidence", () => {
  it("reproduces both observed hashes from the copied read-only fixture bytes", () => {
    const evidence = JSON.parse(readFileSync(join(fixtureDir, "run2-config-hashes.json"), "utf8")) as {
      record_config_sha256: string;
      remote_config_sha256: string;
    };
    expect(sha256File(join(fixtureDir, "run2-config-before.yaml"))).toBe(evidence.record_config_sha256);
    expect(sha256File(join(fixtureDir, "run2-config-after.yaml"))).toBe(evidence.remote_config_sha256);
  });
});

describe("remote-default config acceptance", () => {
  it("keeps promotion preview read-only, then atomically accepts the validated remote commit", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await bootstrapReachable(world);
    const beforeBytes = readFileSync(join(world.stateHome, "lifecycle", "apps", "sparse", "record.json"), "utf8");
    const before = await readLifecycleRecord(world.stateHome, "sparse");
    const changed = commitRemoteChange(world, "reviewed-config", withTopLevelTestCommand);

    const preview = await planAppPromotion({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      to: "live",
      readinessProbe: READY_RUNTIME_PROBE,
    });
    expect(preview.executable).toBe(false);
    expect(readFileSync(join(world.stateHome, "lifecycle", "apps", "sparse", "record.json"), "utf8")).toBe(beforeBytes);
    expect(configJournals(world)).toEqual([]);

    const verified = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });
    expect(verified.status).toBe("ready");
    expect(verified.config_sha256).toBe(changed.configSha256);
    expect(verified.config_commit).toBe(changed.commit);
    expect(verified.checks.find((check) => check.id === "registry-config")?.detail)
      .toContain("accepted remote-default config");

    const after = await readLifecycleRecord(world.stateHome, "sparse");
    expect(after).toMatchObject({
      config_sha256: changed.configSha256,
      config_commit: changed.commit,
    });
    expect(configJournals(world)).toEqual([
      expect.objectContaining({
        phase: "complete",
        previous: {
          config_sha256: before.config_sha256,
          config_commit: before.config_commit,
        },
        accepted: {
          config_sha256: changed.configSha256,
          config_commit: changed.commit,
        },
      }),
    ]);

    const promotable = await planAppPromotion({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      to: "live",
      readinessProbe: READY_RUNTIME_PROBE,
    });
    expect(promotable.executable).toBe(true);
  });

  it("never accepts arbitrary managed-working-tree config bytes", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    const bootstrap = await bootstrapReachable(world);
    const before = await readLifecycleRecord(world.stateHome, "sparse");
    const configPath = join(bootstrap.managedClone, ".operon", "config.yaml");
    writeFileSync(configPath, withTopLevelTestCommand(readFileSync(configPath, "utf8")), "utf8");

    const preview = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      synchronize: false,
      readinessProbe: READY_RUNTIME_PROBE,
    });
    expect(preview.status).toBe("invalid");
    expect(preview.checks.find((check) => check.id === "registry-config")?.detail)
      .toMatch(/working-tree config hash .* differs from fetched main config/);
    expect(await readLifecycleRecord(world.stateHome, "sparse")).toMatchObject({
      config_sha256: before.config_sha256,
      config_commit: before.config_commit,
    });
    expect(configJournals(world)).toEqual([]);

    const synchronized = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: "sparse",
      readinessProbe: READY_RUNTIME_PROBE,
    });
    expect(synchronized.status).toBe("ready");
    expect(readFileSync(configPath, "utf8")).not.toContain("test_command: node");
    expect(configJournals(world)).toEqual([]);
  });

  for (const failure of ["schema", "format", "gate-placement", "authority"] as const) {
    it(`does not repin when ${failure} validation fails`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await bootstrapReachable(world);
      const before = await readLifecycleRecord(world.stateHome, "sparse");

      if (failure === "schema") {
        commitRemoteChange(world, failure, (text) => withTopLevelTestCommand(text).replace("status: onboarding", "status: launched"));
      } else if (failure === "format") {
        commitRemoteChange(world, failure, (text) => `${text.trimEnd()}\n\ntest_command: node -e \"\"   \n`);
      } else if (failure === "gate-placement") {
        commitRemoteChange(world, failure, (text) => {
          const raw = parse(text) as Record<string, unknown>;
          const apps = raw["apps"] as Record<string, Record<string, unknown>>;
          apps["sparse"]!["test_command"] = "node -e \"\"";
          return stringify(raw);
        });
      } else {
        commitRemoteChange(world, failure, withTopLevelTestCommand, {
          ".operon/AUTHORITY.md": "# Changed authority\n\nThis was not the onboarding authority.\n",
        });
      }

      const report = await verifyApp({
        orgHome: world.orgHome,
        stateHome: world.stateHome,
        appName: "sparse",
        readinessProbe: READY_RUNTIME_PROBE,
      });
      expect(report.status).toBe("invalid");
      const configCheck = report.checks.find((check) => check.id === "registry-config");
      expect(configCheck?.status).toBe("fail");
      if (failure === "gate-placement") {
        expect(configCheck?.detail).toMatch(/apps\.sparse\.test_command.*top level.*never under/);
      }
      expect(await readLifecycleRecord(world.stateHome, "sparse")).toMatchObject({
        config_sha256: before.config_sha256,
        config_commit: before.config_commit,
      });
      expect(configJournals(world)).toEqual([]);
    });
  }

  for (const point of ["after_config_ratification_intent", "after_config_ratification_record"] as const) {
    it(`reconciles a crash at ${point} idempotently and releases the lifecycle lock`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await bootstrapReachable(world);
      const before = await readLifecycleRecord(world.stateHome, "sparse");
      const changed = commitRemoteChange(world, point, withTopLevelTestCommand);
      const fault = async (actual: LifecycleFaultPoint) => {
        if (actual === point) throw new Error(`injected:${point}`);
      };

      const interrupted = await verifyApp({
        orgHome: world.orgHome,
        stateHome: world.stateHome,
        appName: "sparse",
        readinessProbe: READY_RUNTIME_PROBE,
        fault,
      });
      expect(interrupted.status).toBe("invalid");
      expect(interrupted.checks.find((check) => check.id === "registry-config")?.detail)
        .toBe(`injected:${point}`);
      expect(existsSync(join(world.stateHome, "lifecycle", "locks", "sparse.lock"))).toBe(false);
      expect(configJournals(world)).toEqual([expect.objectContaining({ phase: "intent" })]);
      const interruptedRecord = await readLifecycleRecord(world.stateHome, "sparse");
      expect(interruptedRecord.config_sha256).toBe(
        point === "after_config_ratification_record" ? changed.configSha256 : before.config_sha256,
      );

      const resumed = await verifyApp({
        orgHome: world.orgHome,
        stateHome: world.stateHome,
        appName: "sparse",
        readinessProbe: READY_RUNTIME_PROBE,
      });
      expect(resumed.status).toBe("ready");
      expect(await readLifecycleRecord(world.stateHome, "sparse")).toMatchObject({
        config_sha256: changed.configSha256,
        config_commit: changed.commit,
      });
      expect(configJournals(world)).toEqual([expect.objectContaining({ phase: "complete" })]);

      const rerun = await verifyApp({
        orgHome: world.orgHome,
        stateHome: world.stateHome,
        appName: "sparse",
        readinessProbe: READY_RUNTIME_PROBE,
      });
      expect(rerun.status).toBe("ready");
      expect(configJournals(world)).toHaveLength(1);
    });
  }
});
