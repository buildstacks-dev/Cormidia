import type { ApprovalTtlForbiddenText, ApprovalTtlTextPin } from "./approval-ttl-surface-registry.js";

const ADJACENT_PIN_ROWS = [
  [
    "testsReadme",
    "disposition",
    "tests README F-PT-008 status",
    "F-PT-008 is resolved-ratified: grant expiry reopens the original approval item with its append-only decision history intact",
    "F-PT-006 / F-PT-008 cells",
  ],
  [
    "typedExecutorComments",
    "disposition",
    "B-17 adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "BLOCKED:F-PT-008 — the disposition of the approval ITEM",
  ],
  [
    "releaseJourneyComments",
    "disposition",
    "J-17 adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "execution — is BLOCKED:F-PT-008",
  ],
  [
    "appRemovalSupport",
    "disposition",
    "INV-010 adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "BLOCKED: F-PT-008 (grant-expiry item disposition)",
  ],
  [
    "learningCompactionComments",
    "disposition",
    "learning compaction adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "BLOCKED:F-PT-008 — grant-EXPIRY item disposition",
  ],
  [
    "authoritySeedComments",
    "disposition",
    "INV-001 adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "Adjacent parked finding — F-PT-008",
  ],
  [
    "authoritySeedComments",
    "disposition",
    "INV-001 expired-grant case title",
    "an expired grant is never authority (F-PT-008 disposition is covered by CF-B09a)",
    "item disposition BLOCKED:F-PT-008",
  ],
  [
    "objectiveGrantTests",
    "objective",
    "objective-grant test defaults",
    "creates an ordinary grant with independent objective-grant defaults (24h/20 uses)",
    "creates an ordinary grant over grantable classes, with the A1-mirror defaults",
  ],
  [
    "learningJourneyComments",
    "disposition",
    "J-12 adjacent F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item with append-only history",
    "BLOCKED:F-PT-008 — grant-EXPIRY item disposition",
  ],
] as const;

export const APPROVAL_TTL_ADJACENT_PINS: readonly ApprovalTtlTextPin[] = ADJACENT_PIN_ROWS.map(
  ([surface, kind, label, expected, drift]) => ({ surface, kind, label, expected, drift }),
);

const ADJACENT_FORBIDDEN_ROWS = [
  ["testsReadme", "tests README blocked F-PT-008", "F-PT-006 / F-PT-008 cells"],
  ["typedExecutorComments", "B-17 blocked F-PT-008", "BLOCKED:F-PT-008"],
  ["releaseJourneyComments", "J-17 blocked F-PT-008", "BLOCKED:F-PT-008"],
  ["appRemovalSupport", "INV-010 blocked F-PT-008", "BLOCKED: F-PT-008"],
  ["learningCompactionComments", "learning compaction blocked F-PT-008", "BLOCKED:F-PT-008"],
  ["authoritySeedComments", "INV-001 parked F-PT-008", "Adjacent parked finding — F-PT-008"],
  ["authoritySeedComments", "INV-001 blocked F-PT-008", "BLOCKED:F-PT-008"],
  ["objectiveGrantTests", "objective test A1 coupling", "A1-mirror defaults"],
  ["learningJourneyComments", "J-12 blocked F-PT-008", "BLOCKED:F-PT-008"],
] as const;

export const APPROVAL_TTL_ADJACENT_FORBIDDEN: readonly ApprovalTtlForbiddenText[] = ADJACENT_FORBIDDEN_ROWS.map(
  ([surface, label, text]) => ({ surface, label, text }),
);
