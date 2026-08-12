// Traceability: CF-B16 · CF-C-B16 · CF-J11-R · HB-141 · boundary-map.md B-16; CORMIDIA-C-B16-001 §§1–5; contracts/journey-acceptance.md J-11 refusal criterion; CORMIDIA-INV-003.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import type { GhOps } from "../../../src/loop/github.js";
import { advanceProvisionSetup, repairPrGateEvidence } from "../../../src/loop/loop.js";
import type { GateResult, GateRunResult } from "../../../src/loop/qgates.js";
import { runGates } from "../../../src/loop/qgates.js";
import type { Policy } from "../../../src/loop/policy.js";
import type { LoopItem } from "../../../src/loop/types.js";
import { defaultGate } from "../../../src/runtime/gate.js";
import { readEnvelope } from "../../../src/runtime/runlog/envelope.js";
import { mintRunId } from "../../../src/runtime/runlog/paths.js";
import type { GateDecision, GateFn, ToolAction } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const POLICY: Policy = {
  riskTiers: { low: [], medium: [], high: [] },
  gates: { low: ["tests"], medium: ["tests"], high: ["tests"] },
  dimensionGlobs: {},
  remediation: { maxAttempts: 3 },
};

const MAX_LOCAL_CAPTURE_BYTES = 256 * 1024;
const MAX_LOCAL_CAPTURE_LINES = 50;

interface GateRepo {
  path: string;
  head: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function testGate(run: GateRunResult): GateResult {
  const result = run.results.find((candidate) => candidate.gate === "tests");
  if (result === undefined) throw new Error("tests gate did not execute");
  return result;
}

function assertEvidenceBound(run: GateRunResult, repo: GateRepo): void {
  if (run.headCommitId !== repo.head) {
    throw new Error(`gate evidence is bound to ${run.headCommitId ?? "nothing"}, expected ${repo.head}`);
  }
  const result = testGate(run);
  if (result.candidateSha !== repo.head || result.worktree !== repo.path || result.command === undefined) {
    throw new Error("gate evidence is missing its candidate SHA, worktree, or exact command");
  }
}

function assertPublicationRefused(decision: GateDecision): void {
  if (decision.allow) throw new Error("publication bypassed exact-payload approval");
}

function loopItem(repo: GateRepo, gateResults: GateRunResult[] = []): LoopItem {
  return {
    issueNumber: 141,
    ticketRef: "#141",
    title: "HB-141 fixture",
    body: "fixture",
    targetRepo: "cormidia/fixture",
    labels: ["op:building"],
    phase: "building",
    tier: "standard",
    cycles: 0,
    remediationAttempts: 0,
    gateResults,
    findings: [],
    branch: "test/hb-141",
    worktree: repo.path,
  };
}

describe("CF-B16 / CF-C-B16 — scripted gate-command runner (L2, HB-141)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function makeRepo(): Promise<GateRepo> {
    const path = await mkdtemp(join(tmpdir(), "cf-b16-"));
    cleanups.push(() => rm(path, { recursive: true, force: true }));
    await mkdir(join(path, "node_modules"), { recursive: true });
    await writeFile(join(path, ".gitignore"), "node_modules/\n");
    await writeFile(join(path, "app.txt"), "candidate\n");
    await writeFile(
      join(path, "hang.mjs"),
      [
        'import { spawn } from "node:child_process";',
        'spawn(process.execPath, ["-e", "setTimeout(() => require(\\"node:fs\\").writeFileSync(\\"orphan.txt\\", \\"alive\\"), 300)"], { stdio: "ignore" });',
        "setInterval(() => {}, 1_000);",
      ].join("\n"),
    );
    await writeFile(
      join(path, "flood.mjs"),
      'for (let i = 0; i < 6_000; i++) (i % 2 === 0 ? process.stdout : process.stderr).write(`${i}:${"x".repeat(96)}\\n`);\n',
    );
    await writeFile(
      join(path, "mutate.mjs"),
      'import { writeFileSync } from "node:fs"; writeFileSync("app.txt", "mutated\\n");\n',
    );
    await writeFile(join(path, "liar.mjs"), 'console.log("all checks green");\n');
    git(path, "init", "-q");
    git(path, "config", "user.name", "Cormidia Test");
    git(path, "config", "user.email", "cormidia-test@example.invalid");
    git(path, "add", ".gitignore", "app.txt", "hang.mjs", "flood.mjs", "mutate.mjs", "liar.mjs");
    git(path, "commit", "-qm", "fixture");
    return { path, head: git(path, "rev-parse", "HEAD") };
  }

  async function run(repo: GateRepo, testCommand: string | undefined, timeoutMs = 2_000): Promise<GateRunResult> {
    return runGates(
      "medium",
      repo.path,
      [],
      [],
      { approvedCommitId: repo.head, headCommitId: repo.head },
      {
        policy: POLICY,
        commands: testCommand === undefined ? {} : { testCommand },
        criterionTests: {},
        process: { timeoutMs },
      },
    );
  }

  it("kills a hung command's whole process group at the explicit timeout", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, "node hang.mjs", 75));
    expect(result).toMatchObject({ status: "fail", timedOut: true, candidateSha: repo.head, worktree: repo.path });
    expect(result.detail).toContain("timed out after 0.075s");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(existsSync(join(repo.path, "orphan.txt"))).toBe(false);
  });

  it("bounds a mixed stdout/stderr flood to 256 KiB and 50 retained lines with an explicit marker", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, "node flood.mjs"));
    expect(result.status).toBe("pass");
    expect(result.outputTail).toContain("[cormidia: output truncated]");
    expect(Buffer.byteLength(result.outputTail ?? "")).toBeLessThanOrEqual(MAX_LOCAL_CAPTURE_BYTES);
    const retained = (result.outputTail ?? "").split("\n");
    expect(retained.slice(1)).toHaveLength(MAX_LOCAL_CAPTURE_LINES);
    const retainedIndexes = retained.slice(1).map((line) => Number.parseInt(line.split(":", 1)[0]!, 10));
    expect(Math.max(...retainedIndexes)).toBeGreaterThanOrEqual(5_990);
  });

  it("reports a missing required tool as a typed environment failure, not a red test", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, "cormidia-required-tool-that-does-not-exist"));
    expect(result).toMatchObject({ status: "fail", cause: "required-tool-unavailable", candidateSha: repo.head });
    expect(result.detail).toContain("required tool unavailable");
  });

  it("keeps an ordinary nonzero exit distinct from a missing-tool environment failure", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, 'node -e "process.exit(3)"'));
    expect(result).toMatchObject({ status: "fail", exitCode: 3, candidateSha: repo.head });
    expect(result).not.toHaveProperty("cause");
  });

  it("runs app commands in the worktree with the deny-by-default noninteractive overlay", async () => {
    const repo = await makeRepo();
    const result = testGate(
      await run(
        repo,
        `node -e "console.log(process.cwd()); console.log(process.env.CI + '/' + process.env.PNPM_CONFIG_IGNORE_SCRIPTS)"`,
      ),
    );
    expect(result).toMatchObject({ status: "pass", worktree: repo.path });
    expect(result.outputTail?.split("\n")).toEqual([await realpath(repo.path), "1/true"]);
  });

  it("binds an exit-0 liar's machine evidence to the exact candidate SHA and worktree", async () => {
    const repo = await makeRepo();
    const runResult = await run(repo, "node liar.mjs");
    expect(testGate(runResult)).toMatchObject({ status: "pass", exitCode: 0, outputTail: "all checks green" });

    const seededUnbound = { ...runResult, headCommitId: "0".repeat(40) };
    expect(() => assertEvidenceBound(seededUnbound, repo)).toThrow(/gate evidence is bound/);
    expect(() => assertEvidenceBound(runResult, repo)).not.toThrow();

    const rerun = await run(repo, "node liar.mjs");
    expect(() => assertEvidenceBound(rerun, repo)).not.toThrow();
  });

  it("fails an exit-0 command that mutates the bound candidate and surfaces the changed path", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, "node mutate.mjs"));
    expect(result).toMatchObject({ status: "fail", exitCode: 0, cause: "candidate-mutation", candidateSha: repo.head });
    expect(result.failures).toContain("app.txt");
  });

  it("keeps ignored tool residue outside candidate corruption", async () => {
    const repo = await makeRepo();
    const result = testGate(
      await run(repo, 'node -e "require(\\"node:fs\\").writeFileSync(\\"node_modules/cache\\", \\"ok\\")"'),
    );
    expect(result.status).toBe("pass");
  });

  it("fails a bare template with no required test command closed", async () => {
    const repo = await makeRepo();
    const result = testGate(await run(repo, undefined));
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no test_command configured");
  });

  it("keeps the exportable run-envelope output tail to the ratified 2,000 characters", async () => {
    const repo = await makeRepo();
    const root = await mkdtemp(join(tmpdir(), "cf-b16-runlog-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const at = new Date("2026-08-11T00:00:00.000Z");
    await advanceProvisionSetup(loopItem(repo), {
      gh: {} as GhOps,
      commands: { setupCommand: `node -e "process.stdout.write('q'.repeat(3000))"` },
      indexPreflight: () => ({ status: "pass", detail: "fixture index is writable" }),
      runlog: { root, app: "hb-141", traceId: "trace-hb-141", clock: () => at },
    });

    const envelope = await readEnvelope(root, "hb-141", mintRunId(at, "provision", "setup"));
    const detail = envelope.gate_results?.[0]?.detail ?? "";
    expect(detail).toContain(`$ node -e "process.stdout.write('q'.repeat(3000))"`);
    expect(detail.endsWith("q".repeat(2_000))).toBe(true);
    expect(detail).not.toContain("q".repeat(2_001));
  });

  it("keeps PR evidence to the ratified 8,000-character per-gate output tail", async () => {
    const repo = await makeRepo();
    const gateRun: GateRunResult = {
      tier: "medium",
      status: "pass",
      headCommitId: repo.head,
      results: [
        {
          gate: "tests",
          status: "pass",
          detail: "tests passed (exit 0)",
          command: "pnpm test",
          exitCode: 0,
          outputTail: "p".repeat(9_000),
          worktree: repo.path,
          candidateSha: repo.head,
          durationMs: 1,
        },
      ],
      remediation: {
        currentAttempt: 0,
        maxAttempts: 3,
        attemptsRemaining: 3,
        canRetry: false,
        exhausted: false,
        noProgress: false,
      },
    };
    let body = "## Evidence\n\nCloses #141";
    const pullRequest = () => ({
      number: 141,
      title: "HB-141 fixture",
      body,
      state: "OPEN" as const,
      headRefName: "test/hb-141",
      baseRefName: "main",
      headRefOid: repo.head,
    });
    const gh = {
      readPR: async () => pullRequest(),
      updatePullRequestBody: async (_number: number, next: string) => {
        body = next;
      },
    } as unknown as GhOps;

    const result = await repairPrGateEvidence(
      { ...loopItem(repo, [gateRun]), phase: "reviewing", labels: ["op:in-review"], prNumber: 141 },
      gh,
    );
    expect(result).toMatchObject({ repaired: true, satisfied: true, headRefOid: repo.head });
    const renderedOutput = body.match(/\*\*Captured output:\*\*[^\n]*\n```text\n([\s\S]*?)\n```/)?.[1];
    expect(renderedOutput).toBe("p".repeat(8_000));
  });
});

describe("CF-J11-R — audience publication requires its own exact-payload approval (L2, HB-141)", () => {
  let home: TempStateHome | undefined;

  afterEach(async () => {
    await home?.cleanup();
    home = undefined;
  });

  const publication = (draft: string): ToolAction => ({
    tool: "bash",
    input: { command: `sendmail -t < ${draft}` },
  });

  it("negative control: a permissive gate exposes the bypass before the real gate refuses it", async () => {
    home = await makeTempStateHome({ name: "cf-j11-r-bypass" });
    const store = new ApprovalStore(home.stateHome);
    const permissive: GateFn = () => ({ allow: true });
    const bypass = composeGate(permissive, store, { app: "audience-app", role: "marketing" })(
      publication("drafts/support.md"),
    );
    expect(() => assertPublicationRefused(bypass)).toThrow(/bypassed exact-payload approval/);

    const guarded = composeGate(defaultGate, store, { app: "audience-app", role: "marketing" })(
      publication("drafts/support.md"),
    );
    expect(() => assertPublicationRefused(guarded)).not.toThrow();
    expect(await store.listPending()).toHaveLength(1);
    expect((await store.listPending())[0]?.rule).toBe("outbound-message");
  });

  it("allows only the approved draft bytes and refuses a changed publication payload", async () => {
    home = await makeTempStateHome({ name: "cf-j11-r-exact" });
    const store = new ApprovalStore(home.stateHome);
    const gate = composeGate(defaultGate, store, { app: "audience-app", role: "marketing" });
    const approvedPayload = publication("drafts/support.md");
    expect(gate(approvedPayload).allow).toBe(false);
    const [item] = await store.listPending();
    await store.decide(item!.id, { decision: "approved" });

    expect(gate(approvedPayload).allow).toBe(true);
    const changedPayload = publication("drafts/support-edited.md");
    const changed = gate(changedPayload);
    expect(changed.allow).toBe(false);
    if (!changed.allow) expect(changed.escalate).toBe(true);
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.action).toEqual(changedPayload);
  });
});
