export const APPROVAL_TTL_SURFACE_PATHS = {
  purpose: ["docs", "PURPOSE.md"],
  cli: ["src", "cli.ts"],
  approvalsDesign: ["docs", "approvals", "design.md"],
  boundaryClock: ["validation-design", "contracts", "B-06-clock.md"],
  approvalContinuation: ["validation-design", "contracts", "B-09a-approval-continuation.md"],
  approvalDecisionEntry: ["validation-design", "contracts", "B-09b-approval-decision-entry.md"],
  systemMap: ["validation-design", "system-map.md"],
  operatorRunbook: ["validation-design", "operator-triage-runbook.md"],
  objectiveGrantSource: ["src", "org", "objective-grants.ts"],
  grantLifecycleComments: [
    "tests",
    "hermetic",
    "cf-c-b09b-cf-sm-grant-c-cf-sm-grant-i-cf-sm-grant-l-cf-sm-grant-r",
    "cf-sm-grant-lir.test.ts",
  ],
  resumeComments: ["tests", "hermetic", "cf-j06-i-cf-j06-r-cf-j06-rc-cf-j06-s", "cf-j06-i.test.ts"],
  testsReadme: ["tests", "README.md"],
  typedExecutorComments: ["tests", "hermetic", "cf-b17-cf-c-b17", "cf-b17.test.ts"],
  releaseJourneyComments: ["tests", "hermetic", "cf-j17-i-cf-j17-r-cf-j17-rc-cf-j17-s", "cf-j17-s.test.ts"],
  appRemovalSupport: ["tests", "hermetic", "cf-inv-010-cf-j14-a-cf-j14-i-cf-j14-r-cf-j14-rc-cf-j14-s", "support.ts"],
  learningCompactionComments: ["tests", "hermetic", "cf-c-b32-cf-j12-cf-sm-learn", "cf-sm-learn-c.test.ts"],
  authoritySeedComments: ["tests", "hermetic", "cf-inv-001", "cf-inv-001-seeds.test.ts"],
  objectiveGrantTests: ["tests", "hermetic", "cf-inv-003-cf-split-destructive", "objective-grants.test.ts"],
  learningJourneyComments: ["tests", "hermetic", "cf-c-b32-cf-j12-cf-sm-learn", "cf-j12-s.test.ts"],
} as const;

export type ApprovalTtlTextSurface = keyof typeof APPROVAL_TTL_SURFACE_PATHS;

export interface ApprovalTtlTextPin {
  surface: ApprovalTtlTextSurface;
  kind: "grant" | "pending" | "objective" | "disposition";
  label: string;
  expected: string;
  drift: string;
}

export interface ApprovalTtlForbiddenText {
  surface: ApprovalTtlTextSurface;
  label: string;
  text: string;
}
