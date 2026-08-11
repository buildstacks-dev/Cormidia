// Traceability: CF-B09b · HB-011; CF-C-B09B · HB-011 · boundary-map.md B-09b unattended-profile prohibition and zero-decision clauses; contracts/B-09b-grants.md.

// CF-J18-S / CF-B09b-* — product implementation of the ratified unattended
// sandbox profile. Layer 2: real product surface, no network or provider.

import { describe, expect, it } from "vitest";
import {
  authorizeUnattendedValidationAction,
  createUnattendedValidationProfile,
} from "../../../src/org/validation-test-mode.js";

const target = { org: "validation-org", app: "sandbox-alpha", repo: "owner/sandbox-alpha" };

describe("ratified unattended validation profile", () => {
  it("authorizes only bounded campaign spend without creating a human decision", () => {
    const profile = createUnattendedValidationProfile(target);
    expect(
      authorizeUnattendedValidationAction(profile, target, {
        kind: "campaign_budget",
        provider_turns: 24,
        equiv_usd: 100,
        release_campaign: true,
      }),
    ).toMatchObject({ authorized: true, reason_code: "profile_auto_grant", human_decision_rows: 0 });
  });

  it.each([
    {
      action: { kind: "external_publication", target: "production" } as const,
      reason: "external_publication_hard_gate",
    },
    {
      action: { kind: "non_sandbox_effect", target: "owner/production" } as const,
      reason: "non_sandbox_effect_hard_gate",
    },
    { action: { kind: "critical_operation", operation: "deploy" } as const, reason: "critical_operation_hard_gate" },
  ])("keeps $action.kind hard-gated", ({ action, reason }) => {
    const profile = createUnattendedValidationProfile(target);
    expect(authorizeUnattendedValidationAction(profile, target, action)).toMatchObject({
      authorized: false,
      reason_code: reason,
      human_decision_rows: 0,
    });
  });

  it("refuses a lookalike repository and an over-ceiling budget", () => {
    const profile = createUnattendedValidationProfile(target);
    expect(
      authorizeUnattendedValidationAction(
        profile,
        { ...target, repo: "owner/sandbox-alpha-copy" },
        {
          kind: "campaign_budget",
          provider_turns: 1,
          equiv_usd: 1,
          release_campaign: false,
        },
      ).reason_code,
    ).toBe("non_sandbox_effect_hard_gate");
    expect(
      authorizeUnattendedValidationAction(profile, target, {
        kind: "campaign_budget",
        provider_turns: 3,
        equiv_usd: 1,
        release_campaign: false,
      }).reason_code,
    ).toBe("spend_ceiling_exceeded");
  });

  it("negative control: runtime-shaped input cannot widen the auto-grant category", () => {
    expect(() =>
      createUnattendedValidationProfile({
        ...target,
        permittedAutoGrantCategories: ["external_publication" as "campaign_budget"],
      }),
    ).toThrow(/only campaign_budget/);
    const profile = createUnattendedValidationProfile(target);
    expect(() =>
      authorizeUnattendedValidationAction(profile, target, {
        kind: "campaign_budget",
        provider_turns: -1,
        equiv_usd: Number.NaN,
        release_campaign: false,
      }),
    ).toThrow(/non-negative finite spend counters/);
  });
});
