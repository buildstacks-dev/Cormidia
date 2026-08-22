// Learning policy (docs/learning-loop/learning-loop-spec.md §13) — the
// subset the resolver, publisher, rejection ledger, review SLA, canary
// lifecycle, experiment runner, and learning budget overlay read.
//
// `learning/policy.yaml` in the committed org home is optional: absent, the
// spec §13 defaults apply verbatim. Present, its known keys deep-merge over
// the defaults — a policy file that only raises `rejections.suppress_days`
// does not have to restate the context-budget shares. The file is
// gate-protected (`learning-surface-tamper`): only humans edit it.
//
// M5 parses the tier table (canary fraction/window, experiment requirement,
// promote rules) and `learning_budget`. M6 additionally parses the distiller,
// reviewer-volume, and report-only compaction controls. A T3 live canary is structurally
// unrepresentable: the loader REJECTS any policy that grants T3 a canary
// block or sets its `live_canary` to anything but `forbidden` — the refusal
// lives in the type system and the parse, not in call-site convention
// (milestones M5 done-means #3).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LoopTier } from "../../memory.js";
import { parseSchedule } from "../../schedule.js";

export type ScopeShareKey = "org" | "role" | "app" | "app_role";

export interface TierCanaryPolicy {
  /** The episode is the only V1 assignment unit (design §8.4). */
  unit: "episode";
  /** Fraction of new episodes assigned to the canary lineage, (0, 1]. */
  fraction: number;
  /** New episodes assign stable once the window elapses (bounded exposure);
   *  already-assigned episodes stay sticky until stop/promote. */
  window_hours: number;
  /** T2: a decided `improved` replay EvalResult must exist before start. */
  requires_replay_pass: boolean;
}

export interface TierPromoteRule {
  min_canary_episodes: number;
  max_regression_pct: number;
  eval_gate: boolean;
  /** Insufficient volume resolves to `inconclusive` + human judgment,
   *  never permanent limbo (design §10). */
  on_insufficient: "human_judgment";
}

interface TierPolicy {
  /** Design §9.1: an ExperimentRecord is required before activation. */
  experiment_required: boolean;
  /** Null = this tier cannot start a live canary (fail closed: a tier
   *  without an explicit canary policy has no canary path). */
  canary: TierCanaryPolicy | null;
  /** `forbidden` is load-bearing for T3 only; the loader rejects any
   *  policy that relaxes it. */
  live_canary: "allowed" | "forbidden";
  allowed_trials: string[];
  promote_rule: TierPromoteRule | null;
}

interface LearningBudgetPolicy {
  /** Monthly cap on all learning-attributed provider spend (USD). */
  monthly_usd: number;
  /** Cap on replay spend attributed to one candidate (USD). */
  per_candidate_replay_usd: number;
  max_repetitions_per_experiment: number;
  max_experiments_per_month: number;
  /** Parsed with the block; the consumer is the M6 distiller. */
  max_distillations_per_week: number;
  require_benefit_justification: boolean;
}

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
  tiers: Record<LoopTier, TierPolicy>;
  learning_budget: LearningBudgetPolicy;
  distiller: {
    schedule: string;
    precheck: "deterministic";
    evidence_window_days: number;
    min_cluster_events: number;
    max_candidates_per_run: number;
    max_candidates_per_week: number;
  };
  reviewer: {
    schedule: string;
    max_candidates_per_run: number;
  };
  compaction: {
    schedule: string;
    report_only_v1: true;
    deprecate_if: {
      loads_zero_days: number;
      past_ttl: boolean;
      superseded: boolean;
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
    tiers: {
      T0: {
        experiment_required: false,
        canary: null,
        live_canary: "allowed",
        allowed_trials: [],
        promote_rule: null,
      },
      T1: {
        experiment_required: false,
        canary: { unit: "episode", fraction: 0.1, window_hours: 48, requires_replay_pass: false },
        live_canary: "allowed",
        allowed_trials: ["replay", "canary"],
        promote_rule: {
          min_canary_episodes: 15,
          max_regression_pct: 10,
          eval_gate: true,
          on_insufficient: "human_judgment",
        },
      },
      T2: {
        experiment_required: true,
        canary: { unit: "episode", fraction: 0.1, window_hours: 72, requires_replay_pass: true },
        live_canary: "allowed",
        allowed_trials: ["replay", "canary"],
        promote_rule: {
          min_canary_episodes: 25,
          max_regression_pct: 5,
          eval_gate: true,
          on_insufficient: "human_judgment",
        },
      },
      T3: {
        experiment_required: true,
        canary: null,
        live_canary: "forbidden",
        allowed_trials: ["sandbox", "replay", "shadow", "bounded_manual"],
        promote_rule: null,
      },
    },
    learning_budget: {
      monthly_usd: 200,
      per_candidate_replay_usd: 75,
      max_repetitions_per_experiment: 5,
      max_experiments_per_month: 4,
      max_distillations_per_week: 7,
      require_benefit_justification: true,
    },
    distiller: {
      schedule: "daily 06:00",
      precheck: "deterministic",
      evidence_window_days: 7,
      min_cluster_events: 2,
      max_candidates_per_run: 5,
      max_candidates_per_week: 20,
    },
    reviewer: {
      schedule: "weekly mon 07:00",
      max_candidates_per_run: 20,
    },
    compaction: {
      schedule: "weekly mon 07:00",
      report_only_v1: true,
      deprecate_if: {
        loads_zero_days: 45,
        past_ttl: true,
        superseded: true,
      },
    },
  };
}

function learningPolicyPath(orgHome: string): string {
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
    mergeNumber(rejections, "override_if_evidence_x", path, (v) => (policy.rejections.override_if_evidence_x = v));
  }

  if (spec["reviewer_sla_hours"] !== undefined) {
    policy.reviewer_sla_hours = requirePositiveNumber(spec["reviewer_sla_hours"], `${path}: reviewer_sla_hours`);
  }

  const budget = section(spec, "context_budget");
  if (budget !== undefined) {
    mergeNumber(budget, "default_bytes", path, (v) => (policy.context_budget.default_bytes = v));
    const roles = section(budget, "roles");
    if (roles !== undefined) {
      for (const [role, bytes] of Object.entries(roles)) {
        policy.context_budget.roles[role] = requirePositiveNumber(bytes, `${path}: context_budget.roles.${role}`);
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
        if (!Array.isArray(tiers) || tiers.some((tier) => !["T0", "T1", "T2", "T3"].includes(tier as string))) {
          throw new Error(`learning: ${path}: context_budget.eviction.protected_tiers must list tiers T0-T3`);
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

  const tiers = section(spec, "tiers");
  if (tiers !== undefined) {
    for (const tier of ["T0", "T1", "T2", "T3"] as const) {
      const entry = section(tiers, tier);
      if (entry !== undefined) mergeTier(policy.tiers[tier], entry, `${path}: tiers.${tier}`);
    }
  }
  // Structural T3 rule (design §6, milestones M5 done-means #3): a T3 live
  // canary must be unrepresentable, not merely unadvised. A policy file that
  // grants T3 a canary block or relaxes live_canary does not load.
  if (policy.tiers.T3.canary !== null || policy.tiers.T3.live_canary !== "forbidden") {
    throw new Error(
      `learning: ${path}: tiers.T3 cannot carry a canary policy and live_canary must stay ` +
        `"forbidden" — T3 changes (tools, permissions, config, deployment) never get live ` +
        `canary exposure (design §6); allowed T3 trials are sandbox/replay/shadow/bounded_manual`,
    );
  }
  for (const tier of ["T0", "T1", "T2", "T3"] as const) {
    const entry = policy.tiers[tier];
    if (entry.live_canary === "forbidden" && entry.canary !== null) {
      throw new Error(
        `learning: ${path}: tiers.${tier} declares a canary policy while live_canary is ` +
          `"forbidden" — the two cannot both hold`,
      );
    }
  }

  const learningBudget = section(spec, "learning_budget");
  if (learningBudget !== undefined) {
    const lb = policy.learning_budget;
    mergeNumber(learningBudget, "monthly_usd", path, (v) => (lb.monthly_usd = v));
    mergeNumber(learningBudget, "per_candidate_replay_usd", path, (v) => (lb.per_candidate_replay_usd = v));
    mergePositiveInt(
      learningBudget,
      "max_repetitions_per_experiment",
      path,
      (v) => (lb.max_repetitions_per_experiment = v),
    );
    mergePositiveInt(learningBudget, "max_experiments_per_month", path, (v) => (lb.max_experiments_per_month = v));
    mergePositiveInt(learningBudget, "max_distillations_per_week", path, (v) => (lb.max_distillations_per_week = v));
    mergeBoolean(learningBudget, "require_benefit_justification", path, (v) => (lb.require_benefit_justification = v));
  }

  const distiller = section(spec, "distiller");
  if (distiller !== undefined) {
    mergeSchedule(distiller, "schedule", path, (v) => (policy.distiller.schedule = v));
    if (distiller["precheck"] !== undefined && distiller["precheck"] !== "deterministic") {
      throw new Error(`learning: ${path}: distiller.precheck must be "deterministic"`);
    }
    mergePositiveInt(distiller, "evidence_window_days", path, (v) => (policy.distiller.evidence_window_days = v));
    mergePositiveInt(distiller, "min_cluster_events", path, (v) => (policy.distiller.min_cluster_events = v));
    mergePositiveInt(distiller, "max_candidates_per_run", path, (v) => (policy.distiller.max_candidates_per_run = v));
    mergePositiveInt(distiller, "max_candidates_per_week", path, (v) => (policy.distiller.max_candidates_per_week = v));
  }

  const reviewer = section(spec, "reviewer");
  if (reviewer !== undefined) {
    mergeSchedule(reviewer, "schedule", path, (v) => (policy.reviewer.schedule = v));
    mergePositiveInt(reviewer, "max_candidates_per_run", path, (v) => (policy.reviewer.max_candidates_per_run = v));
  }

  const compaction = section(spec, "compaction");
  if (compaction !== undefined) {
    mergeSchedule(compaction, "schedule", path, (v) => (policy.compaction.schedule = v));
    if (compaction["report_only_v1"] !== undefined && compaction["report_only_v1"] !== true) {
      throw new Error(
        `learning: ${path}: compaction.report_only_v1 must stay true — M6 may recommend but never mutate`,
      );
    }
    const deprecate = section(compaction, "deprecate_if");
    if (deprecate !== undefined) {
      mergePositiveInt(deprecate, "loads_zero_days", path, (v) => (policy.compaction.deprecate_if.loads_zero_days = v));
      mergeBoolean(deprecate, "past_ttl", path, (v) => (policy.compaction.deprecate_if.past_ttl = v));
      mergeBoolean(deprecate, "superseded", path, (v) => (policy.compaction.deprecate_if.superseded = v));
    }
  }

  return policy;
}

function mergeTier(tier: TierPolicy, spec: Record<string, unknown>, source: string): void {
  mergeBoolean(spec, "experiment_required", source, (v) => (tier.experiment_required = v));

  if (spec["live_canary"] !== undefined) {
    const value = spec["live_canary"];
    if (value !== "allowed" && value !== "forbidden") {
      throw new Error(`learning: ${source}.live_canary must be "allowed" or "forbidden"`);
    }
    tier.live_canary = value;
  }

  if (spec["canary"] !== undefined) {
    if (spec["canary"] === null) {
      tier.canary = null;
    } else {
      const canary = section(spec, "canary")!;
      const unit = canary["unit"] ?? "episode";
      if (unit !== "episode") {
        throw new Error(
          `learning: ${source}.canary.unit must be "episode" — the episode is the only V1 ` +
            `assignment unit (design §8.4)`,
        );
      }
      const fraction = requirePositiveNumber(canary["fraction"], `${source}.canary.fraction`);
      if (fraction > 1) {
        throw new Error(`learning: ${source}.canary.fraction must be in (0, 1]`);
      }
      const next: TierCanaryPolicy = {
        unit: "episode",
        fraction,
        window_hours: requirePositiveNumber(canary["window_hours"], `${source}.canary.window_hours`),
        requires_replay_pass: false,
      };
      if (canary["requires_replay_pass"] !== undefined) {
        if (typeof canary["requires_replay_pass"] !== "boolean") {
          throw new Error(`learning: ${source}.canary.requires_replay_pass must be a boolean`);
        }
        next.requires_replay_pass = canary["requires_replay_pass"];
      }
      tier.canary = next;
    }
  }

  if (spec["allowed_trials"] !== undefined) {
    const trials = spec["allowed_trials"];
    if (!Array.isArray(trials) || trials.some((entry) => typeof entry !== "string")) {
      throw new Error(`learning: ${source}.allowed_trials must be a string list`);
    }
    tier.allowed_trials = [...trials] as string[];
  }

  if (spec["promote_rule"] !== undefined) {
    if (spec["promote_rule"] === null) {
      tier.promote_rule = null;
    } else {
      const rule = section(spec, "promote_rule")!;
      const onInsufficient = rule["on_insufficient"] ?? "human_judgment";
      if (onInsufficient !== "human_judgment") {
        throw new Error(
          `learning: ${source}.promote_rule.on_insufficient must be "human_judgment" — ` +
            `insufficient volume resolves to inconclusive plus human judgment (design §10)`,
        );
      }
      const evalGate = rule["eval_gate"] ?? true;
      if (typeof evalGate !== "boolean") {
        throw new Error(`learning: ${source}.promote_rule.eval_gate must be a boolean`);
      }
      tier.promote_rule = {
        min_canary_episodes: requirePositiveNumber(
          rule["min_canary_episodes"],
          `${source}.promote_rule.min_canary_episodes`,
        ),
        max_regression_pct: requirePositiveNumber(
          rule["max_regression_pct"],
          `${source}.promote_rule.max_regression_pct`,
        ),
        eval_gate: evalGate,
        on_insufficient: "human_judgment",
      };
    }
  }
}

function section(spec: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = spec[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`learning: policy.yaml ${key} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function mergeNumber(spec: Record<string, unknown>, key: string, path: string, apply: (value: number) => void): void {
  if (spec[key] === undefined) return;
  apply(requirePositiveNumber(spec[key], `${path}: ${key}`));
}

function mergePositiveInt(
  spec: Record<string, unknown>,
  key: string,
  path: string,
  apply: (value: number) => void,
): void {
  if (spec[key] === undefined) return;
  const value = requirePositiveNumber(spec[key], `${path}: ${key}`);
  if (!Number.isInteger(value)) {
    throw new Error(`learning: ${path}: ${key} must be a positive integer`);
  }
  apply(value);
}

function mergeBoolean(spec: Record<string, unknown>, key: string, path: string, apply: (value: boolean) => void): void {
  if (spec[key] === undefined) return;
  if (typeof spec[key] !== "boolean") {
    throw new Error(`learning: ${path}: ${key} must be a boolean`);
  }
  apply(spec[key]);
}

function mergeString(spec: Record<string, unknown>, key: string, path: string, apply: (value: string) => void): void {
  if (spec[key] === undefined) return;
  const value = spec[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`learning: ${path}: ${key} must be a non-empty string`);
  }
  apply(value);
}

function mergeSchedule(spec: Record<string, unknown>, key: string, path: string, apply: (value: string) => void): void {
  if (spec[key] === undefined) return;
  const value = spec[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`learning: ${path}: ${key} must be a non-empty schedule string`);
  }
  try {
    parseSchedule(value);
  } catch (error) {
    throw new Error(`learning: ${path}: ${key}: ${(error as Error).message}`);
  }
  apply(value);
}

function requirePositiveNumber(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`learning: ${source} must be a positive number`);
  }
  return value;
}
