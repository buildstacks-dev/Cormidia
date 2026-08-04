// CF-INV-002 — seed (b): a provider tool type the classifier has never seen
// MUST fail closed, not default-allow. In Cormidia the classifier is a
// critical-EFFECT detector whose default is routine (gate.ts: "false positives
// cost a human tap, false negatives cost an incident"); the fail-closed for an
// un-gateable *tool route* therefore lives at the adapter, which DISABLES every
// alternate execution/discovery channel the gate hook cannot intercept
// (src/runtime/adapters/codex-gate-bridge.ts: "unified_exec, apps, and web
// search are disabled by codexAppServerArgs because current Codex hooks do not
// intercept those alternate paths completely"). A channel left enabled = a new
// tool route around the gate = the default-allow INV-002(b) forbids.
//
// Risk E-1 / T-11 (adapter enforcement: the gate hook sees every real tool
// path). L1 — pure assertions over the args the adapter builds and over the
// hook-input normalizer's fail-closed branch; no process, no socket.
//
// Detector family = `enabledUngateableChannels` (below). Negative control: a
// seeded-allow args array that re-enables `unified_exec` must be CAUGHT.

import { describe, expect, it } from "vitest";
import {
  codexAppServerArgs,
  normalizeCodexHookActions,
} from "../../../src/runtime/adapters/codex-gate-bridge.js";

/** The alternate channels current Codex hooks cannot fully intercept, each with
 *  the exact disable token the adapter must emit. If a channel's token is
 *  absent from the args, that channel is live and un-gateable — fail-open. */
const UNGATEABLE_CHANNELS: ReadonlyArray<{ channel: string; disableTokens: readonly string[] }> = [
  { channel: "unified_exec", disableTokens: ["features.unified_exec=false"] },
  { channel: "apps", disableTokens: ["features.apps=false"] },
  { channel: "plugins", disableTokens: ["features.plugins=false"] },
  { channel: "in_app_browser", disableTokens: ["features.in_app_browser=false"] },
  { channel: "plugin_sharing", disableTokens: ["features.plugin_sharing=false"] },
  { channel: "web_search", disableTokens: ["tools.web_search=false", 'web_search="disabled"'] },
  { channel: "view_image", disableTokens: ["tools.view_image=false"] },
];

/** The detector: which un-gateable channels are NOT provably disabled by these
 *  args. Empty = every alternate route is fail-closed. */
function enabledUngateableChannels(args: readonly string[]): string[] {
  return UNGATEABLE_CHANNELS.filter(
    ({ disableTokens }) => !disableTokens.every((token) => args.includes(token)),
  ).map(({ channel }) => channel);
}

describe("CF-INV-002 (seed b / T-11) — Codex un-gateable tool routes fail closed, not default-allow (L1, HB-010)", () => {
  it("covers the un-gateable channel set (no green by absence)", () => {
    expect(UNGATEABLE_CHANNELS.length).toBeGreaterThanOrEqual(7);
  });

  it("codexAppServerArgs disables EVERY alternate channel the gate hook cannot intercept", () => {
    const args = codexAppServerArgs();
    expect(enabledUngateableChannels(args)).toEqual([]);
  });

  it("the gate hook is enabled and matches every gateable tool path (T-11: the hook sees every real tool)", () => {
    const args = codexAppServerArgs();
    expect(args).toContain("features.hooks=true");
    // The ephemeral, already-vetted hook must be runnable for the boundary to hold.
    expect(args).toContain("bypass_hook_trust=true");
    const matcherLine = args.find((a) => a.includes("hooks.PreToolUse"));
    expect(matcherLine).toBeDefined();
    // Bash, apply_patch, file writes, and every MCP tool route through the hook
    // into Cormidia's in-process GateFn — the surface the gate actually classifies.
    expect(matcherLine).toContain('"^(Bash|apply_patch|Edit|Write|mcp__.*)$"');
  });

  it("negative control: a seeded-allow args array that re-enables unified_exec is CAUGHT by the detector", () => {
    // Seed the INV-002(b) violation: an operator/regression flips one
    // un-gateable channel back on. The detector must fire (report the channel).
    const seededAllow = codexAppServerArgs().map((a) =>
      a === "features.unified_exec=false" ? "features.unified_exec=true" : a,
    );
    expect(enabledUngateableChannels(seededAllow)).toEqual(["unified_exec"]);

    // A second seed: the web_search runtime disable dropped while the feature
    // flag stays — a partial disable is still fail-open and must be caught.
    const partialWebSearch = codexAppServerArgs().filter((a) => a !== 'web_search="disabled"');
    expect(enabledUngateableChannels(partialWebSearch)).toContain("web_search");

    // The real args do NOT trip the detector (proves it is not a constant).
    expect(enabledUngateableChannels(codexAppServerArgs())).toEqual([]);
  });

  it("the hook-input normalizer fails closed on an input shape it has never seen (unknown → throw → deny)", () => {
    // The child hook / bridge turns any normalizer throw into allow:false
    // (asserted end-to-end in the hermetic bridge suite). Here: an unrecognized
    // hook-input SHAPE must throw rather than silently produce an empty,
    // trivially-allowed action list.
    expect(() => normalizeCodexHookActions(42, "/wd")).toThrow();
    expect(() => normalizeCodexHookActions(null, "/wd")).toThrow();
    expect(() => normalizeCodexHookActions("a string", "/wd")).toThrow();

    // Negative control on the normalizer: a KNOWN forbidden write shape does
    // NOT throw — it yields a concrete edit action that the gate can then
    // classify critical (so the fail-closed above is a real discriminator, not
    // a normalizer that throws on everything).
    const actions = normalizeCodexHookActions(
      { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: roles.yaml\n@@\n-x\n+y\n*** End Patch" } },
      "/wd",
    );
    expect(actions).toEqual([{ tool: "edit", input: { path: "roles.yaml" } }]);
  });
});
