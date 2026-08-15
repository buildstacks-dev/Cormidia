// CF-B26 / CF-C-B26 — HB-137 — boundary-map.md B-26; contracts/B-26-muse-code.md.

// CF-B26 unit tier: the registration surfaces a new harness must carry, and
// the per-turn budget guard pinned offline against the scripted transport
// (docs/harness/adding-updating.md §3/§4 — the guard is never proven live).

import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeCapabilityProfile, runtimeCapabilityGuidance } from "../../../../src/runtime/capabilities.js";
import { RUNTIME_KINDS, getRuntime } from "../../../../src/runtime/registry.js";
import { describeModelCatalogCheck, readRuntimeModelCatalog } from "../../../../src/runtime/model-catalog.js";
import { invokesNestedHarness } from "../../../../src/runtime/role-shaping.js";
import { HARNESS_SUPPORT, bandForVersion, detectHarnessVersion } from "../../../../src/runtime/harness-support.js";
import { readBinaryVersion } from "../../../../src/runtime/harness-version-detect.js";
import { configuredProviderFamily } from "../../../../src/runtime/assignment.js";
import { costEnforcementFor } from "../../../../src/runtime/turn-budget.js";
import { museExecArgs } from "../../../../src/runtime/adapters/muse-exec.js";
import { museManagedHookManifest } from "../../../../src/runtime/adapters/muse-managed-hooks.js";
import { doubleRole, doubleTurnRequest } from "../../../fixtures/adapters/claude-double.js";
import { museDouble } from "../../../fixtures/adapters/muse-double.js";
import { script } from "../../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
let logRoot: string | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
  if (logRoot !== undefined) await rm(logRoot, { recursive: true, force: true });
  logRoot = undefined;
});

describe("CF-B26 registration — muse is a first-class harness with an HONEST profile", () => {
  it("is registered and constructible", () => {
    expect(RUNTIME_KINDS).toContain("muse");
    expect(getRuntime("muse").kind).toBe("muse");
  });

  it("declares the tiers certification actually proved — no green by absence", () => {
    const profile = runtimeCapabilityProfile("muse");
    expect(profile.ref).toBe("muse/v1");
    expect(profile.capabilities).toEqual({
      cache_telemetry: "adapter",
      cancellation: "adapter",
      intra_turn_fanout: "unsupported",
      media_read: "unsupported",
      session_resume: "native",
      structured_verdict: "fallback",
      tool_gate: "unsupported",
    });
  });

  it("tells the turn to work serially and never to rely on the unproven gate", () => {
    const guidance = runtimeCapabilityGuidance("muse").join("\n");
    expect(guidance).toContain("intra-turn fan-out: unsupported; unavailable—work serially");
    expect(guidance).toContain("tool gate: unsupported; do not rely on this surface");
  });

  it("publishes the documented Muse Spark roster and refuses an off-roster id honestly", async () => {
    const catalog = await readRuntimeModelCatalog("muse");
    expect(catalog).toMatchObject({ available: true, models: ["muse-spark-1.1", "muse-spark-1.2"] });
    expect(describeModelCatalogCheck(catalog, "muse-spark-1.2")).toContain("is served by the muse adapter");
    expect(describeModelCatalogCheck(catalog, "muse-spark-9")).toContain("is NOT served by the muse adapter");
  });

  it("keeps the credential and the brief out of argv", () => {
    const argv = museExecArgs({
      promptFile: "/tmp/brief.txt",
      workdir: "/tmp/w",
      model: "muse-spark-1.2",
      effort: "minimal",
      sessionId: "abc",
      maxModelSteps: 2,
    });
    expect(argv).toContain("--api-key-stdin");
    expect(argv).toContain("--prompt-file");
    expect(argv).toContain("--no-foreign-personal-context");
    expect(argv.join(" ")).not.toMatch(/--api-key[ =][^-]/);
  });

  it("writes the ONLY manifest shape ever observed to load, with no invented fields", () => {
    // Byte-shape of the F-PT-028 probe's captured `xdg-real/hooks.json`
    // (research/adapters/2026-08-07_muse-code-adapter-certification.md §7). Muse rejects
    // an unparseable hook group silently, so an extra `matcher` or `timeoutMs`
    // is a silent-failure risk with nothing to gain.
    const manifest = museManagedHookManifest("/bin/sh probe.sh") as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    expect(Object.keys(manifest)).toEqual(["hooks"]);
    expect(Object.keys(manifest.hooks).sort()).toEqual([
      "PermissionRequest",
      "PreToolUse",
      "SessionStart",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
    for (const [event, groups] of Object.entries(manifest.hooks)) {
      expect(groups, event).toHaveLength(1);
      // No `matcher`: the captured manifest carries none, on any event.
      expect(Object.keys(groups[0]!), event).toEqual(["hooks"]);
      const entries = groups[0]!["hooks"] as Array<Record<string, unknown>>;
      // No `timeoutMs`: the hook child bounds itself on the socket instead.
      expect(Object.keys(entries[0]!).sort(), event).toEqual(["command", "type"]);
      expect(entries[0]!["type"], event).toBe("command");
    }
  });

  it("recognizes a nested harness launch at every command position, and only there", () => {
    for (const command of [
      "muse exec --yolo 'go'",
      "cd /tmp && claude -p 'go'",
      "echo x; /usr/local/bin/codex exec",
      'sh -c "$(grok -p go)"',
    ]) {
      expect(invokesNestedHarness(command)).toBe(true);
    }
    for (const command of ["echo amuse", "cat museum.txt", "grep muse README.md"]) {
      expect(invokesNestedHarness(command)).toBe(false);
    }
  });
});

describe("CF-B26 budget guard — the cap stops the turn and spend stays attributed", () => {
  async function run(maxTurnBudgetUsd: number, inputTokens: number) {
    repo = await makeTempGitRepo();
    logRoot = await mkdtemp(join(tmpdir(), "cormidia-muse-budget-"));
    const dbl = museDouble(
      [
        script.turn({
          sessionId: "muse-budget",
          steps: [script.usageUpdate({ inputTokens, outputTokens: 100_000 })],
          outcome: script.success("kept going", { usage: { inputTokens: 10, outputTokens: 10 } }),
        }),
      ],
      { sessionLogRoot: logRoot },
    );
    return dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: repo.dir,
        role: doubleRole({ runtime: "muse", model: "muse-spark-1.2", maxTurnBudgetUsd }),
      }),
      { gate: () => ({ allow: true }) },
    );
  }

  it("under budget: the turn completes and no incident note is emitted", async () => {
    const result = await run(100, 1_000);
    expect(result.status).toBe("completed");
    expect(result.artifacts).toEqual([]);
    expect(result.errorCode).toBeUndefined();
  });

  it("over budget: failed + error_max_budget_usd + EXACTLY ONE incident note, spend retained", async () => {
    const result = await run(0.01, 1_000_000);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_max_budget_usd");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({ kind: "note", ref: "budget-overrun/muse-budget" });
    expect(result.artifacts[0]?.summary).toContain("Overrun = incident note, not silent spend");
    // Overrun is never a silent zero: the measured spend survives the stop.
    expect(result.usage.costUsd).toBeGreaterThan(0.01);
    expect(result.usage.costEstimated).toBe(true);
  });
});

describe("CF-B26 version bands — muse's decorated --version line, read without upgrading the install", () => {
  it("extracts the version from `Muse Code 0.1.0 (0.1.0-R708.1)`", () => {
    const detection = readBinaryVersion(fakeVersionCommand("Muse Code 0.1.0 (0.1.0-R708.1)"), []);
    expect(detection).toEqual({ detected: true, version: "0.1.0" });
    expect(bandForVersion(HARNESS_SUPPORT.muse, "0.1.0")).toBe("at_tested");
  });

  it("negative control: the build tag alone is never promoted into a version", () => {
    // `R708.1` is not version-shaped, so the line stays unreadable and banding
    // says `unknown` rather than inventing a pass.
    const detection = readBinaryVersion(fakeVersionCommand("Muse Code (R708.1) [beta]"), []);
    expect(detection).toEqual({ detected: true, version: "Muse Code (R708.1) [beta]" });
    expect(bandForVersion(HARNESS_SUPPORT.muse, "Muse Code (R708.1) [beta]")).toBe("unknown");
  });

  it("pins MUSE_NO_AUTO_UPDATE so reading a version never upgrades the provider", () => {
    // #224: Cormidia never installs or upgrades a provider. muse's launcher
    // self-updates on invocation unless this is set, so `doctor` would silently
    // move the operator off the certified build.
    expect(HARNESS_SUPPORT.muse.versionSource).toEqual({
      kind: "installed_binary",
      command: "muse",
      args: ["--version"],
      env: { MUSE_NO_AUTO_UPDATE: "1" },
    });
    const probe = fakeEnvProbeCommand();
    expect(readBinaryVersion(probe, [], { MUSE_NO_AUTO_UPDATE: "1" })).toEqual({ detected: true, version: "1" });
  });

  it("declares muse's bands against the certification record", () => {
    // floor === testedWith: the certified claim is a NEGATIVE one (no managed
    // hook fired), so an older build carries no gate evidence at all.
    expect(HARNESS_SUPPORT.muse.floor).toBe("0.1.0");
    expect(HARNESS_SUPPORT.muse.testedWith).toBe("0.1.0");
    expect(HARNESS_SUPPORT.muse.testedEvidence).toBe("research/adapters/2026-08-07_muse-code-adapter-certification.md");
    expect(detectHarnessVersion).toBeTypeOf("function");
  });
});

describe("CF-B26 registration — muse never inherits another harness's answer", () => {
  it("reports Meta as the provider family, never a pi namespace", () => {
    // A pi/... family would let a Meta turn count as independent of a
    // pi-hosted Meta model, corrupting builder != reviewer accounting.
    expect(configuredProviderFamily({ harness: "muse", model: "muse-spark-1.2", effort: "medium" })).toBe("meta");
  });

  it("reports an estimated running guard, not pi's measured one", () => {
    // muse streams no usage and the vendor reports no dollars, so cost is a
    // Cormidia estimate — but the durable log is re-read each model step, so
    // the guard genuinely runs.
    expect(costEnforcementFor("muse")).toBe("estimated_progress_no_strict_provider_cap");
  });
});

const versionCommandDir = mkdtempSync(join(tmpdir(), "cormidia-muse-version-"));
let versionCommandSeq = 0;

/** A tiny executable printing `line`, so the real `execFileSync` path runs. */
function fakeVersionCommand(line: string): string {
  const script = join(versionCommandDir, `v${(versionCommandSeq += 1)}.sh`);
  writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(line)}\n`, { mode: 0o755 });
  return script;
}

/** Echoes MUSE_NO_AUTO_UPDATE, proving the declared env reaches the child. */
function fakeEnvProbeCommand(): string {
  const script = join(versionCommandDir, `env${(versionCommandSeq += 1)}.sh`);
  writeFileSync(script, "#!/bin/sh\nprintf '%s\\n' \"$MUSE_NO_AUTO_UPDATE\"\n", { mode: 0o755 });
  return script;
}
