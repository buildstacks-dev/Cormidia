// Traceability: CF-REG-374 · HB-139 · case-catalog.md §10.3.

// #374 CLI acceptance: help and token-free dry-run distinguish complete
// decomposition intent from per-invocation publication admission.

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const execFileAsync = promisify(execFile);
const SOURCE_LAUNCHER = join(import.meta.dirname, "../../../src/cormidia-local.cjs");
const APP = "corpus-cli";
let org: TempOrgHome | undefined;
let repo: TempGitRepo | undefined;

afterEach(async () => {
  await repo?.cleanup();
  await org?.cleanup();
  repo = undefined;
  org = undefined;
});

describe("CF-REG-374 — CLI decomposition/admission surfaces", () => {
  it("plan help names intuitive count syntax and separates resume from explicit revision", async () => {
    org = await configuredOrg();
    const result = await runCli(org, ["plan", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--expected-tickets <N|N-M|N+|complete>");
    expect(result.stdout).toContain("exact count (10)");
    expect(result.stdout).toContain("inclusive range (4-12)");
    expect(result.stdout).toContain("open range (7+)");
    expect(result.stdout).toContain("--resume publishes the next admissible batch");
    expect(result.stdout).toContain("--revise explicitly replaces still-unpublished coverage");
    expect(result.stdout).toContain("not how many issues may be published at once");
  });

  it("auto dry-run reports total decomposition intent separately from evidence-bounded publication", async () => {
    org = await configuredOrg();
    repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    const result = await runCli(org, [
      "plan",
      APP,
      "--auto",
      "--goal",
      "Decompose the complete corpus",
      "--expected-tickets",
      "1-10",
      "--stage",
      "mature",
      "--workdir",
      repo.dir,
      "--dry-run",
      "--json",
    ]);

    expect(result.code, result.stderr).toBe(0);
    const preview = JSON.parse(result.stdout) as {
      ticketBudget: { decompositionRequest: unknown; publication: unknown; detail: string };
      effects: unknown;
      episode: unknown;
    };
    expect(preview.ticketBudget.decompositionRequest).toEqual({
      kind: "range",
      syntax: "1-10",
      min: 1,
      max: 10,
    });
    expect(preview.ticketBudget.publication).toMatchObject({
      cap: 3,
      requestedStage: "mature",
      evidenceStage: "bootstrap",
      constrainedByEvidence: true,
    });
    expect(preview.ticketBudget.detail).toContain("complete decomposition is stored independently");
    expect(preview.effects).toEqual([]);
    expect(preview.episode).toMatchObject({ providerRuntimeCalled: false, durableStateWritten: false });
    expect(await externalCalls(org)).toEqual([]);
  });

  it("invalid count syntax has typed JSON remediation, and revise without a predecessor refuses before runtime", async () => {
    org = await configuredOrg();
    const invalid = await runCli(org, [
      "plan",
      APP,
      "--auto",
      "--goal",
      "Decompose the corpus",
      "--expected-tickets",
      "large",
      "--dry-run",
      "--json",
    ]);
    expect(invalid.code).toBe(1);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "plan_decomposition_syntax_invalid",
        remediation: expect.stringContaining("exact count (10)"),
      },
    });

    repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    const revise = await runCli(org, [
      "plan",
      APP,
      "--auto",
      "--goal",
      "Decompose the corpus",
      "--expected-tickets",
      "1-10",
      "--stage",
      "mature",
      "--workdir",
      repo.dir,
      "--revise",
      "--no-publish",
      "--json",
    ]);
    expect(revise.code, revise.stderr).toBe(1);
    expect(JSON.parse(revise.stdout)).toMatchObject({
      status: "failed",
      refusal: {
        code: "plan_revision_missing",
        publicationCap: 3,
        preservedDecomposition: null,
        nextAction: expect.stringContaining("without --revise"),
      },
    });
    expect(await externalCalls(org)).toEqual([]);
  });
});

async function configuredOrg(): Promise<TempOrgHome> {
  const fixture = await makeTempOrgHome({ name: "corpus-cli-org" });
  await writeFile(
    join(fixture.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      "org:",
      "  name: corpus-cli-org",
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      `  ${APP}:`,
      "    repo: fixture/corpus-cli",
      "    status: live",
      "    cadence: {}",
      "",
    ].join("\n"),
    "utf8",
  );
  const bin = join(fixture.root, "external-call-traps");
  await mkdir(bin, { recursive: true });
  for (const name of ["gh", "claude", "codex", "cursor-agent", "opencode", "pi", "grok", "muse"]) {
    const path = join(bin, name);
    await writeFile(path, '#!/bin/sh\nprintf \'%s\\n\' "${0##*/}" >> "$CF_REG_374_CALL_LOG"\nexit 97\n', "utf8");
    await chmod(path, 0o755);
  }
  return fixture;
}

async function runCli(fixture: TempOrgHome, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const log = join(fixture.root, "external-calls.log");
  const env = {
    ...process.env,
    ...fixture.env,
    HOME: fixture.homeDir,
    NO_COLOR: "1",
    CF_REG_374_CALL_LOG: log,
    PATH: `${join(fixture.root, "external-call-traps")}:${process.env.PATH ?? ""}`,
  };
  const commandArgs = [SOURCE_LAUNCHER, ...args, "--org-home", fixture.orgHome, "--state-home", fixture.stateHome];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, commandArgs, {
      cwd: fixture.root,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

async function externalCalls(fixture: TempOrgHome): Promise<string[]> {
  try {
    return (await readFile(join(fixture.root, "external-calls.log"), "utf8")).trim().split("\n").filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
