// Tests the provider-sandbox environment policy without constructing a
// provider runtime. The canonical values must replace interactive near-misses
// while preserving every unrelated caller-supplied environment value.

import { describe, expect, it } from "vitest";
import {
  NON_INTERACTIVE_ENV,
  withNonInteractiveEnv,
} from "../../src/runtime/non-interactive-env.js";

describe("provider non-interactive environment", () => {
  it("uses the canonical headless values", () => {
    expect(NON_INTERACTIVE_ENV).toEqual({
      CI: "true",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("overrides interactive near-misses and preserves unrelated values", () => {
    expect(
      withNonInteractiveEnv({
        CI: "false",
        NPM_CONFIG_YES: "false",
        DEBIAN_FRONTEND: "dialog",
        GIT_TERMINAL_PROMPT: "1",
        HOME: "/provider-home",
        OPERON_CAMPAIGN_MARKER: "keep-me",
      }),
    ).toEqual({
      CI: "true",
      NPM_CONFIG_YES: "true",
      DEBIAN_FRONTEND: "noninteractive",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/provider-home",
      OPERON_CAMPAIGN_MARKER: "keep-me",
    });
  });
});
