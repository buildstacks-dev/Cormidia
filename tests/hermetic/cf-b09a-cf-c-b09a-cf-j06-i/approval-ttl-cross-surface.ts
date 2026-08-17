// CF-B09a / CF-C-B09A / CF-J06-I — HB-P5 — F-PT-008 cross-surface TTL pin.
// Imported by the existing grant-expiry disposition spec so the detector stays
// with the ratified product decision it defends.

import { describe, expect, it } from "vitest";
import { registerApprovalPolicyProductionWiringTests } from "./approval-policy-production-wiring.js";
import {
  APPROVAL_TTL_FORBIDDEN_TEXT,
  APPROVAL_TTL_TEXT_PINS,
  auditApprovalTtlSurfaces,
  readApprovalTtlSurfaces,
  reconciledApprovalTtlFixture,
  replaceRequired,
} from "./approval-ttl-surface-audit.js";

const HOUR_MS = 60 * 60 * 1000;

export function registerApprovalTtlCrossSurfaceTests(): void {
  registerApprovalPolicyProductionWiringTests();
  describe("F-PT-008 — approval-TTL cross-surface closure", () => {
    it("keeps approval grants at 48h while pending items and objective grants remain independently 24h", () => {
      expect(auditApprovalTtlSurfaces(readApprovalTtlSurfaces())).toEqual([]);
    });

    it("has a non-vacuous fully reconciled fixture", () => {
      expect(auditApprovalTtlSurfaces(reconciledApprovalTtlFixture())).toEqual([]);
    });

    it.each(APPROVAL_TTL_TEXT_PINS)("seeded $kind drift in $label fires", (pin) => {
      const seeded = reconciledApprovalTtlFixture();
      seeded.text[pin.surface] = replaceRequired(seeded.text[pin.surface], pin.expected, pin.drift);
      expect(auditApprovalTtlSurfaces(seeded)).toContainEqual(expect.stringContaining(pin.label));
    });

    it.each(APPROVAL_TTL_FORBIDDEN_TEXT)("seeded retained active wording in $label fires", (forbidden) => {
      const seeded = reconciledApprovalTtlFixture();
      seeded.text[forbidden.surface] += `${forbidden.text}\n`;
      expect(auditApprovalTtlSurfaces(seeded)).toContain(`${forbidden.label} retains active stale wording`);
    });

    it.each([
      ["grantTtlMs", 24 * HOUR_MS, "runtime approval grant TTL is not 48h"],
      ["pendingTtlMs", 48 * HOUR_MS, "runtime pending-item TTL is not 24h"],
      ["objectiveGrantTtlMs", 48 * HOUR_MS, "runtime objective-grant TTL is not 24h"],
    ] as const)("seeded runtime %s drift fires", (field, value, problem) => {
      const seeded = reconciledApprovalTtlFixture();
      seeded[field] = value;
      expect(auditApprovalTtlSurfaces(seeded)).toContain(problem);
    });
  });
}
