import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveApprovalPolicy } from "../../../src/org/approvals.js";
import { OBJECTIVE_GRANT_DEFAULT_TTL_MS } from "../../../src/org/objective-grants.js";
import { APPROVAL_TTL_ADJACENT_FORBIDDEN, APPROVAL_TTL_ADJACENT_PINS } from "./approval-ttl-adjacent-pins.js";
import { APPROVAL_TTL_POLICY_FORBIDDEN, APPROVAL_TTL_POLICY_PINS } from "./approval-ttl-policy-pins.js";
import {
  APPROVAL_TTL_SURFACE_PATHS,
  type ApprovalTtlForbiddenText,
  type ApprovalTtlTextPin,
  type ApprovalTtlTextSurface,
} from "./approval-ttl-surface-registry.js";

const HOUR_MS = 60 * 60 * 1000;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const APPROVAL_TTL_TEXT_PINS: readonly ApprovalTtlTextPin[] = [
  ...APPROVAL_TTL_POLICY_PINS,
  ...APPROVAL_TTL_ADJACENT_PINS,
];

export const APPROVAL_TTL_FORBIDDEN_TEXT: readonly ApprovalTtlForbiddenText[] = [
  ...APPROVAL_TTL_POLICY_FORBIDDEN,
  ...APPROVAL_TTL_ADJACENT_FORBIDDEN,
];

export interface ApprovalTtlSurfaces {
  text: Record<ApprovalTtlTextSurface, string>;
  grantTtlMs: number;
  pendingTtlMs: number;
  objectiveGrantTtlMs: number;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ");
}

export function readApprovalTtlSurfaces(): ApprovalTtlSurfaces {
  const approvalPolicy = resolveApprovalPolicy();
  const entries = Object.entries(APPROVAL_TTL_SURFACE_PATHS).map(([surface, path]) => [
    surface,
    readFileSync(join(repoRoot, ...path), "utf8"),
  ]);
  return {
    text: Object.fromEntries(entries),
    grantTtlMs: approvalPolicy.grantTtlMs,
    pendingTtlMs: approvalPolicy.pendingTtlMs,
    objectiveGrantTtlMs: OBJECTIVE_GRANT_DEFAULT_TTL_MS,
  };
}

export function auditApprovalTtlSurfaces(surfaces: ApprovalTtlSurfaces): string[] {
  const problems: string[] = [];
  for (const pin of APPROVAL_TTL_TEXT_PINS) {
    if (!normalized(surfaces.text[pin.surface]).includes(normalized(pin.expected))) {
      problems.push(`${pin.label} does not pin ${pin.expected}`);
    }
  }
  for (const forbidden of APPROVAL_TTL_FORBIDDEN_TEXT) {
    if (normalized(surfaces.text[forbidden.surface]).includes(normalized(forbidden.text))) {
      problems.push(`${forbidden.label} retains active stale wording`);
    }
  }
  if (surfaces.grantTtlMs !== 48 * HOUR_MS) problems.push("runtime approval grant TTL is not 48h");
  if (surfaces.pendingTtlMs !== 24 * HOUR_MS) problems.push("runtime pending-item TTL is not 24h");
  if (surfaces.objectiveGrantTtlMs !== 24 * HOUR_MS) problems.push("runtime objective-grant TTL is not 24h");
  return problems;
}

export function reconciledApprovalTtlFixture(): ApprovalTtlSurfaces {
  const emptyEntries = Object.keys(APPROVAL_TTL_SURFACE_PATHS).map((surface) => [surface, ""]);
  const text: Record<ApprovalTtlTextSurface, string> = Object.fromEntries(emptyEntries);
  for (const pin of APPROVAL_TTL_TEXT_PINS) text[pin.surface] += `${pin.expected}\n`;
  return { text, grantTtlMs: 48 * HOUR_MS, pendingTtlMs: 24 * HOUR_MS, objectiveGrantTtlMs: 24 * HOUR_MS };
}

export function replaceRequired(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`negative-control fixture is missing ${from}`);
  return source.replace(from, to);
}
