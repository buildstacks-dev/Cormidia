// Learning policy (docs/learning-loop/learning-loop-spec.md §13) — the M4
// subset the resolver, publisher, rejection ledger, and review SLA read.
//
// `learning/policy.yaml` in the committed org home is optional: absent, the
// spec §13 defaults apply verbatim. Present, its known keys deep-merge over
// the defaults — a policy file that only raises `rejections.suppress_days`
// does not have to restate the context-budget shares. The file is
// gate-protected (`learning-surface-tamper`): only humans edit it.
//
// Tier tables, canary fractions, and the learning budget overlay are M5/M6
// consumers and are deliberately not parsed yet — an unread policy knob would
// imply enforcement that does not exist.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LoopTier } from "../memory.js";

export type ScopeShareKey = "org" | "role" | "app" | "app_role";

export interface LearningPolicy {
  quarantine: {
    max_ttl_days: number;
    context_label: string;
  };
  rejections: {
    suppress_days: number;
    override_if_evidence_x: number;
  };
  reviewer_sla_hours: number;
  context_budget: {
    /** Bytes, matching the existing memory cap (spec §13). */
    default_bytes: number;
    roles: Record<string, number>;
    /** Per-scope budget shares (spec §8.1); unused share redistributes
     *  narrowest-first. */
    shares: Record<ScopeShareKey, number>;
    eviction: {
      order: string[];
      /** Tiers that fail loud rather than evict; validated at publish time. */
      protected_tiers: LoopTier[];
    };
  };
  destinations: {
    ticket: {
      max_open_per_app: number;
      max_new_per_week: number;
    };
  };
}

export function defaultLearningPolicy(): LearningPolicy {
  return {
    quarantine: {
      max_ttl_days: 14,
      context_label: "UNVERIFIED - provisional",
    },
    rejections: {
      suppress_days: 90,
      override_if_evidence_x: 2,
    },
    reviewer_sla_hours: 6,
    context_budget: {
      default_bytes: 16 * 1024,
      roles: {},
      shares: { org: 0.25, role: 0.25, app: 0.25, app_role: 0.25 },
      eviction: {
        order: ["provisional_first", "efficacy_asc", "oldest_first"],
        protected_tiers: ["T2", "T3"],
      },
    },
    destinations: {
      ticket: { max_open_per_app: 10, max_new_per_week: 5 },
    },
  };
}

export function learningPolicyPath(orgHome: string): string {
  return join(orgHome, "learning", "policy.yaml");
}

export async function loadLearningPolicy(orgHome: string): Promise<LearningPolicy> {
  const policy = defaultLearningPolicy();
  const path = learningPolicyPath(orgHome);
  if (!existsSync(path)) return policy;

  const raw = parseYaml(await readFile(path, "utf8")) as unknown;
  if (raw === null || raw === undefined) return policy;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`learning: ${path} must be a YAML mapping`);
  }
  const spec = raw as Record<string, unknown>;

  const quarantine = section(spec, "quarantine");
  if (quarantine !== undefined) {
    mergeNumber(quarantine, "max_ttl_days", path, (v) => (policy.quarantine.max_ttl_days = v));
    mergeString(quarantine, "context_label", path, (v) => (policy.quarantine.context_label = v));
  }

  const rejections = section(spec, "rejections");
  if (rejections !== undefined) {
    mergeNumber(rejections, "suppress_days", path, (v) => (policy.rejections.suppress_days = v));
    mergeNumber(
      rejections,
      "override_if_evidence_x",
      path,
      (v) => (policy.rejections.override_if_evidence_x = v),
    );
  }

  if (spec["reviewer_sla_hours"] !== undefined) {
    policy.reviewer_sla_hours = requirePositiveNumber(
      spec["reviewer_sla_hours"],
      `${path}: reviewer_sla_hours`,
    );
  }

  const budget = section(spec, "context_budget");
  if (budget !== undefined) {
    mergeNumber(budget, "default_bytes", path, (v) => (policy.context_budget.default_bytes = v));
    const roles = section(budget, "roles");
    if (roles !== undefined) {
      for (const [role, bytes] of Object.entries(roles)) {
        policy.context_budget.roles[role] = requirePositiveNumber(
          bytes,
          `${path}: context_budget.roles.${role}`,
        );
      }
    }
    const shares = section(budget, "shares");
    if (shares !== undefined) {
      for (const key of ["org", "role", "app", "app_role"] as const) {
        if (shares[key] !== undefined) {
          policy.context_budget.shares[key] = requirePositiveNumber(
            shares[key],
            `${path}: context_budget.shares.${key}`,
          );
        }
      }
      const total = Object.values(policy.context_budget.shares).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 1) > 0.001) {
        throw new Error(
          `learning: ${path}: context_budget.shares must sum to 1 (got ${total.toFixed(3)}) — ` +
            "a share that is silently renormalized would not be the policy the human ratified",
        );
      }
    }
    const eviction = section(budget, "eviction");
    if (eviction !== undefined) {
      const order = eviction["order"];
      if (order !== undefined) {
        if (!Array.isArray(order) || order.some((entry) => typeof entry !== "string")) {
          throw new Error(`learning: ${path}: context_budget.eviction.order must be a string list`);
        }
        policy.context_budget.eviction.order = [...order] as string[];
      }
      const tiers = eviction["protected_tiers"];
      if (tiers !== undefined) {
        if (
          !Array.isArray(tiers) ||
          tiers.some((tier) => !["T0", "T1", "T2", "T3"].includes(tier as string))
        ) {
          throw new Error(
            `learning: ${path}: context_budget.eviction.protected_tiers must list tiers T0-T3`,
          );
        }
        policy.context_budget.eviction.protected_tiers = [...tiers] as LoopTier[];
      }
    }
  }

  const destinations = section(spec, "destinations");
  const ticket = destinations !== undefined ? section(destinations, "ticket") : undefined;
  if (ticket !== undefined) {
    mergeNumber(ticket, "max_open_per_app", path, (v) => (policy.destinations.ticket.max_open_per_app = v));
    mergeNumber(ticket, "max_new_per_week", path, (v) => (policy.destinations.ticket.max_new_per_week = v));
  }

  return policy;
}

function section(
  spec: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = spec[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`learning: policy.yaml ${key} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function mergeNumber(
  spec: Record<string, unknown>,
  key: string,
  path: string,
  apply: (value: number) => void,
): void {
  if (spec[key] === undefined) return;
  apply(requirePositiveNumber(spec[key], `${path}: ${key}`));
}

function mergeString(
  spec: Record<string, unknown>,
  key: string,
  path: string,
  apply: (value: string) => void,
): void {
  if (spec[key] === undefined) return;
  const value = spec[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`learning: ${path}: ${key} must be a non-empty string`);
  }
  apply(value);
}

function requirePositiveNumber(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`learning: ${source} must be a positive number`);
  }
  return value;
}
