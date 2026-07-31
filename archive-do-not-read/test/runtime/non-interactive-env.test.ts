// Tests the provider-sandbox environment policy without constructing a
// provider runtime. The canonical values must replace interactive near-misses
// while preserving every unrelated caller-supplied environment value.

import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_BUILD_POLICY_ENV,
  NON_INTERACTIVE_ENV,
  withDependencyBuildPolicy,
  withNonInteractiveEnv,
} from "../../src/runtime/non-interactive-env.js";

// The overlay is pinned exactly, on purpose: a key that is silently added, or
// added under a prefix the tool ignores, is how a "fix" here ships inert.
// ISSUE-029 grew the set by PNPM_CONFIG_IGNORE_SCRIPTS — a headless sandbox is
// not enough on its own, because pnpm 11 answers an unanswerable build question
// by writing a placeholder into the repo rather than by prompting.
describe("provider non-interactive environment", () => {
  it("uses the canonical headless values", () => {
    expect(NON_INTERACTIVE_ENV).toEqual({
      CI: "true",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      GIT_TERMINAL_PROMPT: "0",
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
    });
  });

  it("carries the deny-by-default dependency build policy", () => {
    expect(NON_INTERACTIVE_ENV).toMatchObject(DEPENDENCY_BUILD_POLICY_ENV);
  });

  it("overrides interactive near-misses and preserves unrelated values", () => {
    expect(
      withNonInteractiveEnv({
        CI: "false",
        NPM_CONFIG_YES: "false",
        DEBIAN_FRONTEND: "dialog",
        GIT_TERMINAL_PROMPT: "1",
        PNPM_CONFIG_IGNORE_SCRIPTS: "false",
        HOME: "/provider-home",
        OPERON_CAMPAIGN_MARKER: "keep-me",
      }),
    ).toEqual({
      CI: "true",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      GIT_TERMINAL_PROMPT: "0",
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
      HOME: "/provider-home",
      OPERON_CAMPAIGN_MARKER: "keep-me",
    });
  });

  it("applies the build policy alone for a caller that owns the rest of its env", () => {
    // The quality-gate subprocess keeps its own CI=1 (Stage 3) and must not have
    // the rest of the provider overlay imposed on it.
    expect(withDependencyBuildPolicy({ CI: "1", PATH: "/bin" })).toEqual({
      CI: "1",
      PATH: "/bin",
      PNPM_CONFIG_IGNORE_SCRIPTS: "true",
    });
  });
});
