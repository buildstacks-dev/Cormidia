import type { ApprovalTtlForbiddenText, ApprovalTtlTextPin } from "./approval-ttl-surface-registry.js";

const POLICY_PIN_ROWS = [
  [
    "purpose",
    "grant",
    "PURPOSE approval grant",
    "approval grants expire after 48 h",
    "approval grants expire after 24 h",
  ],
  [
    "purpose",
    "pending",
    "PURPOSE pending item",
    "undecided approval items expire independently after 24 h",
    "undecided approval items expire independently after 48 h",
  ],
  [
    "purpose",
    "objective",
    "PURPOSE objective grant",
    "ordinary objective grants separately default to 24 h",
    "ordinary objective grants separately default to 48 h",
  ],
  ["cli", "grant", "approvals CLI grant", "multi-use grant (TTL 48h, 20 uses", "multi-use grant (TTL 24h, 20 uses"],
  [
    "cli",
    "objective",
    "objective CLI defaults",
    "ordinary objective-grant defaults (24h/20 uses); its own defaults are 12h/10 uses",
    "ordinary defaults",
  ],
  ["approvalsDesign", "grant", "approval design grant", "grant TTL default **48h**", "grant TTL default **24h**"],
  ["approvalsDesign", "pending", "approval design pending item", "TTL — **default 24h**", "TTL — **default 48h**"],
  [
    "approvalsDesign",
    "objective",
    "approval design objective grant",
    "ordinary objective-grant defaults (24h/20), independently of A1's 48h approval-grant TTL",
    "ordinary objective-grant defaults (48h/20), inherited from A1",
  ],
  ["boundaryClock", "grant", "B-06 grant", "grant TTL 48 h", "grant TTL 24 h"],
  ["approvalContinuation", "grant", "B-09a grant", "Defaults: grant **48 h**", "Defaults: grant **24 h**"],
  [
    "approvalContinuation",
    "pending",
    "B-09a pending item",
    "undecided-item (pending) TTL **24 h**",
    "undecided-item (pending) TTL **48 h**",
  ],
  [
    "approvalDecisionEntry",
    "grant",
    "B-09b approval grant",
    "Approval grant TTL 48 h default",
    "Approval grant TTL 24 h default",
  ],
  [
    "approvalDecisionEntry",
    "objective",
    "B-09b objective grant",
    "objective-grant defaults (24 h / 20 uses)",
    "objective-grant defaults (48 h / 20 uses)",
  ],
  ["systemMap", "grant", "system-map grant", "Grant TTL expiry (48 h default)", "Grant TTL expiry (24 h default)"],
  [
    "operatorRunbook",
    "disposition",
    "operator runbook F-PT-008 disposition",
    "**F-PT-008 resolved-ratified** (B-09a §3): expiry reopens the original item",
    "**OPEN DESIGN QUESTION — F-PT-008** (B-09a §3)",
  ],
  [
    "operatorRunbook",
    "grant",
    "operator runbook approval grant",
    "approval-grant default 48h",
    "approval-grant default 24h",
  ],
  [
    "operatorRunbook",
    "pending",
    "operator runbook pending item",
    "pending-item default 24h",
    "pending-item default 48h",
  ],
  [
    "objectiveGrantSource",
    "objective",
    "objective-grants source defaults",
    "Objective-grant defaults are independently 24h / 20 uses, not A1's 48h approval-grant TTL",
    "Ordinary defaults mirror the A1 grant defaults (24h TTL, 20 uses)",
  ],
  [
    "objectiveGrantSource",
    "objective",
    "objective-grants TTL refusal",
    "TTL strictly shorter than the ordinary objective-grant default (24h)",
    "TTL strictly shorter than the ordinary grant default",
  ],
  [
    "objectiveGrantSource",
    "objective",
    "objective-grants use refusal",
    "use cap strictly shorter than the ordinary objective-grant default (20 uses)",
    "use cap strictly shorter than the ordinary grant default",
  ],
  [
    "grantLifecycleComments",
    "disposition",
    "grant lifecycle F-PT-008 comment",
    "F-PT-008 is resolved-ratified: grant expiry reopens the original item",
    "BLOCKED:F-PT-008 (grant-expiry ITEM disposition)",
  ],
  [
    "grantLifecycleComments",
    "grant",
    "grant lifecycle TTL comment",
    "Ratified default TTL: exactly 48 hours from decision time.",
    "Ratified default TTL: exactly 24 hours from decision time.",
  ],
  [
    "resumeComments",
    "disposition",
    "J-06 F-PT-008 comment",
    "F-PT-008 is resolved-ratified: expiry reopens the original item",
    "ITEM DISPOSITION IS BLOCKED:F-PT-008",
  ],
  ["resumeComments", "grant", "J-06 grant TTL comment", '"Grant TTL (48 h [doc])', '"Grant TTL (24 h [doc])'],
] as const;

export const APPROVAL_TTL_POLICY_PINS: readonly ApprovalTtlTextPin[] = POLICY_PIN_ROWS.map(
  ([surface, kind, label, expected, drift]) => ({ surface, kind, label, expected, drift }),
);

const POLICY_FORBIDDEN_ROWS = [
  ["purpose", "PURPOSE 24h approval grant", "approval grants expire after 24 h"],
  ["cli", "CLI 24h approval grant", "multi-use grant (TTL 24h, 20 uses"],
  ["cli", "objective CLI ambiguous defaults", "strictly shorter than the ordinary defaults"],
  ["boundaryClock", "B-06 24h approval grant", "grant TTL 24 h"],
  ["approvalDecisionEntry", "B-09b 24h approval grant", "Grant TTL 24 h default"],
  ["systemMap", "system-map 24h approval grant", "Grant TTL expiry (24 h default)"],
  [
    "approvalsDesign",
    "approval design A1/objective coupling",
    "shorter than the ordinary defaults (24h/20, mirroring A1)",
  ],
  [
    "approvalDecisionEntry",
    "B-09b ambiguous objective defaults",
    "strictly below** the ordinary defaults (24 h / 20 uses)",
  ],
  ["objectiveGrantSource", "objective source A1 coupling", "Ordinary defaults mirror the A1 grant defaults"],
  ["objectiveGrantSource", "objective TTL ambiguous default", "TTL strictly shorter than the ordinary grant default"],
  [
    "objectiveGrantSource",
    "objective use ambiguous default",
    "use cap strictly shorter than the ordinary grant default",
  ],
  ["operatorRunbook", "operator runbook open F-PT-008", "OPEN DESIGN QUESTION — F-PT-008"],
  ["grantLifecycleComments", "grant lifecycle blocked F-PT-008", "BLOCKED:F-PT-008 (grant-expiry ITEM disposition)"],
  [
    "grantLifecycleComments",
    "grant lifecycle 24h TTL comment",
    "Ratified default TTL: exactly 24 hours from decision time.",
  ],
  ["resumeComments", "J-06 blocked F-PT-008", "ITEM DISPOSITION IS BLOCKED:F-PT-008"],
  ["resumeComments", "J-06 24h TTL comment", '"Grant TTL (24 h [doc])'],
] as const;

export const APPROVAL_TTL_POLICY_FORBIDDEN: readonly ApprovalTtlForbiddenText[] = POLICY_FORBIDDEN_ROWS.map(
  ([surface, label, text]) => ({ surface, label, text }),
);
