import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonValue } from "../loop/episode-plan.js";
import type { ProjectStage } from "../loop/plan-tickets.js";
import { resolveAppWorkdir } from "./app-workdir.js";
import type { AppEntry } from "./apps.js";

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024;
const GREENFIELD_SEED_PATH = ".cormidia/planning/0001-greenfield-seed.md";

/**
 * These are deliberately conservative product-maturity signals, not lifecycle
 * states. A small, unreleased repository is safe to treat as bootstrap. The
 * broad middle is growth. Mature requires both substantial reachable history
 * and repeated reachable tags so one scaffold tag or a long unversioned import
 * cannot silently buy the largest planning envelope.
 */
const PLANNING_STAGE_THRESHOLDS = Object.freeze({
  bootstrapMaxReachableCommits: 5,
  matureMinReachableCommits: 50,
  matureMinReachableTags: 3,
  // One extra constant-size row distinguishes an exact threshold count from
  // a larger history without emitting an unbounded tag list.
  reachableTagProbeLimit: 4,
});

type PlanningStageResolutionSource = "explicit" | "repository_evidence" | "conservative_fallback" | "persisted_intent";

type PlanningStageResolutionReason =
  | "operator_supplied"
  | "greenfield_seed_low_history_no_releases"
  | "low_history_no_releases"
  | "substantial_versioned_history"
  | "intermediate_repository_history"
  | "repository_evidence_unavailable"
  | "legacy_intent_stage_preserved";

interface PlanningStageEvidence {
  inspection: "not_required" | "complete" | "unavailable";
  checkoutSource: "explicit" | "managed_clone" | "registered_local_checkout" | "unavailable" | "persisted_intent";
  greenfieldSeedPresent: boolean | null;
  reachableCommitCount: number | null;
  /** Exact below the probe limit; otherwise a lower bound. */
  reachableTagCount: number | null;
  reachableTagCountIsLowerBound: boolean;
}

export interface PlanningStageResolution {
  stage: ProjectStage;
  source: PlanningStageResolutionSource;
  reason: PlanningStageResolutionReason;
  evidence: PlanningStageEvidence;
}

interface PlanningStageCheckout {
  checkout: string;
  source: PlanningStageEvidence["checkoutSource"];
}

/**
 * Discover the same already-local evidence checkout for preview and live
 * planning. This never clones, fetches, or writes. When no checkout exists it
 * returns the intended managed-clone path so both callers make the same
 * explicit conservative fallback before live synchronization occurs.
 */
export function discoverPlanningStageCheckout(input: {
  app: AppEntry;
  orgHome: string;
  stateHome: string;
  explicitWorkdir?: string;
}): PlanningStageCheckout {
  if (input.explicitWorkdir !== undefined) {
    return { checkout: resolve(input.explicitWorkdir), source: "explicit" };
  }
  const managed = resolve(join(input.stateHome, "repos", input.app.name));
  try {
    const checkout = resolveAppWorkdir(input.app, {
      orgRoot: input.orgHome,
      runtimeHome: input.stateHome,
    });
    return {
      checkout,
      source: checkout === managed ? "managed_clone" : "registered_local_checkout",
    };
  } catch {
    return { checkout: managed, source: "unavailable" };
  }
}

/**
 * Resolve the product-planning stage from one exact checkout. This function is
 * the shared boundary for CLI previews and live planning; app lifecycle status
 * is intentionally absent from its inputs.
 */
export function resolvePlanningStage(input: {
  requestedStage?: ProjectStage;
  checkout: string;
  checkoutSource: PlanningStageEvidence["checkoutSource"];
}): PlanningStageResolution {
  if (input.requestedStage !== undefined) {
    return {
      stage: input.requestedStage,
      source: "explicit",
      reason: "operator_supplied",
      evidence: notRequiredEvidence(input.checkoutSource),
    };
  }

  let evidence: PlanningStageEvidence;
  try {
    evidence = inspectPlanningStageEvidence(input.checkout, input.checkoutSource);
  } catch {
    // Bootstrap is the fail-safe assumption: it asks the planner to establish
    // foundations and keeps the smallest ticket budget instead of inventing
    // users, releases, or architecture that could make a mature plan unsafe.
    return {
      stage: "bootstrap",
      source: "conservative_fallback",
      reason: "repository_evidence_unavailable",
      evidence: unavailableEvidence(input.checkoutSource),
    };
  }

  const commits = evidence.reachableCommitCount!;
  const tags = evidence.reachableTagCount!;
  if (tags === 0 && commits <= PLANNING_STAGE_THRESHOLDS.bootstrapMaxReachableCommits) {
    return {
      stage: "bootstrap",
      source: "repository_evidence",
      reason: evidence.greenfieldSeedPresent ? "greenfield_seed_low_history_no_releases" : "low_history_no_releases",
      evidence,
    };
  }

  if (
    commits >= PLANNING_STAGE_THRESHOLDS.matureMinReachableCommits &&
    tags >= PLANNING_STAGE_THRESHOLDS.matureMinReachableTags
  ) {
    return {
      stage: "mature",
      source: "repository_evidence",
      reason: "substantial_versioned_history",
      evidence,
    };
  }

  return {
    stage: "growth",
    source: "repository_evidence",
    reason: "intermediate_repository_history",
    evidence,
  };
}

/** Preserve immutable stage authority when resuming an older intent. */
export function persistedPlanningStageResolution(input: {
  stage: ProjectStage;
  stored: JsonValue | undefined;
}): PlanningStageResolution {
  const restored = parsePlanningStageResolution(input.stored);
  if (restored !== undefined && restored.stage === input.stage) return restored;
  return {
    stage: input.stage,
    source: "persisted_intent",
    reason: "legacy_intent_stage_preserved",
    evidence: notRequiredEvidence("persisted_intent"),
  };
}

export function formatPlanningStage(resolution: PlanningStageResolution): string {
  const provenance =
    resolution.source === "explicit" ? "explicit" : resolution.source === "persisted_intent" ? "persisted" : "inferred";
  return `${resolution.stage} (${provenance})`;
}

export function formatPlanningStageEvidence(resolution: PlanningStageResolution): string {
  const evidence = resolution.evidence;
  if (evidence.inspection === "not_required") return resolution.reason;
  if (evidence.inspection === "unavailable") {
    return `${resolution.reason}; safe bootstrap fallback`;
  }
  return (
    `${resolution.reason}; ${evidence.reachableCommitCount} reachable commit(s), ` +
    `${evidence.reachableTagCountIsLowerBound ? "at least " : ""}` +
    `${evidence.reachableTagCount} reachable tag(s), greenfield seed ` +
    `${evidence.greenfieldSeedPresent ? "present" : "absent"}`
  );
}

function inspectPlanningStageEvidence(
  checkout: string,
  checkoutSource: PlanningStageEvidence["checkoutSource"],
): PlanningStageEvidence {
  gitText(checkout, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const commitCount = parseCount(gitText(checkout, ["rev-list", "--count", "HEAD"]));
  const tagRows = splitLines(
    gitText(checkout, [
      "for-each-ref",
      "--merged=HEAD",
      `--count=${PLANNING_STAGE_THRESHOLDS.reachableTagProbeLimit}`,
      "--format=1",
      "refs/tags",
    ]),
  );
  return {
    inspection: "complete",
    checkoutSource,
    greenfieldSeedPresent: existsSync(join(checkout, GREENFIELD_SEED_PATH)),
    reachableCommitCount: commitCount,
    reachableTagCount: tagRows.length,
    reachableTagCountIsLowerBound: tagRows.length === PLANNING_STAGE_THRESHOLDS.reachableTagProbeLimit,
  };
}

function gitText(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

function parseCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("planning stage: git returned an invalid reachable commit count");
  }
  return parsed;
}

function splitLines(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}

function parsePlanningStageResolution(value: JsonValue | undefined): PlanningStageResolution | undefined {
  if (!isRecord(value) || !isProjectStage(value["stage"])) return undefined;
  if (!isResolutionSource(value["source"]) || !isResolutionReason(value["reason"])) return undefined;
  const evidence = value["evidence"];
  if (!isRecord(evidence)) return undefined;
  const inspection = evidence["inspection"];
  const checkoutSource = evidence["checkoutSource"];
  const seed = evidence["greenfieldSeedPresent"];
  const commits = evidence["reachableCommitCount"];
  const tags = evidence["reachableTagCount"];
  const lowerBound = evidence["reachableTagCountIsLowerBound"];
  if (inspection !== "not_required" && inspection !== "complete" && inspection !== "unavailable") {
    return undefined;
  }
  if (!isCheckoutSource(checkoutSource)) return undefined;
  if (seed !== null && typeof seed !== "boolean") return undefined;
  if (commits !== null && (typeof commits !== "number" || !Number.isSafeInteger(commits) || commits < 0))
    return undefined;
  if (tags !== null && (typeof tags !== "number" || !Number.isSafeInteger(tags) || tags < 0)) return undefined;
  if (typeof lowerBound !== "boolean") return undefined;
  return {
    stage: value["stage"],
    source: value["source"],
    reason: value["reason"],
    evidence: {
      inspection,
      checkoutSource,
      greenfieldSeedPresent: seed,
      reachableCommitCount: commits,
      reachableTagCount: tags,
      reachableTagCountIsLowerBound: lowerBound,
    },
  };
}

function notRequiredEvidence(checkoutSource: PlanningStageEvidence["checkoutSource"]): PlanningStageEvidence {
  return {
    inspection: "not_required",
    checkoutSource,
    greenfieldSeedPresent: null,
    reachableCommitCount: null,
    reachableTagCount: null,
    reachableTagCountIsLowerBound: false,
  };
}

function unavailableEvidence(checkoutSource: PlanningStageEvidence["checkoutSource"]): PlanningStageEvidence {
  return {
    inspection: "unavailable",
    checkoutSource,
    greenfieldSeedPresent: null,
    reachableCommitCount: null,
    reachableTagCount: null,
    reachableTagCountIsLowerBound: false,
  };
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectStage(value: unknown): value is ProjectStage {
  return value === "bootstrap" || value === "growth" || value === "mature";
}

function isResolutionSource(value: unknown): value is PlanningStageResolutionSource {
  return (
    value === "explicit" ||
    value === "repository_evidence" ||
    value === "conservative_fallback" ||
    value === "persisted_intent"
  );
}

function isResolutionReason(value: unknown): value is PlanningStageResolutionReason {
  return (
    value === "operator_supplied" ||
    value === "greenfield_seed_low_history_no_releases" ||
    value === "low_history_no_releases" ||
    value === "substantial_versioned_history" ||
    value === "intermediate_repository_history" ||
    value === "repository_evidence_unavailable" ||
    value === "legacy_intent_stage_preserved"
  );
}

function isCheckoutSource(value: unknown): value is PlanningStageEvidence["checkoutSource"] {
  return (
    value === "explicit" ||
    value === "managed_clone" ||
    value === "registered_local_checkout" ||
    value === "unavailable" ||
    value === "persisted_intent"
  );
}
