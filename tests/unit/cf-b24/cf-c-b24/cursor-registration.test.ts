// CF-B24 / CF-C-B24 — HB-137 — boundary-map.md B-24; contracts/B-24-cursor.md.

// CF-B24 registration unit pins (#338): the surfaces a new harness has to
// appear on are exhaustive by construction, and every one of them tells the
// truth about Cursor rather than inheriting another adapter's default.
//
// The fall-through branches pinned here are the ones a new RuntimeKind slides
// into silently: cost enforcement, provider family, and the doctor roster all
// compiled fine while answering for the wrong provider.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TURN_ASSIGNMENT_HARNESSES, configuredProviderFamily } from "../../../../src/runtime/assignment.js";
import { runtimeCapabilityProfile, resolvedRuntimeCapabilities } from "../../../../src/runtime/capabilities.js";
import { HARNESS_SUPPORT, bandForVersion } from "../../../../src/runtime/harness-support.js";
import { normalizeCalendarVersion } from "../../../../src/runtime/harness-version-detect.js";
import { readRuntimeModelCatalog, describeModelCatalogCheck } from "../../../../src/runtime/model-catalog.js";
import { RUNTIME_KINDS, getRuntime } from "../../../../src/runtime/registry.js";
import { cursorDenyRulesForRole } from "../../../../src/runtime/role-shaping.js";
import { costEnforcementFor } from "../../../../src/runtime/turn-budget.js";
import { probeRuntimeReadiness } from "../../../../src/runtime/readiness.js";
import { startCursorGateBridge } from "../../../../src/runtime/adapters/cursor-gate-bridge.js";
import { makeTempGitRepo, type TempGitRepo } from "../../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
const scratch: string[] = [];
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CF-B24 — cursor is registered on every exhaustive surface", () => {
  it("appears in the doctor roster, the assignment validator, and the runtime factory", () => {
    expect(RUNTIME_KINDS).toContain("cursor");
    expect(TURN_ASSIGNMENT_HARNESSES).toContain("cursor");
    expect(getRuntime("cursor").kind).toBe("cursor");
    // The roster is derived from the registry, so the two can never diverge.
    expect([...RUNTIME_KINDS].sort()).toEqual([...TURN_ASSIGNMENT_HARNESSES].sort());
  });

  it("declares the certified capability profile — no tier claimed above what was proven", () => {
    const profile = runtimeCapabilityProfile("cursor");
    expect(profile.ref).toBe("cursor/v1");
    expect(profile.capabilities).toEqual({
      cache_telemetry: "adapter",
      cancellation: "adapter",
      intra_turn_fanout: "native",
      media_read: "unsupported",
      session_resume: "native",
      structured_verdict: "fallback",
      tool_gate: "adapter",
    });
    expect(profile.cache).toEqual({
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"],
    });
    // structured_verdict is a fallback, not an absence, so it stays in the
    // resolved projection. `media_read` IS an absence until CF-B31-L3 certifies
    // it, so it is excluded — an uncertified surface is never advertised.
    expect(resolvedRuntimeCapabilities("cursor")).toEqual([
      "cache_telemetry",
      "cancellation",
      "intra_turn_fanout",
      "session_resume",
      "structured_verdict",
      "tool_gate",
    ]);
  });

  it("records terminal-only cost enforcement rather than inheriting pi's measured-progress claim", () => {
    expect(costEnforcementFor("cursor")).toBe("estimated_terminal_only_no_progress");
    expect(costEnforcementFor("pi")).toBe("measured_progress_no_strict_provider_cap");
  });

  it("keeps its own provider family instead of being labelled a pi model", () => {
    expect(configuredProviderFamily({ harness: "cursor", model: "claude-opus-5-thinking-high", effort: "high" })).toBe(
      "cursor",
    );
    // A routed third-party model must not be able to claim independent
    // Anthropic/OpenAI provenance for the builder != reviewer pairing.
    expect(configuredProviderFamily({ harness: "cursor", model: "gpt-5.6-sol-high", effort: "high" })).toBe("cursor");
  });

  it("reports the model roster as honestly unavailable and names why", async () => {
    const catalog = await readRuntimeModelCatalog("cursor");
    expect(catalog.available).toBe(false);
    const described = describeModelCatalogCheck(catalog, "claude-opus-5-thinking-high");
    expect(described).toContain("NOT VERIFIED");
    expect(described).toContain("cursor-agent --list-models");
    expect(described).not.toContain("undefined");
  });

  it("shapes only the roles that have forbidden acts, in Cursor's own token syntax", () => {
    expect(cursorDenyRulesForRole("planner")).toEqual([]);
    const builder = cursorDenyRulesForRole("builder");
    expect(builder).toContain("Shell(gh pr merge:*)");
    expect(builder).toContain("Shell(kubectl:*)");
    expect(builder).toContain("Write(~/.cursor/**)");
    // Cursor has no Edit() token; every rule must be expressible or absent,
    // never silently dropped into a spelling the CLI ignores.
    expect(builder.every((rule) => /^(Shell|Read|Write|WebFetch|Mcp)\(/.test(rule))).toBe(true);
  });

  it("declares version bands from an installed binary, normalizing the calendar version", () => {
    const declaration = HARNESS_SUPPORT["cursor"];
    expect(declaration.versionSource).toEqual({
      kind: "installed_binary",
      command: "cursor-agent",
      args: ["--version"],
    });
    expect(declaration.testedEvidence).toBe("research/adapters/2026-08-07_cursor-adapter-certification.md");
    // `YYYY.MM.DD-<sha>` orders exactly like semver once the padding and the
    // build sha are gone; the sha is `+build` under a different spelling.
    expect(normalizeCalendarVersion("2026.08.04-aaa8809")).toBe("2026.8.4");
    expect(normalizeCalendarVersion("2026.12.31")).toBe("2026.12.31");
    expect(bandForVersion(declaration, normalizeCalendarVersion("2026.08.04-aaa8809"))).toBe("at_tested");
    expect(bandForVersion(declaration, normalizeCalendarVersion("2026.08.09-deadbee"))).toBe("newer_than_tested");
    expect(bandForVersion(declaration, normalizeCalendarVersion("2026.07.30-cafe123"))).toBe("below_floor");
    // Anything that is neither shape stays untouched so banding can call it
    // unknown rather than guess.
    expect(normalizeCalendarVersion("not-a-version")).toBe("not-a-version");
    expect(bandForVersion(declaration, normalizeCalendarVersion("not-a-version"))).toBe("unknown");
  });

  it("readiness is wired and never claims ready from binary presence alone", async () => {
    const result = await probeRuntimeReadiness(
      { runtime: "cursor", models: ["auto"] },
      {
        cursor: async () => ({
          status: "unauthenticated",
          errorCode: "error_adapter_unauthenticated",
          detail: "seeded",
        }),
      },
    );
    expect(result.runtime).toBe("cursor");
    expect(result.status).toBe("unauthenticated");
    expect(result.billable).toBe(false);
  });
});

describe("CF-B24 — permission-config integrity refuses before provider construction", () => {
  it("refuses when operator-global config allows an act the role denies", async () => {
    repo = await makeTempGitRepo();
    const dir = mkdtempSync(join(tmpdir(), "cormidia-cursor-global-"));
    scratch.push(dir);
    const globalConfigPath = join(dir, "cli-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ permissions: { allow: ["Shell(gh pr merge:*)"] } }), "utf8");
    await expect(
      startCursorGateBridge(repo.dir, { gate: () => ({ allow: true }) }, [], {
        denyRules: cursorDenyRulesForRole("builder"),
        globalConfigPath,
      }),
    ).rejects.toThrow(/never widens through provider config/);
  });

  it("refuses when operator-global config is unparseable", async () => {
    repo = await makeTempGitRepo();
    const dir = mkdtempSync(join(tmpdir(), "cormidia-cursor-global-bad-"));
    scratch.push(dir);
    const globalConfigPath = join(dir, "cli-config.json");
    writeFileSync(globalConfigPath, "{ not json", "utf8");
    await expect(
      startCursorGateBridge(repo.dir, { gate: () => ({ allow: true }) }, [], {
        denyRules: cursorDenyRulesForRole("builder"),
        globalConfigPath,
      }),
    ).rejects.toThrow(/unparseable/);
  });

  it("an unrelated operator-global allow entry does not block the turn", async () => {
    repo = await makeTempGitRepo();
    const dir = mkdtempSync(join(tmpdir(), "cormidia-cursor-global-ok-"));
    scratch.push(dir);
    const globalConfigPath = join(dir, "cli-config.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(globalConfigPath, JSON.stringify({ permissions: { allow: ["Shell(ls)"] } }), "utf8");
    const bridge = await startCursorGateBridge(repo.dir, { gate: () => ({ allow: true }) }, [], {
      denyRules: cursorDenyRulesForRole("builder"),
      globalConfigPath,
    });
    try {
      // The handshake proved the whole wire end to end but is never counted
      // as a real gate consultation.
      expect(bridge.consulted).toBe(0);
      expect(bridge.allowed).toBe(0);
    } finally {
      await bridge.close();
    }
  });
});
