// Cormidia scope mapping onto the kernel's Scope / ScopePolicy (kernel contract
// §Scope; docs/learning-loop/learning-loop-spec.md §2; design §4.3).
//
// The V1 loop-scope grammar — `org | roles/<role> | apps/<app> |
// apps/<app>/roles/<role>` — becomes an ordered segment list rooted at the
// org: `[org]`, `[org, role]`, `[org, app]`, `[org, app, role]`. The org
// segment is the isolation segment: nothing ever inherits across orgs. The
// precedence order is the resolver's conflict rule (design §4.3, resolver
// gather order): narrower wins, app over role, id breaks ties.

import { sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { Scope, ScopePolicy, ScopeSegment } from "@cormidia/learning-loop";
import { isValidLoopScope } from "../memory.js";

export const CORMIDIA_SCOPE_POLICY_ID = "cormidia-loop-scope-v1";

/** Precedence rank per scope shape: higher wins a conflict (design §4.3). */
const PRECEDENCE = { org: 0, role: 1, app: 2, app_role: 3 } as const;
type ScopeShape = keyof typeof PRECEDENCE;

export interface CormidiaScopeParts {
  readonly org: string;
  readonly app?: string;
  readonly role?: string;
}

const MAX_SEGMENT_TEXT_LENGTH = 200;
const LOOP_SEGMENT_RE = /^(?!\.+$)[A-Za-z0-9._-]+$/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function segmentText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`learning-loop: scope ${label} must be a non-empty string`);
  if (value.length > MAX_SEGMENT_TEXT_LENGTH)
    throw new Error(`learning-loop: scope ${label} exceeds ${MAX_SEGMENT_TEXT_LENGTH} characters`);
  if (hasControlCharacter(value)) throw new Error(`learning-loop: scope ${label} contains a control character`);
  return value;
}

function parseSegments(input: unknown): ScopeSegment[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new Error("learning-loop: a scope is a non-empty segment array");
  return input.map((raw: unknown, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`learning-loop: scope segment ${index} must be a { type, id } object`);
    }
    const type = segmentText(Reflect.get(raw, "type"), `segment ${index} type`);
    const id = segmentText(Reflect.get(raw, "id"), `segment ${index} id`);
    return { type, id };
  });
}

/** The Cormidia-shaped parts of a kernel scope, or undefined when the scope
 *  is not in the V1 grammar (foreign hosts' scopes never map silently). */
export function scopeParts(scope: Scope): CormidiaScopeParts | undefined {
  const [first, ...rest] = scope;
  if (first === undefined || first.type !== "org") return undefined;
  let app: string | undefined;
  let role: string | undefined;
  for (const segment of rest) {
    if (segment.type === "app" && app === undefined && role === undefined) app = segment.id;
    else if (segment.type === "role" && role === undefined) role = segment.id;
    else return undefined;
    if (!LOOP_SEGMENT_RE.test(segment.id)) return undefined;
  }
  return { org: first.id, ...(app !== undefined ? { app } : {}), ...(role !== undefined ? { role } : {}) };
}

function shapeOf(parts: CormidiaScopeParts): ScopeShape {
  if (parts.app !== undefined) return parts.role !== undefined ? "app_role" : "app";
  return parts.role !== undefined ? "role" : "org";
}

/** `org` + a V1 loop scope string → kernel scope. Throws on an invalid scope. */
export function scopeFromLoopScope(org: string, loopScope: string): Scope {
  if (!isValidLoopScope(loopScope)) throw new Error(`learning-loop: "${loopScope}" is not a valid V1 scope (spec §2)`);
  const segments: ScopeSegment[] = [{ type: "org", id: segmentText(org, "org id") }];
  const parts = loopScope.split("/");
  if (parts[0] === "apps" && parts[1] !== undefined) segments.push({ type: "app", id: parts[1] });
  const roleIndex = parts.indexOf("roles");
  const role = roleIndex >= 0 ? parts[roleIndex + 1] : undefined;
  if (role !== undefined) segments.push({ type: "role", id: role });
  return segments;
}

/** Kernel scope → V1 loop scope string, or undefined for a non-Cormidia scope. */
export function loopScopeFromScope(scope: Scope): string | undefined {
  const parts = scopeParts(scope);
  if (parts === undefined) return undefined;
  switch (shapeOf(parts)) {
    case "org":
      return "org";
    case "role":
      return `roles/${parts.role ?? ""}`;
    case "app":
      return `apps/${parts.app ?? ""}`;
    case "app_role":
      return `apps/${parts.app ?? ""}/roles/${parts.role ?? ""}`;
  }
}

function canonicalText(scope: Scope): string {
  return JSON.stringify(scope.map((segment) => [segment.type, segment.id]));
}

/** The Cormidia scope policy: V1 grammar only, org-isolated, resolver precedence. */
export function cormidiaScopePolicy(): ScopePolicy {
  const isolationSegmentTypes = ["org"];
  const digest = sha256HexOfCanonicalJson({
    kind: "cormidia-loop-scope",
    id: CORMIDIA_SCOPE_POLICY_ID,
    version: 1,
    isolationSegmentTypes,
    precedence: ["org", "role", "app", "app_role"],
  });
  const validate = (input: unknown): Scope => {
    const segments = parseSegments(input);
    if (scopeParts(segments) === undefined) {
      throw new Error("learning-loop: scope must be [org], [org, role], [org, app], or [org, app, role]");
    }
    return segments;
  };
  return {
    id: CORMIDIA_SCOPE_POLICY_ID,
    digest,
    isolationSegmentTypes,
    validate,
    ancestors: (scope) => {
      const parts = scopeParts(scope);
      if (parts === undefined) return [];
      const org: ScopeSegment = { type: "org", id: parts.org };
      const out: Scope[] = [];
      if (parts.app !== undefined && parts.role !== undefined) {
        out.push([org, { type: "app", id: parts.app }], [org, { type: "role", id: parts.role }]);
      }
      if (parts.app !== undefined || parts.role !== undefined) out.push([org]);
      return out;
    },
    comparePrecedence: (left, right) => {
      const leftText = canonicalText(left);
      const rightText = canonicalText(right);
      if (leftText === rightText) return 0;
      const leftParts = scopeParts(left);
      const rightParts = scopeParts(right);
      const leftRank = leftParts === undefined ? -1 : PRECEDENCE[shapeOf(leftParts)];
      const rightRank = rightParts === undefined ? -1 : PRECEDENCE[shapeOf(rightParts)];
      if (leftRank !== rightRank) return leftRank > rightRank ? 1 : -1;
      return leftText > rightText ? 1 : -1;
    },
  };
}
