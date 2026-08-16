// campaign/acceptance/campaign-config.ts — the L-ACC authorization envelope
// (CORMIDIA-C-B27-001 §1).
//
// Structural validation only, and deliberately pure: every clause here is
// decidable without touching a repository or a provider, so it runs first and
// a config defect costs nothing. The clauses that need the world — commit pin,
// packaged-install proof, scenario repository binding — live in
// `campaign-preflight.ts` and run against this result.
//
// Fail closed: an unreadable, ambiguous, or partially written config is a
// refusal, never a default (B-27 §3). In particular §1.8 — a config with NO
// declared plan-gate policy refuses. Since F-PT-030 resolved (2026-08-07) an
// `auto-continue` policy is legal and lets an unattended campaign run end to
// end; what is never legal is silence, because silence is not consent.

import { configuredProviderFamily, validateTurnAssignment } from "../../../src/runtime/assignment.js";
import { QUALIFICATION_HOST_POLICY_PATH } from "../../../src/org/qualification-host-policy.js";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import { basename, isAbsolute, normalize, sep } from "node:path";

export type CampaignConfigCode =
  | "campaign-id-invalid"
  | "commit-invalid"
  | "policy-path-invalid"
  | "no-scenarios"
  | "campaign-org-undeclared"
  | "duplicate-scenario"
  | "matrix-incomplete"
  | "job-matrix-empty"
  | "matrix-single-family"
  | "illegal-effort"
  | "candidate-provenance"
  | "candidate-duplicate"
  | "candidate-family-mismatch"
  | "grader-candidate-missing"
  | "envelope-missing"
  | "plan-gate-undeclared"
  | "grader-plan-missing";

export class CampaignConfigError extends Error {
  constructor(
    readonly code: CampaignConfigCode,
    message: string,
  ) {
    super(`campaign refused at preflight (${code}): ${message}`);
    this.name = "CampaignConfigError";
  }
}

export interface ScenarioConfig {
  id: string;
  kind: "app" | "job";
  /** The disposable repository this scenario runs against. */
  appSlug: string;
  worktree: string;
  jobWorkdir?: string;
  /** How the disposable checkout is prepared before the bounded baseline. */
  setup?: "new-app" | "bootstrap" | "job";
  /** Local-only command handed to the human. Never a deployment command. */
  previewCommand?: string;
  /** Every role/step's exact assignment tuple. App scenarios use
   * planner/builder/reviewer; job scenarios use their provider step ids. */
  matrix: Record<string, TurnAssignment | undefined>;
}

export interface AssignmentCandidate {
  id: string;
  assignment: TurnAssignment;
  providerFamily: string;
  capabilityRef: string;
  conservativeEstimate: number;
  /** A human-ratified provenance string, validated as a TYPE, never
   *  dereferenced here (docs/org/apps.md). */
  qualificationRef?: string;
  /** Required when `qualificationRef` is absent: an explicit disclosure that
   *  this tuple is uncertified, and why. */
  uncertified?: string;
}

/** F-PT-030, resolved 2026-08-07. Declaration is the requirement. */
export type PlanGatePolicy =
  | { kind: "human" }
  | {
      kind: "auto-continue";
      /** Restated from the ratified rubric §6, never re-derived numerically. */
      criteria: "rubric-6-attempted-on-P-1-and-P-5";
    };

export interface GraderPlanEntry {
  axis: string;
  /** Which scenario kinds this row applies to. Omission means both. */
  scenarioKinds?: Array<"app" | "job">;
  /** Which exact scenarios this row applies to. Omission means every scenario
   *  of the selected kind. Mirror matrices need this because their legal
   *  grader families are intentionally opposite. */
  scenarioIds?: string[];
  /** Mechanical axes declare no grader and no read set. */
  mechanical?: boolean;
  grader?: TurnAssignment;
  /** Turn ids this axis reads; the set disjointness is computed against. */
  readTurnIds?: string[];
}

export interface CampaignEnvelope {
  maxOutputTokens: number;
  maxEquivUsd: number;
  /** The exact human authorization these ceilings came from. There is no
   *  global L-ACC ceiling and none is invented (risk-allocation §5a). */
  authorization: string;
}

export interface AcceptanceCampaignConfig {
  campaignId: string;
  commit: string;
  policyPath: string;
  /** The org whose disposable repositories every scenario must belong to
   *  (B-27 §1.3). Declared once for the campaign, never per scenario, so a
   *  single scenario cannot quietly widen the authorized namespace. */
  campaignOrg: string;
  scenarios: ScenarioConfig[];
  adaptiveAssignments: AssignmentCandidate[];
  envelope?: CampaignEnvelope;
  planGate?: PlanGatePolicy;
  graderPlan: GraderPlanEntry[];
}

export interface ValidatedCampaignConfig {
  campaignId: string;
  campaignOrg: string;
  scenarioIds: string[];
  /** Per scenario, the exact matrix, ready to be recorded in the report. */
  matrices: Record<string, Record<string, TurnAssignment>>;
  planGate: PlanGatePolicy;
  envelope: CampaignEnvelope;
  uncertifiedCandidateIds: string[];
}

const APP_ROLES = ["planner", "builder", "reviewer"] as const;
const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_POLICY_SUFFIX = `${sep}${QUALIFICATION_HOST_POLICY_PATH.split("/").join(sep)}`;

/** Match the packaged lifecycle command that creates the app identity. New-app
 * receives an explicit name; bootstrap derives it from the checkout basename. */
export function scenarioAppName(scenario: ScenarioConfig): string {
  if (scenario.setup === "bootstrap") return basename(scenario.worktree);
  return scenario.appSlug.split("/").at(-1) ?? scenario.id;
}

/** Every §1 clause that is decidable without touching the world. */
export function validateCampaignConfig(config: AcceptanceCampaignConfig): ValidatedCampaignConfig {
  if (!CAMPAIGN_ID.test(config.campaignId)) {
    throw new CampaignConfigError("campaign-id-invalid", `invalid campaign id ${JSON.stringify(config.campaignId)}`);
  }
  if (!/^[a-f0-9]{40}$/.test(config.commit)) {
    throw new CampaignConfigError("commit-invalid", "commit must be an exact lowercase 40-hex git oid");
  }
  if (
    !isAbsolute(config.policyPath) ||
    normalize(config.policyPath) !== config.policyPath ||
    !config.policyPath.endsWith(HOST_POLICY_SUFFIX)
  ) {
    throw new CampaignConfigError(
      "policy-path-invalid",
      `policyPath must be a canonical absolute path ending in ${QUALIFICATION_HOST_POLICY_PATH}`,
    );
  }
  if (config.campaignOrg.trim().length === 0) {
    throw new CampaignConfigError(
      "campaign-org-undeclared",
      `${config.campaignId} declares no campaign org; without one, "not this repository" is the only binding ` +
        `check and a scenario could name any third party's real repository`,
    );
  }
  if (config.scenarios.length === 0) {
    throw new CampaignConfigError("no-scenarios", `${config.campaignId} declares no scenario`);
  }
  const ids = config.scenarios.map((scenario) => scenario.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    throw new CampaignConfigError("duplicate-scenario", `scenario ${duplicate} is declared twice`);
  }

  const matrices: Record<string, Record<string, TurnAssignment>> = {};
  for (const scenario of config.scenarios) {
    const matrix: Record<string, TurnAssignment> = {};
    for (const [role, assignment] of Object.entries(scenario.matrix)) {
      if (assignment === undefined) continue;
      try {
        matrix[role] = validateTurnAssignment(assignment, `${scenario.id}.${role}`);
      } catch (error) {
        // `effort: max` off claude/opencode lands here (§1.5,
        // src/runtime/assignment.ts) — refused at preflight, not at the first turn.
        throw new CampaignConfigError("illegal-effort", (error as Error).message);
      }
    }
    if (scenario.kind === "app") {
      const missing = APP_ROLES.filter((role) => matrix[role] === undefined);
      if (missing.length > 0) {
        throw new CampaignConfigError(
          "matrix-incomplete",
          `app scenario ${scenario.id} is missing an assignment for ${missing.join(", ")}`,
        );
      }
      const familySet = new Set(APP_ROLES.map((role) => configuredProviderFamily(matrix[role] as TurnAssignment)));
      if (familySet.size === 1) {
        throw new CampaignConfigError(
          "matrix-single-family",
          `app scenario ${scenario.id} runs planner, builder and reviewer on one provider family ` +
            `(${[...familySet][0] ?? "unknown"}); that collapses the builder != reviewer cross-provider pairing`,
        );
      }
    } else if (Object.keys(matrix).length === 0) {
      throw new CampaignConfigError(
        "job-matrix-empty",
        `job scenario ${scenario.id} records no provider-step assignments; the report could not answer which models ran`,
      );
    }
    matrices[scenario.id] = matrix;
  }

  const uncertifiedCandidateIds: string[] = [];
  const candidateIds = new Set<string>();
  for (const candidate of config.adaptiveAssignments) {
    if (candidateIds.has(candidate.id)) {
      throw new CampaignConfigError("candidate-duplicate", `candidate id ${candidate.id} is declared twice`);
    }
    candidateIds.add(candidate.id);
    const assignment = validateTurnAssignment(candidate.assignment, `adaptiveAssignments.${candidate.id}`);
    const actualFamily = configuredProviderFamily(assignment);
    if (candidate.providerFamily !== actualFamily) {
      throw new CampaignConfigError(
        "candidate-family-mismatch",
        `candidate ${candidate.id} declares ${candidate.providerFamily} but ${assignment.harness}/${assignment.model} resolves to ${actualFamily}`,
      );
    }
    const hasRef = typeof candidate.qualificationRef === "string" && candidate.qualificationRef.trim().length > 0;
    const hasDisclosure = typeof candidate.uncertified === "string" && candidate.uncertified.trim().length > 0;
    if (!hasRef && !hasDisclosure) {
      throw new CampaignConfigError(
        "candidate-provenance",
        `candidate ${candidate.id} carries neither a qualification_ref nor an explicit uncertified disclosure; ` +
          `a plausible-looking reference must never be invented for it`,
      );
    }
    if (!hasRef) uncertifiedCandidateIds.push(candidate.id);
  }

  const envelope = config.envelope;
  if (
    envelope === undefined ||
    !Number.isFinite(envelope.maxOutputTokens) ||
    envelope.maxOutputTokens <= 0 ||
    !Number.isFinite(envelope.maxEquivUsd) ||
    envelope.maxEquivUsd <= 0 ||
    envelope.authorization.trim().length === 0
  ) {
    throw new CampaignConfigError(
      "envelope-missing",
      `${config.campaignId} must carry an output-token ceiling and an equivalent-USD ceiling from an exact human ` +
        `authorization; there is no global L-ACC ceiling and none may be invented`,
    );
  }

  if (config.planGate === undefined) {
    throw new CampaignConfigError(
      "plan-gate-undeclared",
      `${config.campaignId} declares no plan_gate policy. An auto-continue policy is legal (F-PT-030, 2026-08-07); ` +
        `silence is not consent`,
    );
  }

  for (const entry of config.graderPlan) {
    const unknownScenario = entry.scenarioIds?.find((id) => !ids.includes(id));
    if (unknownScenario !== undefined) {
      throw new CampaignConfigError(
        "grader-plan-missing",
        `axis ${entry.axis} names unknown scenario ${unknownScenario}`,
      );
    }
    if (entry.mechanical === true) continue;
    if (entry.grader === undefined || entry.readTurnIds === undefined) {
      throw new CampaignConfigError(
        "grader-plan-missing",
        `model-graded axis ${entry.axis} must declare its grader tuple and the read set it is disjoint from`,
      );
    }
    validateTurnAssignment(entry.grader, `graderPlan.${entry.axis}.grader`);
    if (
      !config.adaptiveAssignments.some(
        (candidate) => JSON.stringify(candidate.assignment) === JSON.stringify(entry.grader),
      )
    ) {
      throw new CampaignConfigError(
        "grader-candidate-missing",
        `model-graded axis ${entry.axis} names a grader tuple outside adaptiveAssignments`,
      );
    }
  }

  return {
    campaignId: config.campaignId,
    campaignOrg: config.campaignOrg.trim().toLowerCase(),
    scenarioIds: ids,
    matrices,
    planGate: config.planGate,
    envelope,
    uncertifiedCandidateIds,
  };
}
