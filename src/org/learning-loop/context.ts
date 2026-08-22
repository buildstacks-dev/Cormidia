// Governed context resolution on the kernel path (kernel decision 0027;
// compatibility-policy record §3a). The OKF manifest remains the authority
// for WHICH concept bytes a turn loads — it is the compatibility island that
// keeps every forked-engine activation serving unchanged — so the host
// resolver (src/org/learning-loop/host/resolver.ts: four-scope gather, INV-013 manifest
// membership, topic conflicts, per-scope budget shares, protected tiers,
// provisionals, episode-sticky canary lineage) renders the bytes exactly as
// before. The kernel supplies what the manifest cannot: a receipt-frozen
// resolution over its published interventions and an acknowledged exposure
// set with exact intervention lineage and host-observed evidence. The two are
// recorded side by side and cross-checked; a kernel refusal degrades loudly
// to the manifest-rendered context and never wedges a turn.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LearningLoopError } from "@cormidia/learning-loop";
import type { JsonValue, ResolvedContext } from "@cormidia/learning-loop";
import { writeFileAtomic } from "../atomic.js";
import { sanitizeIdSegment } from "./host/events.js";
import { resolveLearningContext, type ResolvedLearningContext } from "./host/resolver.js";
import { parseOkfDocument } from "../memory.js";
import { definedProps } from "../../runtime/optional-properties.js";
import { EPISODE_SOURCE_ID } from "./evidence-source.js";
import { ingestEpisodes } from "./candidates.js";
import type { CormidiaLearningLoop } from "./loop.js";
import { scopeFromLoopScope } from "./scope.js";

type HostResolveInput = Parameters<typeof resolveLearningContext>[0];

export interface GovernedResolveInput extends HostResolveInput {
  /** The composed loop; absent (dry CLI resolves, replay arms) means the
   *  manifest-rendered context alone, with no kernel record. */
  readonly learning?: CormidiaLearningLoop;
}

export interface ResolutionSidecar {
  readonly schema_version: 1;
  readonly turn_id: string;
  readonly episode_id: string;
  readonly app: string;
  readonly role: string;
  readonly resolution_id: string;
  readonly entry_ids: readonly string[];
  readonly intervention_ids: readonly string[];
  readonly kernel_concept_ids: readonly string[];
  readonly host_concept_ids: readonly string[];
  readonly bundle_lineage: string;
  readonly resolved_at: string;
  readonly exposure_id?: string;
}

export interface GovernedResolveResult extends ResolvedLearningContext {
  readonly kernel?: ResolutionSidecar;
}

function sidecarDir(stateDir: string): string {
  return join(stateDir, "resolutions");
}

function sidecarPath(stateDir: string, turnId: string): string {
  return join(sidecarDir(stateDir), `${sanitizeIdSegment(turnId)}.json`);
}

function text(spec: object, key: string, path: string): string {
  const value: unknown = Reflect.get(spec, key);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`learning-loop: ${path}: ${key} must be a non-empty string`);
  return value;
}

function texts(spec: object, key: string, path: string): string[] {
  const value: unknown = Reflect.get(spec, key);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`learning-loop: ${path}: ${key} must be a string array`);
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseSidecar(raw: string, path: string): ResolutionSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`learning-loop: ${path} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object") throw new Error(`learning-loop: ${path} must be an object`);
  if (Reflect.get(parsed, "schema_version") !== 1) throw new Error(`learning-loop: ${path}: schema_version must be 1`);
  const exposure: unknown = Reflect.get(parsed, "exposure_id");
  return {
    schema_version: 1,
    turn_id: text(parsed, "turn_id", path),
    episode_id: text(parsed, "episode_id", path),
    app: text(parsed, "app", path),
    role: text(parsed, "role", path),
    resolution_id: text(parsed, "resolution_id", path),
    entry_ids: texts(parsed, "entry_ids", path),
    intervention_ids: texts(parsed, "intervention_ids", path),
    kernel_concept_ids: texts(parsed, "kernel_concept_ids", path),
    host_concept_ids: texts(parsed, "host_concept_ids", path),
    bundle_lineage: text(parsed, "bundle_lineage", path),
    resolved_at: text(parsed, "resolved_at", path),
    ...(typeof exposure === "string" && exposure.length > 0 ? { exposure_id: exposure } : {}),
  };
}

async function writeSidecar(stateDir: string, sidecar: ResolutionSidecar): Promise<void> {
  await mkdir(sidecarDir(stateDir), { recursive: true });
  await writeFileAtomic(sidecarPath(stateDir, sidecar.turn_id), `${JSON.stringify(sidecar, null, 2)}\n`);
}

export async function readResolutionSidecar(stateDir: string, turnId: string): Promise<ResolutionSidecar | undefined> {
  const path = sidecarPath(stateDir, turnId);
  if (!existsSync(path)) return undefined;
  return parseSidecar(await readFile(path, "utf8"), path);
}

export async function listResolutionSidecars(stateDir: string, episodeId?: string): Promise<ResolutionSidecar[]> {
  const dir = sidecarDir(stateDir);
  if (!existsSync(dir)) return [];
  const out: ResolutionSidecar[] = [];
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const sidecar = parseSidecar(await readFile(join(dir, name), "utf8"), join(dir, name));
    if (episodeId === undefined || sidecar.episode_id === episodeId) out.push(sidecar);
  }
  return out;
}

function conceptIdOf(content: JsonValue): string | undefined {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return undefined;
  const markdown: unknown = Reflect.get(content, "markdown");
  if (typeof markdown !== "string") return undefined;
  try {
    return parseOkfDocument(markdown, "kernel-entry").frontmatter.loop?.id;
  } catch {
    return undefined;
  }
}

/** Resolve governed context for a turn: the manifest-rendered bytes, plus
 *  the kernel's receipt-frozen resolution when this is a governed (pinned)
 *  resolve on a composed loop. */
export async function resolveGovernedContext(input: GovernedResolveInput): Promise<GovernedResolveResult> {
  const { learning, ...hostInput } = input;
  const resolved = await resolveLearningContext(hostInput);
  if (learning === undefined || input.stateHome === undefined || input.lineageOverride !== undefined) return resolved;
  const existing = await readResolutionSidecar(learning.stateDir, input.turnId);
  if (existing !== undefined) return { ...resolved, kernel: existing };
  let context: ResolvedContext;
  try {
    context = await learning.loop.resolveContext({
      episodeId: input.episodeId,
      scope: scopeFromLoopScope(learning.org, `apps/${input.app}/roles/${input.role}`),
      query: { role: input.role, turn: input.turnId },
      budget: {
        maximumEntries: 100,
        maximumCharacters: Math.max(4 * input.policy.context_budget.default_bytes, 65_536),
      },
    });
  } catch (error) {
    const message =
      error instanceof LearningLoopError
        ? `${error.message} [${error.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}]`
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(
      `learning-loop: kernel resolution for ${input.turnId} refused — serving the manifest-rendered context (${message})\n`,
    );
    return resolved;
  }
  const kernelConceptIds = context.entries
    .map((entry) => conceptIdOf(entry.content))
    .filter((id): id is string => id !== undefined);
  const sidecar: ResolutionSidecar = {
    schema_version: 1,
    turn_id: input.turnId,
    episode_id: input.episodeId,
    app: input.app,
    role: input.role,
    resolution_id: context.id,
    entry_ids: context.entries.map((entry) => entry.id),
    intervention_ids: context.entries.map((entry) => entry.interventionId),
    kernel_concept_ids: kernelConceptIds,
    host_concept_ids: resolved.concept_ids,
    bundle_lineage: resolved.bundle_lineage,
    resolved_at: context.resolvedAt,
  };
  const divergent = kernelConceptIds.filter((id) => !resolved.concept_ids.includes(id));
  if (divergent.length > 0) {
    process.stderr.write(
      `learning-loop: kernel resolution ${context.id} names ${divergent.join(", ")} which the manifest-rendered ` +
        `context for ${input.turnId} did not load (conflict, budget, lineage, or divergence) — recorded, not served\n`,
    );
  }
  await writeSidecar(learning.stateDir, sidecar);
  return { ...resolved, kernel: sidecar };
}

/** Acknowledge, for every pinned resolve of a closed episode, the exposure
 *  set the kernel froze — once the episode's own observations exist as
 *  durable evidence (the primary projection). Idempotent per resolution. */
export async function acknowledgeEpisodeExposures(
  learning: CormidiaLearningLoop,
  episodeId: string,
): Promise<ResolutionSidecar[]> {
  const pending = (await listResolutionSidecars(learning.stateDir, episodeId)).filter(
    (sidecar) => sidecar.exposure_id === undefined,
  );
  if (pending.length === 0) return [];
  await ingestEpisodes(learning);
  const evidenceIds: string[] = [];
  for await (const page of learning.loop.queryObservations({
    sourceIds: [EPISODE_SOURCE_ID],
    episodeIds: [episodeId],
    kinds: ["cormidia.episode_outcome"],
    limit: 10,
  })) {
    for (const observation of page.items) evidenceIds.push(observation.id);
  }
  if (evidenceIds.length === 0) return [];
  const acknowledged: ResolutionSidecar[] = [];
  for (const sidecar of pending) {
    try {
      const exposure = await learning.loop.acknowledgeExposure({
        resolutionReceiptId: sidecar.resolution_id,
        appliedEntryIds: [...sidecar.entry_ids],
        assignmentId: sidecar.bundle_lineage,
        fingerprintId: `cormidia-turn-${sanitizeIdSegment(sidecar.turn_id)}`,
        evidenceIds: evidenceIds.slice(0, 1),
      });
      const next: ResolutionSidecar = { ...sidecar, ...definedProps({ exposure_id: exposure.id }) };
      await writeSidecar(learning.stateDir, next);
      acknowledged.push(next);
    } catch (error) {
      process.stderr.write(
        `learning-loop: exposure for ${sidecar.turn_id} not acknowledged (${error instanceof Error ? error.message : String(error)})\n`,
      );
    }
  }
  return acknowledged;
}
