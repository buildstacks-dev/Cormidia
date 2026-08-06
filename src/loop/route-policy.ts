import type { RoleConfig } from "../runtime/types.js";
import type { AdmissionFactor, AuthorizedPass, EfficiencyRoute } from "./efficiency.js";
import type { PassConfig, PipelineConfig, TicketTier } from "./pipelines.js";

export const EXECUTION_ROUTE_POLICY_VERSION = "execution-route/v1";

export type RouteLevel = "low" | "medium" | "high";
export type RouteReversibility = "reversible" | "difficult" | "irreversible";
export type RouteReleaseConsequence = "none" | "internal" | "external" | "production" | "migration";
export type RouteNovelty = "familiar" | "new";
export type RouteEvidenceQuality = "high" | "partial" | "low";

export interface RouteRiskProfile {
  blastRadius: RouteLevel;
  reversibility: RouteReversibility;
  sensitiveDomains: string[];
  uncertainty: RouteLevel;
  componentCount: number;
  externalSystemCount: number;
  releaseConsequence: RouteReleaseConsequence;
  novelty: RouteNovelty;
  evidenceQuality: RouteEvidenceQuality;
}

export interface RouteDecision {
  policyVersion: typeof EXECUTION_ROUTE_POLICY_VERSION;
  route: TicketTier;
  profile: RouteRiskProfile;
  factors: AdmissionFactor[];
  decisionRules: string[];
}

export interface RouteExecutionBounds {
  environmentRetries: number;
  toolCalls: number;
  claimAttempts: number;
  repairAttempts: number;
  reviewCycles: number;
}

export const ROUTE_EXECUTION_BOUNDS: Readonly<Record<TicketTier, RouteExecutionBounds>> = {
  quick: { environmentRetries: 0, toolCalls: 40, claimAttempts: 2, repairAttempts: 1, reviewCycles: 1 },
  standard: { environmentRetries: 1, toolCalls: 100, claimAttempts: 3, repairAttempts: 2, reviewCycles: 2 },
  deep: { environmentRetries: 2, toolCalls: 200, claimAttempts: 3, repairAttempts: 3, reviewCycles: 3 },
};

export type MechanicalOnlyClass = "generated-ignore-normalization" | "formatter-only";

export interface MechanicalOnlyEvidence {
  caseClass: MechanicalOnlyClass;
  changedFiles: string[];
  generatedOrFormattingOnly: boolean;
  requiredGatesPassed: boolean;
  acceptanceCriteriaSatisfied: boolean;
}

export interface MechanicalOnlyDecision {
  allowed: boolean;
  policyVersion: "mechanical-only/v1";
  reason: string;
}

const ROUTE_RANK: Record<EfficiencyRoute, number> = {
  deterministic: -1,
  quick: 0,
  standard: 1,
  deep: 2,
};

export function decideExecutionRoute(input: RouteRiskProfile): RouteDecision {
  const profile = normalizeProfile(input);
  const decisionRules: string[] = [];

  const deep =
    profile.blastRadius === "high" ||
    profile.reversibility === "irreversible" ||
    profile.releaseConsequence === "production" ||
    profile.releaseConsequence === "migration" ||
    profile.externalSystemCount >= 3 ||
    profile.sensitiveDomains.length > 0;

  let route: TicketTier;
  if (deep) {
    route = "deep";
    if (profile.blastRadius === "high") decisionRules.push("high_blast_radius");
    if (profile.reversibility === "irreversible") decisionRules.push("irreversible_change");
    if (["production", "migration"].includes(profile.releaseConsequence)) decisionRules.push("release_consequence");
    if (profile.externalSystemCount >= 3) decisionRules.push("multiple_external_systems");
    if (profile.sensitiveDomains.length > 0) decisionRules.push("sensitive_domain");
  } else {
    const quick =
      profile.blastRadius === "low" &&
      profile.reversibility === "reversible" &&
      profile.sensitiveDomains.length === 0 &&
      profile.uncertainty === "low" &&
      profile.componentCount <= 1 &&
      profile.externalSystemCount === 0 &&
      profile.releaseConsequence === "none" &&
      profile.novelty === "familiar" &&
      profile.evidenceQuality === "high";
    route = quick ? "quick" : "standard";
    decisionRules.push(quick ? "bounded_reversible_single_component" : "moderate_risk_or_uncertainty");
  }

  return {
    policyVersion: EXECUTION_ROUTE_POLICY_VERSION,
    route,
    profile,
    factors: factorsFor(profile, route),
    decisionRules,
  };
}

export function assertMonotonicRoute(from: EfficiencyRoute, to: EfficiencyRoute): void {
  if (ROUTE_RANK[to] < ROUTE_RANK[from]) {
    throw new Error(`route reassessment cannot reduce depth (${from} -> ${to})`);
  }
}

export function nextRouteAfterUnexpectedFinding(route: TicketTier): TicketTier {
  return route === "quick" ? "standard" : "deep";
}

export function executionBoundsFor(route: TicketTier): RouteExecutionBounds {
  return ROUTE_EXECUTION_BOUNDS[route];
}

export function authorizeRoutePasses(input: {
  decision: RouteDecision;
  pipelines: readonly PipelineConfig[];
  roles: Record<string, RoleConfig>;
}): AuthorizedPass[] {
  const factorRules = new Set(input.decision.factors.map((factor) => factor.policy_rule));
  const authorized: AuthorizedPass[] = [];
  for (const pipeline of input.pipelines) {
    for (const pass of pipeline.passes) {
      const rule = passFactorRule(pipeline.name, pass, input.decision);
      if (rule === undefined) continue;
      if (!factorRules.has(rule)) {
        throw new Error(`route policy selected ${pipeline.name}/${pass.id} without recorded factor rule ${rule}`);
      }
      const role = input.roles[pass.role];
      if (role === undefined) throw new Error(`route policy: missing role ${pass.role}`);
      authorized.push({
        pipeline: pipeline.name,
        pass: pass.id,
        role: role.name,
        runtime: role.runtime,
        // Legacy route projection now preserves fixed assignment semantics:
        // workflow labels cannot downshift or partially override an atomic
        // harness/model/effort tuple. EpisodePlan is the only live adaptive
        // assignment authority.
        model: role.model,
        effort: role.effort,
        factor_rules: [rule],
      });
    }
  }
  return authorized.sort((a, b) => `${a.pipeline}/${a.pass}`.localeCompare(`${b.pipeline}/${b.pass}`));
}

export function decideMechanicalOnly(
  route: TicketTier,
  profile: RouteRiskProfile,
  evidence: MechanicalOnlyEvidence,
): MechanicalOnlyDecision {
  const base = { policyVersion: "mechanical-only/v1" as const };
  if (route !== "quick") return { ...base, allowed: false, reason: "mechanical-only is quick-route only" };
  if (profile.sensitiveDomains.length > 0 || profile.releaseConsequence !== "none") {
    return { ...base, allowed: false, reason: "sensitive or release-affecting work always requires model review" };
  }
  if (!evidence.generatedOrFormattingOnly || !evidence.requiredGatesPassed || !evidence.acceptanceCriteriaSatisfied) {
    return { ...base, allowed: false, reason: "mechanical evidence is incomplete" };
  }
  const allowedFiles = evidence.changedFiles.every((path) =>
    evidence.caseClass === "generated-ignore-normalization"
      ? /(?:^|\/)(?:\.gitignore|\.npmignore|\.prettierignore)$/.test(path)
      : /\.(?:md|json|ya?ml|ts|tsx|js|jsx|css)$/.test(path),
  );
  return allowedFiles
    ? { ...base, allowed: true, reason: `ratified ${evidence.caseClass} evidence is complete` }
    : { ...base, allowed: false, reason: "changed paths exceed the ratified mechanical-only class" };
}

function normalizeProfile(input: RouteRiskProfile): RouteRiskProfile {
  for (const [name, value] of [
    ["componentCount", input.componentCount],
    ["externalSystemCount", input.externalSystemCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  return {
    ...input,
    sensitiveDomains: [
      ...new Set(input.sensitiveDomains.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    ].sort(),
  };
}

function factorsFor(profile: RouteRiskProfile, route: TicketTier): AdmissionFactor[] {
  const factors: AdmissionFactor[] = [
    {
      kind: "evidence_quality",
      evidence: `acceptance and gate evidence quality is ${profile.evidenceQuality}`,
      policy_rule: "baseline_delivery_evidence",
    },
  ];
  if (route !== "quick" || profile.blastRadius !== "low")
    factors.push({
      kind: "blast_radius",
      evidence: `${profile.blastRadius} blast radius`,
      policy_rule: "blast_radius_depth",
    });
  if (profile.reversibility !== "reversible")
    factors.push({
      kind: "reversibility",
      evidence: `${profile.reversibility} change`,
      policy_rule: "reversibility_depth",
    });
  if (profile.sensitiveDomains.length > 0)
    factors.push({
      kind: "sensitive_domain",
      evidence: profile.sensitiveDomains.join(", "),
      policy_rule: "sensitive_review",
    });
  if (profile.uncertainty !== "low")
    factors.push({
      kind: "uncertainty",
      evidence: `${profile.uncertainty} uncertainty`,
      policy_rule: "uncertainty_depth",
    });
  if (profile.componentCount > 1)
    factors.push({
      kind: "component_count",
      evidence: `${profile.componentCount} components`,
      policy_rule: "component_depth",
    });
  if (profile.externalSystemCount > 0)
    factors.push({
      kind: "external_system_count",
      evidence: `${profile.externalSystemCount} external systems`,
      policy_rule: "external_system_depth",
    });
  if (profile.releaseConsequence !== "none")
    factors.push({ kind: "release_consequence", evidence: profile.releaseConsequence, policy_rule: "release_depth" });
  if (profile.novelty === "new")
    factors.push({ kind: "novelty", evidence: "new relative to validated evidence", policy_rule: "novelty_depth" });
  if (profile.evidenceQuality !== "high")
    factors.push({
      kind: "evidence_quality",
      evidence: `${profile.evidenceQuality} test evidence`,
      policy_rule: "weak_evidence_depth",
    });
  return factors.sort((a, b) =>
    `${a.kind}/${a.policy_rule}/${a.evidence}`.localeCompare(`${b.kind}/${b.policy_rule}/${b.evidence}`),
  );
}

function passFactorRule(pipeline: string, pass: PassConfig, decision: RouteDecision): string | undefined {
  if (["build", "fix"].includes(pipeline)) return "baseline_delivery_evidence";
  if (pipeline === "review" && pass.id === "verify") return "baseline_delivery_evidence";
  if (pipeline === "review" && pass.id === "security-deep") {
    return decision.profile.sensitiveDomains.length > 0
      ? "sensitive_review"
      : decision.route === "deep"
        ? "blast_radius_depth"
        : undefined;
  }
  if (pipeline === "review" && pass.id === "perf-scale") {
    if (decision.profile.externalSystemCount > 0) return "external_system_depth";
    if (decision.profile.componentCount > 1) return "component_depth";
    return undefined;
  }
  if (pipeline === "ship" && pass.id === "ship-check" && decision.route === "deep") {
    return decision.factors.find((factor) =>
      ["release_depth", "reversibility_depth", "blast_radius_depth"].includes(factor.policy_rule),
    )?.policy_rule;
  }
  return undefined;
}
