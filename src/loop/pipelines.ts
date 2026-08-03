// pipelines.yaml schema, types, loader (build plan M2.1; docs/loop/design.md §4, §10).
//
// Pipelines are typed, validated config — not YAML hope. The loader
// validates structure, role references, and template existence at load
// time; the real root pipelines.yaml is a human-ratified surface that
// lands via proposal PR in M2.2 (this module is proven against fixtures).
//
// Deliberate scope cuts:
// - A per-pass `model` override must stay within the role's provider
//   (docs/loop/design.md §4) — but this loader receives role NAMES only, so that
//   check belongs to the executor (M2.8), which resolves RoleConfig and
//   knows the runtime. Validating it here would force a loop→org import.
// - `only_on.risk` values are plain strings: risk tiers are defined by the
//   app's `.cormidia/policy.yaml` (M4.2, parallel track) — the loader must
//   not hardcode that vocabulary.
//
// Parsing mirrors src/org/roles.ts: yaml.parse + explicit field checks,
// descriptive errors carrying path + pipeline + pass id.

import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { Effort } from "../runtime/types.js";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** Historical ticket-tier vocabulary. It remains readable for legacy routes
 * and may parameterize an explicitly governed workflow template, but it never
 * selects live EpisodePlan steps or creates a planner-turn bypass. */
export type TicketTier = "quick" | "standard" | "deep";
export const TICKET_TIERS: TicketTier[] = ["quick", "standard", "deep"];

/** Conditional-pass trigger (docs/loop/design.md §4 "Review dimensions"). A pass
 *  with `onlyOn` runs when ANY listed condition matches (OR semantics —
 *  §4: security-deep fires on security globs OR high risk tier). */
export interface OnlyOn {
  /** Risk tiers that trigger the pass (vocabulary owned by policy.yaml). */
  risk?: string[];
  /** Compatibility condition for a governed template or historical route.
   * Accepted EpisodePlan DAG execution selects exact operations directly. */
  tier?: TicketTier[];
  /** Ticket labels that trigger the pass (e.g. `op:perf-sensitive`). */
  labels?: string[];
  /** `dimension_globs` key(s) from policy.yaml that trigger the pass when
   *  the diff matches them (e.g. `security`, `perf`). */
  dimensionGlobs?: string[];
}

export interface PassConfig {
  id: string;
  /** Role name — resolved against roles.yaml at load time by name only. */
  role: string;
  /** Template path relative to the prompts dir; must exist at load time. */
  template: string;
  /** Per-pass effort override (else the role's own effort). */
  effort?: Effort;
  /** Per-pass model override — must stay within the role's provider;
   *  enforced by the executor (see header note). */
  model?: string;
  /** Consecutive passes sharing a group run concurrently (docs/loop/design.md §4
   *  plan sketch: competing PMs). Grouping is adjacency-based. */
  parallelGroup?: string;
  /** Ticket tiers on which this pass is skipped. */
  skipOnTier?: TicketTier[];
  /** When present, the pass runs only if selection matches (see OnlyOn). */
  onlyOn?: OnlyOn;
  /** Optional wall-clock cap in minutes; dispatcher recovery enforces it. */
  wallClockMinutes?: number;
  /** Optional provider turn cap for this pass. */
  maxTurns?: number;
}

export interface PipelineConfig {
  name: string;
  /** §5: mechanical pipelines have no agent passes at standard tiers. */
  mechanical: boolean;
  passes: PassConfig[];
}

export interface PipelinesFile {
  pipelines: PipelineConfig[];
}

export interface LoadPipelinesOpts {
  /** Valid role names (from roles.yaml) — every pass.role must be one. */
  roleNames: string[];
  /** Directory pass templates live under; every pass.template must exist. */
  promptsDir: string;
}

export async function loadPipelines(
  path: string,
  opts: LoadPipelinesOpts,
): Promise<PipelinesFile> {
  const raw = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`${path}: not a YAML mapping`);

  const pipelines: PipelineConfig[] = [];
  for (const [name, specUnknown] of Object.entries(raw)) {
    pipelines.push(await parsePipeline(name, specUnknown, opts, path));
  }
  if (pipelines.length === 0) throw new Error(`${path}: no pipelines defined`);
  return { pipelines };
}

/** Lookup that fails loudly (loop.md §1 drop: no silent best-effort). */
export function getPipeline(file: PipelinesFile, name: string): PipelineConfig {
  const found = file.pipelines.find((p) => p.name === name);
  if (found === undefined) {
    const available = file.pipelines.map((p) => p.name).join(", ");
    throw new Error(`unknown pipeline "${name}" — available: ${available}`);
  }
  return found;
}

/** What a ticket presents to conditional-pass selection. */
export interface PassSelection {
  tier: TicketTier;
  /** Resolved risk tier from policy.yaml (M4.2), when known. */
  riskTier?: string;
  /** Ticket labels. */
  labels?: string[];
  /** dimension_globs keys the changed files matched (M4.2/M6.2 wiring). */
  dimensions?: string[];
  /** Pass ids whose durable output already exists and still applies —
   *  continuation from artifacts, never re-derivation (Stage 2). Today's
   *  only producer is a rehydrated contract excluding the contract pass. */
  excludePasses?: string[];
  /** Explicit route-selected pass ids (adaptive planning). Applied before
   * ordinary tier/trigger rules; omitted keeps the configured pipeline. */
  includePasses?: string[];
}

/** Apply skip_on_tier, only_on, and artifact-continuation exclusions to a
 *  pipeline's ordered passes. */
export function selectPasses(pipeline: PipelineConfig, sel: PassSelection): PassConfig[] {
  return pipeline.passes.filter((pass) => {
    if (sel.includePasses !== undefined && !sel.includePasses.includes(pass.id)) return false;
    if (sel.excludePasses?.includes(pass.id)) return false;
    if (pass.skipOnTier?.includes(sel.tier)) return false;
    if (pass.onlyOn !== undefined) return onlyOnMatches(pass.onlyOn, sel);
    return true;
  });
}

function onlyOnMatches(cond: OnlyOn, sel: PassSelection): boolean {
  if (cond.risk !== undefined && sel.riskTier !== undefined && cond.risk.includes(sel.riskTier)) {
    return true;
  }
  if (cond.tier !== undefined && cond.tier.includes(sel.tier)) {
    return true;
  }
  if (cond.labels !== undefined && (sel.labels ?? []).some((l) => cond.labels!.includes(l))) {
    return true;
  }
  if (
    cond.dimensionGlobs !== undefined &&
    (sel.dimensions ?? []).some((d) => cond.dimensionGlobs!.includes(d))
  ) {
    return true;
  }
  return false;
}

/** Ordered execution stages: consecutive passes sharing a parallelGroup
 *  form one concurrent stage; everything else is a singleton stage. */
export function parallelStages(passes: PassConfig[]): PassConfig[][] {
  const stages: PassConfig[][] = [];
  for (const pass of passes) {
    const prev = stages[stages.length - 1];
    if (
      prev !== undefined &&
      pass.parallelGroup !== undefined &&
      prev[0]?.parallelGroup === pass.parallelGroup
    ) {
      prev.push(pass);
    } else {
      stages.push([pass]);
    }
  }
  return stages;
}

async function parsePipeline(
  name: string,
  specUnknown: unknown,
  opts: LoadPipelinesOpts,
  path: string,
): Promise<PipelineConfig> {
  const err = (msg: string) => new Error(`${path}: pipeline "${name}": ${msg}`);
  if (!specUnknown || typeof specUnknown !== "object") throw err("not a mapping");
  const spec = specUnknown as Record<string, unknown>;

  for (const key of Object.keys(spec)) {
    if (!["mechanical", "passes"].includes(key)) {
      throw err(`unknown key "${key}" (allowed: mechanical, passes)`);
    }
  }
  if (spec["mechanical"] !== undefined && typeof spec["mechanical"] !== "boolean") {
    throw err(`"mechanical" must be a boolean`);
  }
  const mechanical = spec["mechanical"] === true;

  const passesRaw = spec["passes"];
  if (!Array.isArray(passesRaw) || passesRaw.length === 0) {
    throw err(`"passes" must be a non-empty list`);
  }

  const passes: PassConfig[] = [];
  const seenIds = new Set<string>();
  for (const passUnknown of passesRaw) {
    const pass = await parsePass(name, passUnknown, opts, path);
    if (seenIds.has(pass.id)) throw err(`duplicate pass id "${pass.id}"`);
    seenIds.add(pass.id);
    passes.push(pass);
  }

  if (mechanical) {
    for (const pass of passes) {
      if (pass.onlyOn === undefined) {
        throw err(
          `mechanical pipeline has unconditional agent pass "${pass.id}" — ` +
            `every pass needs only_on (agent judgment only on trigger, docs/loop/design.md §5)`,
        );
      }
    }
  }

  return { name, mechanical, passes };
}

async function parsePass(
  pipeline: string,
  specUnknown: unknown,
  opts: LoadPipelinesOpts,
  path: string,
): Promise<PassConfig> {
  const where = (id: string | undefined) =>
    `${path}: pipeline "${pipeline}"${id !== undefined ? ` pass "${id}"` : ""}`;
  if (!specUnknown || typeof specUnknown !== "object") {
    throw new Error(`${where(undefined)}: pass is not a mapping`);
  }
  const spec = specUnknown as Record<string, unknown>;

  const id = spec["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${where(undefined)}: pass "id" is required`);
  }
  const err = (msg: string) => new Error(`${where(id)}: ${msg}`);

  const PASS_KEYS = [
    "id",
    "role",
    "template",
    "effort",
    "model",
    "parallel_group",
    "skip_on_tier",
    "only_on",
    "wall_clock_minutes",
    "max_turns",
  ];
  for (const key of Object.keys(spec)) {
    // A misspelled selection key (e.g. only_on_risk) silently dropped would
    // make the pass unconditional — reject loudly instead.
    if (!PASS_KEYS.includes(key)) {
      throw err(`unknown key "${key}" (allowed: ${PASS_KEYS.join(", ")})`);
    }
  }

  const role = spec["role"];
  if (typeof role !== "string" || role.length === 0) throw err(`"role" is required`);
  if (!opts.roleNames.includes(role)) {
    throw err(`unknown role "${role}" — roles.yaml defines: ${opts.roleNames.join(", ")}`);
  }

  const template = spec["template"];
  if (typeof template !== "string" || template.length === 0) {
    throw err(`"template" is required`);
  }
  const templatePath = join(opts.promptsDir, template);
  // Containment: templates are a human-ratified surface; a `../` path must
  // not validate against a file outside the prompts dir.
  const escape = relative(resolve(opts.promptsDir), resolve(templatePath));
  if (escape.startsWith("..") || isAbsolute(escape)) {
    throw err(`template must resolve under the prompts dir (got "${template}")`);
  }
  try {
    await access(templatePath);
  } catch {
    throw err(`template not found: ${templatePath}`);
  }

  const pass: PassConfig = { id, role, template };

  if (spec["effort"] !== undefined) {
    const effort = spec["effort"];
    if (typeof effort !== "string" || !EFFORTS.includes(effort as Effort)) {
      throw err(`effort must be one of ${EFFORTS.join(" | ")}`);
    }
    pass.effort = effort as Effort;
  }

  if (spec["model"] !== undefined) {
    if (typeof spec["model"] !== "string" || spec["model"].length === 0) {
      throw err(`model override must be a non-empty string`);
    }
    pass.model = spec["model"];
  }

  if (spec["parallel_group"] !== undefined) {
    if (typeof spec["parallel_group"] !== "string" || spec["parallel_group"].length === 0) {
      throw err(`parallel_group must be a non-empty string`);
    }
    pass.parallelGroup = spec["parallel_group"];
  }

  if (spec["skip_on_tier"] !== undefined) {
    const tiers = spec["skip_on_tier"];
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw err(`skip_on_tier must be a non-empty list`);
    }
    for (const t of tiers) {
      if (!TICKET_TIERS.includes(t as TicketTier)) {
        throw err(`skip_on_tier: "${String(t)}" is not one of ${TICKET_TIERS.join(" | ")}`);
      }
    }
    pass.skipOnTier = tiers as TicketTier[];
  }

  if (spec["only_on"] !== undefined) {
    pass.onlyOn = parseOnlyOn(spec["only_on"], err);
  }

  if (spec["wall_clock_minutes"] !== undefined) {
    pass.wallClockMinutes = positiveInteger(spec["wall_clock_minutes"], "wall_clock_minutes", err);
  }

  if (spec["max_turns"] !== undefined) {
    pass.maxTurns = positiveInteger(spec["max_turns"], "max_turns", err);
  }

  return pass;
}

function positiveInteger(value: unknown, key: string, err: (msg: string) => Error): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw err(`${key} must be a positive integer`);
  }
  return value;
}

function parseOnlyOn(raw: unknown, err: (msg: string) => Error): OnlyOn {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`only_on must be a mapping`);
  }
  const spec = raw as Record<string, unknown>;
  const onlyOn: OnlyOn = {};

  const strList = (key: string): string[] | undefined => {
    const v = spec[key];
    if (v === undefined) return undefined;
    // Sketch convenience: a bare string means a one-element list.
    if (typeof v === "string") return [v];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    throw err(`only_on.${key} must be a string or list of strings`);
  };

  const risk = strList("risk");
  const tier = strList("tier");
  const labels = strList("labels");
  const dimensionGlobs = strList("dimension_globs");
  if (risk !== undefined) onlyOn.risk = risk;
  if (tier !== undefined) {
    for (const t of tier) {
      if (!TICKET_TIERS.includes(t as TicketTier)) {
        throw err(`only_on.tier: "${t}" is not one of ${TICKET_TIERS.join(" | ")}`);
      }
    }
    onlyOn.tier = tier as TicketTier[];
  }
  if (labels !== undefined) onlyOn.labels = labels;
  if (dimensionGlobs !== undefined) onlyOn.dimensionGlobs = dimensionGlobs;

  for (const key of Object.keys(spec)) {
    if (!["risk", "tier", "labels", "dimension_globs"].includes(key)) {
      throw err(`only_on: unknown key "${key}" (allowed: risk, tier, labels, dimension_globs)`);
    }
  }
  if (
    risk === undefined &&
    tier === undefined &&
    labels === undefined &&
    dimensionGlobs === undefined
  ) {
    throw err(`only_on must set at least one of risk, tier, labels, dimension_globs`);
  }
  return onlyOn;
}
