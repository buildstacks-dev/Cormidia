// ISSUE-029 regression: pnpm's interactive `allowBuilds` placeholder corrupted a
// builder worktree unrecoverably ($10.24, 1.9M tokens, ticket returned).
//
// Two mechanisms are proven here, both deterministic and offline — no provider
// turn, no network, no org state, no live clock:
//
//  1. Prevention. The sandbox the builder's first install runs in carries a
//     deny-by-default dependency build policy, so pnpm never has an undecided
//     build to write a placeholder about.
//  2. Diagnosis. A worktree carrying the placeholder, or the duplicated
//     `allowBuilds` key the builder's answer produced, fails the SETUP gate with
//     that cause and the consolidation remedy, naming the file — not a raw
//     `[ERROR] duplicated mapping key (4:1)` three attempts later.
//
// The third mechanism, no-progress retry, lives in no-progress-retry.test.ts.
//
// `test/fixtures/setup-artifacts/issue-029-pnpm-workspace.yaml` is the real
// captured file from the blocked run, byte for byte, copied read-only from
// ~/.operon/Buildstacks/worktrees/sonnet5-buildstack-dev/op-3-…/.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  duplicateMappingKeys,
  scanSetupArtifacts,
  UNRESOLVED_SETUP_MARKERS,
} from "../../src/loop/setup-artifacts.js";
import { runSetupGate } from "../../src/loop/qgates.js";
import { advanceProvisionSetup } from "../../src/loop/loop.js";
import {
  DEPENDENCY_BUILD_POLICY_ENV,
  withDependencyBuildPolicy,
  withNonInteractiveEnv,
} from "../../src/runtime/non-interactive-env.js";
import { makeWorkingRepo, type WorkingRepoFixture } from "../fixtures/gitRepo.js";
import { FakeGhOps } from "../support/fakeGhOps.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/setup-artifacts/", import.meta.url));
const CAPTURED_CORRUPTION = readFileSync(join(FIXTURES, "issue-029-pnpm-workspace.yaml"), "utf8");
const CAPTURED_PLACEHOLDER = readFileSync(
  join(FIXTURES, "issue-029-pnpm-workspace-placeholder-only.yaml"),
  "utf8",
);

const repos: WorkingRepoFixture[] = [];
function worktree(files: Record<string, string> = {}): string {
  const repo = makeWorkingRepo();
  repos.push(repo);
  if (Object.keys(files).length > 0) repo.writeFiles(files);
  return repo.root;
}
afterAll(() => {
  for (const repo of repos) repo.cleanup();
});

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const node = (script: string) => `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;

// ---------------------------------------------------------------------------
// 1. Prevention — the build policy is applied before the first install
// ---------------------------------------------------------------------------

describe("deny-by-default dependency build policy", () => {
  it("denies dependency build scripts rather than allowing them", () => {
    // The dangerous default is a package that silently runs an install script.
    // pnpm's opposite knob (dangerouslyAllowAllBuilds) must never appear here.
    expect(DEPENDENCY_BUILD_POLICY_ENV).toEqual({ PNPM_CONFIG_IGNORE_SCRIPTS: "true" });
    expect(Object.keys(DEPENDENCY_BUILD_POLICY_ENV)).not.toContain(
      "PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS",
    );
  });

  it("uses pnpm 11's own env-config prefix, not npm's — pnpm ignores npm_config_*", () => {
    // Verified against the installed pnpm 11.10.0: getEnvKeySuffix accepts only
    // `pnpm_config_` / `PNPM_CONFIG_`. An NPM_CONFIG_* key would be silently
    // dropped, which is exactly how a "fix" here could ship inert.
    for (const key of Object.keys(DEPENDENCY_BUILD_POLICY_ENV)) {
      expect(key.startsWith("PNPM_CONFIG_")).toBe(true);
    }
  });

  it("is in the provider sandbox environment the builder's shell commands inherit", () => {
    const env = withNonInteractiveEnv({ PATH: "/provider/bin", OPERON_CAMPAIGN_MARKER: "keep-me" });

    expect(env).toMatchObject({
      PATH: "/provider/bin",
      OPERON_CAMPAIGN_MARKER: "keep-me",
      CI: "true",
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
    });
  });

  it("overrides a conflicting inherited value instead of deferring to it", () => {
    expect(withDependencyBuildPolicy({ PNPM_CONFIG_IGNORE_SCRIPTS: "false" })).toMatchObject({
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
    });
  });

  it("reaches the setup gate's subprocess — where the FIRST install of a worktree runs", async () => {
    const result = await runSetupGate(worktree(), {
      setupCommand: node(
        'process.exit(process.env.PNPM_CONFIG_IGNORE_SCRIPTS === "true" && process.env.CI === "1" ? 0 : 1)',
      ),
    });

    // CI=1 is the Stage 3 value this gate has always used; the build policy is
    // added alongside it, not in place of it.
    expect(result).toMatchObject({ gate: "setup", status: "pass", exitCode: 0 });
  });
});

// ---------------------------------------------------------------------------
// 2. Diagnosis — the captured corruption is a named setup failure
// ---------------------------------------------------------------------------

describe("scanSetupArtifacts", () => {
  it("reports the duplicated allowBuilds key in the real captured file", () => {
    const artifacts = scanSetupArtifacts(
      worktree({ "pnpm-workspace.yaml": CAPTURED_CORRUPTION }),
    );

    const duplicate = artifacts.find((artifact) => artifact.kind === "duplicate-mapping-key");
    expect(duplicate).toBeDefined();
    expect(duplicate!.file).toBe("pnpm-workspace.yaml");
    // pnpm itself reports `duplicated mapping key (4:1)` on this exact file.
    expect(duplicate!.line).toBe(4);
    expect(duplicate!.cause).toContain("allowBuilds");
    expect(duplicate!.cause).toContain("twice");
    expect(duplicate!.remedy).toContain("consolidate pnpm-workspace.yaml");
    expect(duplicate!.remedy).toContain("single `allowBuilds` mapping");
  });

  it("reports the literal placeholder as an unresolved marker", () => {
    const artifacts = scanSetupArtifacts(
      worktree({ "pnpm-workspace.yaml": CAPTURED_PLACEHOLDER }),
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "unresolved-marker",
      file: "pnpm-workspace.yaml",
      line: 2,
    });
    expect(artifacts[0]!.cause).toContain("set this to true or false");
    expect(artifacts[0]!.remedy).toContain("explicit `true` or `false`");
  });

  it("a healthy pnpm-workspace.yaml with repeated nested keys is clean", () => {
    // The near-miss: `esbuild:` appears under two different parents, and a list
    // of pinned versions repeats no key at all. Neither is a duplicate.
    const healthy = [
      "# pnpm config only",
      "allowBuilds:",
      "  '@google/genai': false",
      "  esbuild: true",
      "onlyBuiltDependencies:",
      "  esbuild: true",
      "minimumReleaseAgeExclude:",
      "  - '@earendil-works/pi-agent-core@0.80.7'",
      "  - '@earendil-works/pi-ai@0.80.7'",
      "",
    ].join("\n");

    expect(scanSetupArtifacts(worktree({ "pnpm-workspace.yaml": healthy }))).toEqual([]);
    expect(duplicateMappingKeys(healthy)).toEqual([]);
  });

  it("this repo's own pnpm-workspace.yaml is clean", () => {
    const own = readFileSync(
      fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url)),
      "utf8",
    );

    expect(duplicateMappingKeys(own)).toEqual([]);
  });

  it("a clean worktree produces no findings and a missing file is not a finding", () => {
    expect(scanSetupArtifacts(worktree())).toEqual([]);
  });

  it("does not accuse a block scalar or a sequence of duplicating keys", () => {
    const yaml = [
      "script: |",
      "  key: one",
      "  key: two",
      "items:",
      "  - name: a",
      "  - name: b",
      "",
    ].join("\n");

    expect(duplicateMappingKeys(yaml)).toEqual([]);
  });

  it("every declared marker is a fixed string a program emits", () => {
    expect(UNRESOLVED_SETUP_MARKERS.map((marker) => marker.text)).toContain(
      "set this to true or false",
    );
  });
});

describe("runSetupGate diagnosis", () => {
  it("fails with the duplicate-key cause and remedy instead of running pnpm into a parse error", async () => {
    const root = worktree({ "pnpm-workspace.yaml": CAPTURED_CORRUPTION });
    const ranMarker = join(root, "setup-ran.txt");

    const result = await runSetupGate(root, {
      setupCommand: node(`require('fs').writeFileSync(${JSON.stringify(ranMarker)}, 'ran')`),
    });

    expect(result).toMatchObject({ gate: "setup", status: "fail", cause: "unresolved-setup-artifact" });
    expect(result!.detail).toContain("pnpm-workspace.yaml");
    expect(result!.detail).toContain("duplicated mapping key");
    expect(result!.detail).toContain("the command was not run");
    expect(result!.outputTail).toContain("consolidate pnpm-workspace.yaml");
    // The command never ran: every mechanical fix attempt in the live run began
    // by invoking the tool the file had already disabled.
    expect(() => readFileSync(ranMarker)).toThrow();
  });

  it("fails on the placeholder as an unresolved-marker setup failure", async () => {
    const result = await runSetupGate(worktree({ "pnpm-workspace.yaml": CAPTURED_PLACEHOLDER }), {
      setupCommand: node("process.exit(0)"),
    });

    expect(result).toMatchObject({ gate: "setup", status: "fail", cause: "unresolved-setup-artifact" });
    expect(result!.detail).toContain("unresolved tool placeholder");
    expect(result!.failures?.join("\n")).toContain("set this to true or false");
  });

  it("catches a placeholder the setup command itself wrote, and keeps the command output", async () => {
    // The live shape: the install is what writes the placeholder, so a run that
    // started clean finishes dirty.
    const root = worktree();
    const target = JSON.stringify(join(root, "pnpm-workspace.yaml"));
    const result = await runSetupGate(root, {
      setupCommand: node(
        `require('fs').writeFileSync(${target}, ${JSON.stringify(CAPTURED_PLACEHOLDER)});` +
          "console.error('[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild, sharp');" +
          "process.exit(1)",
      ),
    });

    expect(result).toMatchObject({ status: "fail", cause: "unresolved-setup-artifact", exitCode: 1 });
    expect(result!.detail).toContain("unresolved tool placeholder");
    // Blamed on the command that ran, not on a tree that arrived broken.
    expect(result!.detail).toContain("the setup command left the worktree");
    expect(result!.outputTail).toContain("ERR_PNPM_IGNORED_BUILDS");
  });

  it("a corrupt tree is a setup failure even when no setup_command is configured", async () => {
    const result = await runSetupGate(worktree({ "pnpm-workspace.yaml": CAPTURED_CORRUPTION }), {});

    expect(result?.status).toBe("fail");
  });

  it("an unconfigured setup_command over a clean tree stays a clean absence", async () => {
    expect(await runSetupGate(worktree(), {})).toBeUndefined();
  });
});

describe("advanceProvisionSetup on a corrupted worktree", () => {
  it("returns before setup or a paid build turn when the Git index preflight fails", async () => {
    const gh = new FakeGhOps({
      issues: [{ number: 6, title: "Index guard", body: "## Goal\n\nShip it.\n", labels: ["op:building"] }],
    });
    const root = worktree();
    const setupMarker = join(root, "setup-must-not-run");
    const returned = await advanceProvisionSetup(
      {
        issueNumber: 6,
        ticketRef: "#6",
        title: "Index guard",
        body: "## Goal\n\nShip it.\n",
        targetRepo: "fixture/repo",
        labels: ["op:building"],
        phase: "building",
        tier: "standard",
        cycles: 0,
        remediationAttempts: 0,
        gateResults: [],
        findings: [],
        worktree: root,
        branch: "op/6-index-guard",
      },
      {
        gh,
        commands: {
          setupCommand: node(`require("node:fs").writeFileSync(${JSON.stringify(setupMarker)}, "ran")`),
        },
        indexPreflight: () => ({
          status: "fail",
          gitDir: join(root, ".git"),
          indexPath: join(root, ".git", "index"),
          errorCode: "error_git_index_unwritable",
          detail: `Git index preflight cannot create ${join(root, ".git", "index.lock")}. ` +
            `The worktree is preserved at ${root}.`,
        }),
      },
    );

    expect(returned.phase).toBe("returned");
    expect(existsSync(root)).toBe(true);
    expect(existsSync(setupMarker)).toBe(false);
    const comment = gh.issueComments.get(6)?.[0] ?? "";
    expect(comment).toContain("error_git_index_unwritable");
    expect(comment).toContain("before any implementation provider turn started");
    expect(comment).toContain(root);
  });

  it("returns the ticket before any build turn, naming the file and the remedy", async () => {
    const gh = new FakeGhOps({
      issues: [{ number: 7, title: "Establish stack", body: "## Goal\n\nShip it.\n", labels: ["op:building"] }],
    });
    const root = worktree({ "pnpm-workspace.yaml": CAPTURED_CORRUPTION });

    const returned = await advanceProvisionSetup(
      {
        issueNumber: 7,
        ticketRef: "#7",
        title: "Establish stack",
        body: "## Goal\n\nShip it.\n",
        targetRepo: "fixture/repo",
        labels: ["op:building"],
        phase: "building",
        tier: "standard",
        cycles: 0,
        remediationAttempts: 0,
        gateResults: [],
        findings: [],
        worktree: root,
        branch: "op/7-establish-stack",
      },
      { gh, commands: { setupCommand: "pnpm install --frozen-lockfile" } },
    );

    expect(returned.phase).toBe("returned");
    const comment = gh.issueComments.get(7)?.[0] ?? "";
    expect(comment).toContain("pnpm-workspace.yaml");
    expect(comment).toContain("consolidate pnpm-workspace.yaml");
    // Not the generic "fix setup_command" advice: the command is fine, the file
    // is not, and sending the reader to `.operon/config.yaml` wastes the turn.
    expect(comment).not.toContain("Fix `setup_command`");
    expect(comment).toContain("Do not add a second block answering the placeholder");
  });
});
