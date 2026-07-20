import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runtimeCapabilityProfile, type RuntimeCapabilityProfile } from "../runtime/capabilities.js";
import { validateTurnExecutionFacts } from "../runtime/assignment.js";
import type { ContextBundle, ContextComponent, RuntimeKind } from "../runtime/types.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { renderContextBundle, renderTurnExecutionFacts } from "../runtime/worktree-context.js";
import { writeLoopFileAtomic } from "./durable.js";
import { efficiencyEpisodeDir, fingerprint, type EfficiencyRoute } from "./efficiency.js";

export type ContextCategory =
  | "authority"
  | "execution"
  | "taste"
  | "role_protocol"
  | "memory"
  | "ticket"
  | "acceptance_criteria"
  | "contract"
  | "unresolved_findings"
  | "spec"
  | "history"
  | "repo"
  | "brief"
  | "template";

export interface ContextManifestComponent {
  component_id: string;
  category: ContextCategory;
  source: string;
  source_sha256: string;
  source_bytes: number;
  rendered_bytes: number;
  inclusion_reason: string;
  prior_pass_change: "initial" | "unchanged" | "changed" | "new";
  cache_identity: string;
  requirement: "required" | "optional";
  eviction: "kept" | "evicted";
  transport: "full" | "reference" | "delta" | "evicted";
  duplicate_of: string | null;
  cap_bytes: number | null;
  eviction_reason: string | null;
}

export interface ContextManifest {
  schema_version: 1;
  episode_id: string;
  app: string;
  run_id: string;
  plan_version?: number;
  plan_step_id?: string;
  route: EfficiencyRoute;
  render_sha256: string;
  rendered_bytes: number;
  source_bytes: number;
  required_bytes: number;
  optional_bytes: number;
  cap_bytes: number;
  over_budget_required: boolean;
  cache: RuntimeCapabilityProfile["cache"] & { runtime: RuntimeKind };
  components: ContextManifestComponent[];
}

type ManifestInputComponent = {
  category: ContextCategory;
  source: string;
  rendered: string;
  inclusionReason: string;
  requirement: "required" | "optional";
  cacheIdentity?: string;
};

interface PreparedEntry {
  input: ManifestInputComponent;
  submitted: string;
  manifest: ContextManifestComponent;
}

export class ContextBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBudgetExceededError";
  }
}

export const CONTEXT_ROUTE_CAPS: Readonly<Record<EfficiencyRoute, number>> = {
  deterministic: 64 * 1024,
  quick: 64 * 1024,
  standard: 128 * 1024,
  deep: 256 * 1024,
};

const CATEGORY_CAPS: Partial<Record<ContextCategory, number>> = {
  memory: 16 * 1024,
  spec: 32 * 1024,
  history: 16 * 1024,
  repo: 8 * 1024,
};

export async function writeContextManifest(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  context: ContextBundle;
  brief: string;
  template?: string;
  route?: EfficiencyRoute;
  runtime?: RuntimeKind;
  planVersion?: number;
  planStepId?: string;
  capBytes?: number;
}): Promise<{
  manifest: ContextManifest;
  relativeRef: string;
  context: ContextBundle;
  brief: string;
  template?: string;
}> {
  const previous = await latestContextManifest(input.root, input.episodeId);
  const route = input.route ?? "standard";
  const runtime = input.runtime ?? "pi";
  const raw: ManifestInputComponent[] = [
    ...contextComponents(input.context),
    ...briefComponents(input.brief),
    ...(input.template === undefined
      ? []
      : [{
          category: "template" as const,
          source: "pipeline:versioned-pass-template",
          rendered: input.template,
          inclusionReason: "human-ratified protocol for the selected pass",
          requirement: "required" as const,
        }]),
  ];
  assertNoHiddenAnswer(raw);
  const capBytes = input.capBytes ?? CONTEXT_ROUTE_CAPS[route];
  const entries = prepareEntries(raw, previous, capBytes);
  const preparedContext = preparedContextBundle(input.context, entries);
  const briefEntries = entries.filter((entry) => isBriefCategory(entry.input.category));
  const preparedBrief = briefEntries.every((entry) => entry.submitted === entry.input.rendered)
    ? input.brief
    : briefEntries.map((entry) => entry.submitted).filter(Boolean).join("\n\n");
  const preparedTemplate = entries.find((entry) => entry.input.category === "template")?.submitted;
  const renderedContext = renderContextBundle(preparedContext);
  const rendered = `${renderedContext}${preparedBrief}${preparedTemplate ?? ""}`;
  const requiredBytes = entries
    .filter((entry) => entry.input.requirement === "required")
    .reduce((sum, entry) => sum + Buffer.byteLength(entry.submitted), 0);
  const optionalBytes = entries
    .filter((entry) => entry.input.requirement === "optional")
    .reduce((sum, entry) => sum + Buffer.byteLength(entry.submitted), 0);
  const sourceBytes = raw.reduce((sum, component) => sum + Buffer.byteLength(component.rendered), 0);
  const cache = runtimeCapabilityProfile(runtime).cache;
  const manifest: ContextManifest = {
    schema_version: 1,
    episode_id: input.episodeId,
    app: input.app,
    run_id: input.runId,
    ...(input.planVersion !== undefined ? { plan_version: input.planVersion } : {}),
    ...(input.planStepId !== undefined ? { plan_step_id: input.planStepId } : {}),
    route,
    render_sha256: fingerprint({ context: renderedContext, brief: preparedBrief, template: preparedTemplate ?? null }),
    rendered_bytes: Buffer.byteLength(rendered),
    source_bytes: sourceBytes,
    required_bytes: requiredBytes,
    optional_bytes: optionalBytes,
    cap_bytes: capBytes,
    over_budget_required: requiredBytes > capBytes,
    cache: { runtime, ...cache },
    components: entries.map((entry) => entry.manifest).sort((a, b) => a.component_id.localeCompare(b.component_id)),
  };
  const path = join(runPaths(input.root, input.app, input.runId).dir, "context-manifest.json");
  await writeLoopFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const episodeRef = join(efficiencyEpisodeDir(input.root, input.episodeId), "context", `${sha256(input.runId)}.json`);
  await writeLoopFileAtomic(episodeRef, `${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.over_budget_required) {
    throw new ContextBudgetExceededError(
      `episode ${input.episodeId} required context is ${requiredBytes} bytes, above the ${capBytes}-byte ${route} cap; reassess the route before provider construction`,
    );
  }
  return {
    manifest,
    relativeRef: "context-manifest.json",
    context: preparedContext,
    brief: preparedBrief,
    ...(preparedTemplate !== undefined ? { template: preparedTemplate } : {}),
  };
}

export async function readContextManifest(root: string, app: string, runId: string): Promise<ContextManifest> {
  return JSON.parse(await readFile(join(runPaths(root, app, runId).dir, "context-manifest.json"), "utf8")) as ContextManifest;
}

export interface ContextExplanation {
  episode_id: string;
  run_id: string;
  route: EfficiencyRoute;
  rendered_bytes: number;
  cap_bytes: number;
  dominant: Array<Pick<ContextManifestComponent, "category" | "source" | "rendered_bytes" | "inclusion_reason" | "transport" | "eviction" | "eviction_reason">>;
}

export async function explainContext(root: string, episodeId: string): Promise<ContextExplanation> {
  const manifest = await latestContextManifest(root, episodeId);
  if (manifest === undefined) throw new Error(`no context manifest for episode ${episodeId}`);
  return {
    episode_id: manifest.episode_id,
    run_id: manifest.run_id,
    route: manifest.route,
    rendered_bytes: manifest.rendered_bytes,
    cap_bytes: manifest.cap_bytes,
    dominant: [...manifest.components]
      .sort((a, b) => b.rendered_bytes - a.rendered_bytes || a.component_id.localeCompare(b.component_id))
      .slice(0, 10)
      .map(({ category, source, rendered_bytes, inclusion_reason, transport, eviction, eviction_reason }) => ({
        category,
        source,
        rendered_bytes,
        inclusion_reason,
        transport,
        eviction,
        eviction_reason,
      })),
  };
}

function prepareEntries(
  raw: ManifestInputComponent[],
  previous: ContextManifest | undefined,
  totalCap: number,
): PreparedEntry[] {
  const priorById = new Map(previous?.components.map((component) => [component.component_id, component]));
  const firstByHash = new Map<string, string>();
  const categoryBytes = new Map<ContextCategory, number>();
  const requiredReserve = raw
    .filter((component) => component.requirement === "required")
    .reduce((sum, component) => sum + Buffer.byteLength(component.rendered), 0);
  const optionalAllowance = Math.max(0, totalCap - requiredReserve);
  let optionalBytes = 0;
  return raw.map((component): PreparedEntry => {
    const sourceHash = sha256(component.rendered);
    const id = sha256(`${component.category}\0${component.source}`).slice(0, 24);
    const prior = priorById.get(id);
    const duplicateOf = firstByHash.get(sourceHash) ?? null;
    if (duplicateOf === null) firstByHash.set(sourceHash, id);
    const change = previous === undefined
      ? "initial" as const
      : prior === undefined
        ? "new" as const
        : prior.source_sha256 === sourceHash
          ? "unchanged" as const
          : "changed" as const;
    const categoryCap = CATEGORY_CAPS[component.category] ?? null;
    let submitted = component.rendered;
    let transport: ContextManifestComponent["transport"] = change === "changed" ? "delta" : "full";
    let eviction: ContextManifestComponent["eviction"] = "kept";
    let evictionReason: string | null = null;

    if (component.requirement === "optional" && duplicateOf !== null) {
      submitted = "";
      transport = "evicted";
      eviction = "evicted";
      evictionReason = `duplicate of ${duplicateOf}`;
    } else if (component.requirement === "optional" && change === "unchanged") {
      submitted = `[context-reference source="${component.source}" sha256="${sourceHash}"]`;
      transport = "reference";
    }

    const bytes = Buffer.byteLength(submitted);
    const usedCategory = categoryBytes.get(component.category) ?? 0;
    if (
      component.requirement === "optional" &&
      eviction === "kept" &&
      ((categoryCap !== null && usedCategory + bytes > categoryCap) || optionalBytes + bytes > optionalAllowance)
    ) {
      submitted = "";
      transport = "evicted";
      eviction = "evicted";
      evictionReason = categoryCap !== null && usedCategory + bytes > categoryCap
        ? `${component.category} category cap ${categoryCap} bytes`
        : `route optional allowance ${optionalAllowance} bytes after protected context`;
    }
    const submittedBytes = Buffer.byteLength(submitted);
    categoryBytes.set(component.category, usedCategory + submittedBytes);
    if (component.requirement === "optional") optionalBytes += submittedBytes;
    return {
      input: component,
      submitted,
      manifest: {
        component_id: id,
        category: component.category,
        source: component.source,
        source_sha256: sourceHash,
        source_bytes: Buffer.byteLength(component.rendered),
        rendered_bytes: submittedBytes,
        inclusion_reason: component.inclusionReason,
        prior_pass_change: change,
        cache_identity: component.cacheIdentity ?? sha256(`${component.category}\0${sourceHash}`),
        requirement: component.requirement,
        eviction,
        transport,
        duplicate_of: duplicateOf,
        cap_bytes: categoryCap,
        eviction_reason: evictionReason,
      },
    };
  });
}

function preparedContextBundle(context: ContextBundle, entries: PreparedEntry[]): ContextBundle {
  const contextEntries = entries.filter((entry) => ["authority", "execution", "taste", "role_protocol", "memory"].includes(entry.input.category));
  // Preserve the caller's exact bundle (including object identity) when the
  // budgeter made no transport change. Besides avoiding needless adapter
  // churn, this keeps episode-sticky governed context sticky by construction.
  if (contextEntries.every((entry) =>
    entry.submitted === entry.input.rendered &&
    entry.manifest.duplicate_of === null &&
    entry.manifest.eviction === "kept" &&
    entry.manifest.transport === "full"
  )) return context;
  const authority = context.authority === undefined
    ? undefined
    : contextEntries.find((entry) => entry.input.category === "authority");
  const taste = contextEntries
    .filter((entry) => entry.input.category === "taste" || entry.input.category === "role_protocol")
    .map((entry) => entry.submitted)
    .filter(Boolean);
  const memoryExcerpts = contextEntries
    .filter((entry) => entry.input.category === "memory")
    .map((entry) => entry.submitted)
    .filter(Boolean);
  const components: ContextComponent[] = contextEntries
    .filter((entry) => entry.submitted !== "")
    .map((entry) => ({
      category: entry.input.category as ContextComponent["category"],
      source: entry.input.source,
      rendered: entry.submitted,
      inclusionReason: entry.input.inclusionReason,
      requirement: entry.input.requirement,
      ...(entry.input.cacheIdentity !== undefined ? { cacheIdentity: entry.input.cacheIdentity } : {}),
    }));
  return {
    ...(context.authority !== undefined && authority !== undefined
      ? { authority: { ...context.authority, text: authority.submitted } }
      : {}),
    taste,
    memoryExcerpts,
    components,
    ...(context.execution !== undefined ? { execution: context.execution } : {}),
  };
}

function contextComponents(context: ContextBundle): ManifestInputComponent[] {
  const components: ManifestInputComponent[] = context.components === undefined
    ? []
    : context.components.map((component) => ({ ...component }));
  if (context.components === undefined && context.authority !== undefined) {
    components.push({
      category: "authority",
      source: context.authority.sources.join(" | ") || "unattributed:authority",
      rendered: context.authority.text,
      inclusionReason: "effective delegated authority; never evict",
      requirement: "required",
      cacheIdentity: context.authority.sha256,
    });
  }
  if (context.components === undefined) {
    context.taste.forEach((rendered, index) => components.push({
      category: "taste",
      source: `unattributed:taste:${index}`,
      rendered,
      inclusionReason: "safety and taste layer; never evict",
      requirement: "required",
    }));
    context.memoryExcerpts.forEach((rendered, index) => components.push({
      category: "memory",
      source: `unattributed:memory:${index}`,
      rendered,
      inclusionReason: "optional governed or legacy memory excerpt",
      requirement: "optional",
    }));
  }
  if (context.execution !== undefined) {
    const facts = validateTurnExecutionFacts(
      context.execution,
      "context manifest execution facts",
    );
    const rendered = renderTurnExecutionFacts(facts);
    components.push({
      category: "execution",
      source: `runtime-capability-profile:${runtimeCapabilityProfile(facts.assignment.harness).ref}:role:${facts.role}`,
      rendered,
      inclusionReason: "exact assignment, role policy, and profile-derived adapter capabilities; never evict",
      requirement: "required",
      cacheIdentity: sha256(`turn-execution-facts/v1\0${rendered}`),
    });
  }
  return components;
}

function briefComponents(brief: string): ManifestInputComponent[] {
  const matches = [...brief.matchAll(/^\[([a-z_]+)]\n/gm)];
  if (matches.length === 0) return [{
    category: "brief",
    source: "loop:assembled-brief",
    rendered: brief,
    inclusionReason: "unstructured executable brief",
    requirement: "required",
  }];
  const components: ManifestInputComponent[] = [];
  const firstIndex = matches[0]?.index ?? 0;
  if (firstIndex > 0) {
    components.push({
      category: "brief",
      source: "loop:assembled-brief-prefix",
      rendered: brief.slice(0, firstIndex).trimEnd(),
      inclusionReason: "pass-specific executable task evidence",
      requirement: "required",
    });
  }
  components.push(...matches.map((match, index) => {
    const tag = match[1] ?? "brief";
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? brief.length;
    const rendered = brief.slice(start, end).trimEnd();
    const category = briefCategory(tag, rendered);
    const requirement = ["brief", "ticket", "acceptance_criteria", "contract", "unresolved_findings"].includes(category)
      ? "required" as const
      : "optional" as const;
    return {
      category,
      source: `loop:brief:${tag}:${index}`,
      rendered,
      inclusionReason: briefInclusionReason(category),
      requirement,
    };
  }));
  return components;
}

function briefCategory(tag: string, rendered: string): ContextCategory {
  if (tag === "ticket") return "ticket";
  if (tag === "contract") return "contract";
  if (tag === "findings") return /\[active\b|Gate output \(verbatim\)/.test(rendered) ? "unresolved_findings" : "history";
  if (tag === "spec") return "spec";
  if (tag === "history") return "history";
  if (tag === "repo") return "repo";
  if (tag === "memory") return "history";
  return "brief";
}

function briefInclusionReason(category: ContextCategory): string {
  if (category === "ticket") return "ticket goal and acceptance criteria; never evict";
  if (category === "contract") return "accepted implementation contract";
  if (category === "unresolved_findings") return "unresolved findings and gate evidence; never evict";
  if (category === "spec") return "optional product specification evidence";
  if (category === "history") return "optional resolved or prior-attempt history";
  if (category === "repo") return "optional repository command summary";
  if (category === "memory") return "optional applicable learned concepts";
  return "assembled pass-specific task evidence";
}

function isBriefCategory(category: ContextCategory): boolean {
  return !["authority", "execution", "taste", "role_protocol", "memory", "template"].includes(category);
}

function assertNoHiddenAnswer(components: ManifestInputComponent[]): void {
  const leaking = components.find((component) => /OPERON_HIDDEN_[A-Za-z0-9_-]+/.test(component.rendered));
  if (leaking !== undefined) throw new Error(`hidden_answer_leakage:${leaking.source}`);
}

async function latestContextManifest(root: string, episodeId: string): Promise<ContextManifest | undefined> {
  const dir = join(efficiencyEpisodeDir(root, episodeId), "context");
  if (!existsSync(dir)) return undefined;
  const manifests: ContextManifest[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      manifests.push(JSON.parse(await readFile(join(dir, file), "utf8")) as ContextManifest);
    } catch {
      // A corrupt prior manifest is never treated as cache/delta equality.
    }
  }
  return manifests.sort((a, b) => a.run_id.localeCompare(b.run_id)).at(-1);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
