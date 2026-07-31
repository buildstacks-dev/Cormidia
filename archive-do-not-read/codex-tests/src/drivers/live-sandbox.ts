import { resolve } from "node:path";
import { ARTIFACT_ROOT, assertArtifactPath } from "../fixtures/controlled-world.js";

export interface LiveSandboxConfig {
  targetName: string;
  targetId: string;
  disposable: true;
  authorizationId: string;
  authorizedOperations: string[];
  maxSpendUsd: number;
  evidenceRoot: string;
  cleanupPolicy: "always" | "retain_on_failure";
}

export interface LiveSandboxPreflight {
  ok: true;
  normalized: LiveSandboxConfig & { evidenceRoot: string };
}

export function preflightLiveSandbox(value: unknown): LiveSandboxPreflight {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("live sandbox configuration must be a mapping");
  }
  const config = value as Partial<LiveSandboxConfig>;
  nonEmpty(config.targetName, "targetName");
  nonEmpty(config.targetId, "targetId");
  if (config.disposable !== true) throw new Error("live sandbox target must be explicitly disposable");
  nonEmpty(config.authorizationId, "authorizationId");
  if (
    !Array.isArray(config.authorizedOperations) ||
    config.authorizedOperations.length === 0 ||
    !config.authorizedOperations.every((operation) => typeof operation === "string" && operation.length > 0)
  ) {
    throw new Error("authorizedOperations must name at least one operation");
  }
  if (
    typeof config.maxSpendUsd !== "number" ||
    !Number.isFinite(config.maxSpendUsd) ||
    config.maxSpendUsd < 0
  ) {
    throw new Error("maxSpendUsd must be a finite non-negative number");
  }
  nonEmpty(config.evidenceRoot, "evidenceRoot");
  const evidenceRoot = assertArtifactPath(resolve(config.evidenceRoot));
  if (!["always", "retain_on_failure"].includes(config.cleanupPolicy ?? "")) {
    throw new Error("cleanupPolicy must be always or retain_on_failure");
  }
  return {
    ok: true,
    normalized: {
      targetName: config.targetName,
      targetId: config.targetId,
      disposable: true,
      authorizationId: config.authorizationId,
      authorizedOperations: [...config.authorizedOperations],
      maxSpendUsd: config.maxSpendUsd,
      evidenceRoot,
      cleanupPolicy: config.cleanupPolicy as LiveSandboxConfig["cleanupPolicy"],
    },
  };
}

export async function runLiveSandbox<T>(
  value: unknown,
  executor: (config: LiveSandboxConfig) => Promise<T>,
): Promise<T> {
  const preflight = preflightLiveSandbox(value);
  return executor(preflight.normalized);
}

export function unresolvedLiveSandboxTarget(name: string): Partial<LiveSandboxConfig> {
  return {
    targetName: name,
    evidenceRoot: resolve(ARTIFACT_ROOT, "live-sandbox", name),
  };
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be non-empty`);
  }
}
