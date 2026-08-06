// Five-layer context assembly (docs/architecture.md §5).
//
// The assembler returns the runtime-layer ContextBundle unchanged: layers
// [1]-[4] are taste entries in fixed order, layer [5] is memoryExcerpts.
// It never writes assembled context into a repo.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContextBundle, ContextComponent, RoleConfig } from "../runtime/types.js";
import { resolveAuthority } from "./authority.js";
import { ticketEpisodeAnchor } from "./learning/episodes.js";
import { loadLearningPolicy } from "./learning/policy.js";
import { resolveLearningContext, type ResolvedLearningContext } from "./learning/resolver.js";
import { selectAttributedExcerpts } from "./memory.js";

interface AssembleContextOptions {
  orgHome: string;
  appWorkdir: string;
  app: string;
  role: RoleConfig;
  /** Stable task text used for v1 keyword selection. For build pipelines,
   * callers pass the ticket text once and reuse the result across passes. */
  taskText: string;
  memoryCapBytes?: number;
  /** Governed-concept resolution (learning-loop M4, spec §8.1). When set,
   * the resolver runs ONCE here — the turn/pipeline pin — loading active
   * bundle concepts and unexpired provisionals ahead of the legacy memory
   * trees, emitting `concept_loaded`/eviction/expiry events, and persisting
   * the resolved-context record under the state home (never prompt bytes,
   * design §12.1). Omitted (capture-only callers, dry runs), context keeps
   * the legacy selector alone. */
  learning?: {
    /** Omitted for record-free resolves (M5 replay arms): concepts load,
     *  but no events or resolved-context records are written. */
    stateHome?: string;
    turnId: string;
    episodeId: string;
    /** Force a lineage instead of the episode-sticky assignment (M5 replay
     *  arms; see ResolveInput.lineageOverride). */
    lineageOverride?: "stable" | "canary";
  };
}

interface AssembledContext {
  bundle: ContextBundle;
  /** Rendered native-channel text for CLI integrations that need a string. */
  systemPrompt: string;
  byteSize: number;
  sources: string[];
  /** The turn's pinned resolve, when learning resolution ran. */
  resolvedLearning?: ResolvedLearningContext;
}

export async function assembleContext(options: AssembleContextOptions): Promise<AssembledContext> {
  const orgHome = resolve(options.orgHome);
  const appWorkdir = resolve(options.appWorkdir);
  const sources: string[] = [];
  const taste: string[] = [];
  const components: ContextComponent[] = [];

  const authority = await resolveAuthority({ orgHome, appWorkdir });
  sources.push(...authority.sources);
  components.push({
    category: "authority",
    source: authority.sources.join(" | "),
    rendered: authority.text,
    inclusionReason: "effective delegated authority is required for every provider turn",
    requirement: "required",
    cacheIdentity: authority.sha256,
  });

  const orgTastePath = join(orgHome, "TASTE.md");
  const orgTaste = await readRequiredLayer(orgTastePath, "Org TASTE.md", sources);
  taste.push(orgTaste);
  components.push({
    category: "taste",
    source: orgTastePath,
    rendered: orgTaste,
    inclusionReason: "org constitution applies to every role",
    requirement: "required",
  });

  const roleTastePath = join(orgHome, "taste", `${options.role.name}.md`);
  const roleTaste = await readLayer(roleTastePath, `Role taste/${options.role.name}.md`, sources, false);
  if (roleTaste !== undefined) {
    taste.push(roleTaste);
    components.push({
      category: "taste",
      source: roleTastePath,
      rendered: roleTaste,
      inclusionReason: `role-specific craft protocol for ${options.role.name}`,
      requirement: "required",
    });
  }

  const appTastePath = join(appWorkdir, ".cormidia", "TASTE.md");
  const appTaste = await readLayer(appTastePath, "App .cormidia/TASTE.md", sources, false);
  if (appTaste !== undefined) {
    taste.push(appTaste);
    components.push({
      category: "taste",
      source: appTastePath,
      rendered: appTaste,
      inclusionReason: "app-local constitution overrides apply in the target repository",
      requirement: "required",
    });
  }

  const protocol = roleProtocol(options.role);
  taste.push(protocol);
  components.push({
    category: "role_protocol",
    source: `${join(orgHome, "roles.yaml")}#${options.role.name}`,
    rendered: protocol,
    inclusionReason: "resolved role protocol and delegation limits",
    requirement: "required",
  });

  // Governed concepts resolve first (higher trust, per-scope budget shares);
  // legacy memory trees keep resolving at lowest precedence with whatever
  // bytes remain (trust: legacy seed, design §7.1).
  let resolved: ResolvedLearningContext | undefined;
  let legacyCap = options.memoryCapBytes ?? 16 * 1024;
  if (options.learning !== undefined) {
    resolved = await resolveLearningContext({
      orgHome,
      appWorkdir,
      app: options.app,
      role: options.role.name,
      turnId: options.learning.turnId,
      episodeId: options.learning.episodeId,
      taskText: options.taskText,
      policy: await loadLearningPolicy(orgHome),
      // An explicit caller cap bounds the COMBINED memory section: governed
      // concepts spend from it first, legacy memory gets the remainder.
      ...(options.memoryCapBytes !== undefined ? { budgetCapBytes: options.memoryCapBytes } : {}),
      ...(options.learning.stateHome !== undefined ? { stateHome: options.learning.stateHome } : {}),
      ...(options.learning.lineageOverride !== undefined ? { lineageOverride: options.learning.lineageOverride } : {}),
    });
    legacyCap = Math.min(legacyCap, resolved.bytes_remaining);
    sources.push(join(orgHome, "learning"), join(appWorkdir, ".cormidia", "learning"));
  }

  const memoryDirs = [
    join(orgHome, "memory", "roles", options.role.name),
    join(appWorkdir, ".cormidia", "memory", options.role.name),
  ].filter((dir) => existsSync(dir));
  const governedSections = resolved?.sections ?? [];
  const legacyExcerpts = await selectAttributedExcerpts(memoryDirs, options.taskText, legacyCap);
  const memoryExcerpts = [...governedSections, ...legacyExcerpts.map((item) => item.rendered)];
  sources.push(...memoryDirs);
  memoryExcerpts.forEach((rendered, index) => {
    const governed = index < governedSections.length;
    components.push({
      category: "memory",
      source: governed
        ? `governed-learning:${resolved?.concept_ids[index] ?? "unattributed"}`
        : legacyExcerpts[index - governedSections.length]!.source,
      rendered,
      inclusionReason: governed
        ? "governed concept selected by the pinned learning resolver"
        : "task-relevant legacy memory selected within the byte cap",
      requirement: "optional",
    });
  });

  const bundle: ContextBundle = { authority, taste, memoryExcerpts, components };
  const systemPrompt = renderContextBundle(bundle);
  return {
    bundle,
    systemPrompt,
    byteSize: Buffer.byteLength(systemPrompt, "utf8"),
    sources,
    ...(resolved !== undefined ? { resolvedLearning: resolved } : {}),
  };
}

interface EpisodeContextResolverOptions {
  orgHome: string;
  appWorkdir: string;
  app: string;
  roles: Record<string, RoleConfig>;
  stateHome: string;
  /** The dispatch/tick turn id — resolve records key on
   *  `<turnId>-i<issue>-<role>` so each episode pin is its own record. */
  turnId: string;
  memoryCapBytes?: number;
}

/** The loop engine's `contextFor` (learning-loop M5, design §8.4): one
 *  governed resolve per (ticket episode, pipeline role), memoized for the
 *  tick so build and fix passes on one ticket share one pin. This replaces
 *  the M4 tick-level builder-only pin — the resolve now lands on the same
 *  ticket episode the capture projector attributes the passes to, and
 *  reviewer-scoped concepts reach review passes. The role name comes from
 *  the loop's loaded pipeline config (never a parallel table here). A
 *  failed resolve degrades LOUDLY to the engine's fallback context — the
 *  ticket is already claimed when pipelines run, and stranding it in
 *  op:building over a corrupt learning store would be the worse failure. */
export function createEpisodeContextResolver(
  options: EpisodeContextResolverOptions,
): (
  item: { issueNumber: number; ticketRef: string; title: string; body: string },
  pipeline: string,
  role: string,
) => Promise<ContextBundle | undefined> {
  const memo = new Map<string, Promise<ContextBundle | undefined>>();
  return (item, _pipeline, roleName) => {
    const role = options.roles[roleName];
    if (role === undefined) return Promise.resolve(undefined);
    const key = `${item.issueNumber}:${role.name}`;
    const existing = memo.get(key);
    if (existing !== undefined) return existing;
    const assembled = assembleContext({
      orgHome: options.orgHome,
      appWorkdir: options.appWorkdir,
      app: options.app,
      role,
      taskText: `${item.title}\n\n${item.body}`,
      ...(options.memoryCapBytes !== undefined ? { memoryCapBytes: options.memoryCapBytes } : {}),
      learning: {
        stateHome: options.stateHome,
        turnId: `${options.turnId}-i${item.issueNumber}-${role.name}`,
        episodeId: ticketEpisodeAnchor(options.app, item.ticketRef).episodeId,
      },
    }).then(
      (result) => result.bundle,
      (error: unknown) => {
        process.stderr.write(
          `learning: per-episode resolve failed for ${item.ticketRef} (${roleName}) — ` +
            `falling back to the tick context: ` +
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
        return undefined;
      },
    );
    memo.set(key, assembled);
    return assembled;
  };
}

function renderContextBundle(bundle: ContextBundle): string {
  const sections = [
    ...(bundle.authority !== undefined ? [`## Effective delegated authority\n\n${bundle.authority.text.trim()}`] : []),
    ...bundle.taste,
  ];
  if (bundle.memoryExcerpts.length > 0) {
    sections.push(["## Memory excerpts", ...bundle.memoryExcerpts].join("\n\n"));
  }
  return sections.join("\n\n---\n\n");
}

async function readLayer(
  path: string,
  title: string,
  sources: string[],
  required: boolean,
): Promise<string | undefined> {
  if (!existsSync(path)) {
    if (required) throw new Error(`context: missing required layer ${path}`);
    return undefined;
  }
  sources.push(path);
  return `## ${title}\n\n${(await readFile(path, "utf8")).trim()}\n`;
}

async function readRequiredLayer(path: string, title: string, sources: string[]): Promise<string> {
  const layer = await readLayer(path, title, sources, true);
  if (layer === undefined) throw new Error(`context: missing required layer ${path}`);
  return layer;
}

function roleProtocol(role: RoleConfig): string {
  const outputs =
    role.outputs.length === 0
      ? "- No structured output artifacts declared in roles.yaml."
      : role.outputs.map((output) => `- ${output}`).join("\n");
  return [
    "## Role turn protocol",
    "",
    `Role: ${role.name}`,
    "",
    "Expected outputs from roles.yaml:",
    outputs,
    "",
    "GitHub conventions marker (docs/architecture.md §10):",
    "- Durable work happens through issues, branches, pull requests, comments, and committed files.",
    "- Move labels only after the artifact or state change they announce exists.",
    "- Never rely on chat memory as the artifact of record.",
    "",
    "End-of-turn learning note instruction:",
    "- Before finishing, record observed lessons, corrections, and recurring failures as learning notes — candidate input for review, not active instructions.",
    "- Craft notes go to org learning/candidates/<role>/; app-domain notes go to .cormidia/learning/candidates/<role>/ on the ticket branch.",
    "- A note states what you observed and the evidence for it. Notes carry no authority: nothing you write there loads into future context until it passes review.",
    "- Never write into memory/ trees or learning governance surfaces (bundle/, manifest.yaml, policy.yaml, quarantine/, evals/, reviews/, rejections.jsonl); those writes are critical ops and will be denied.",
    "",
    "Approval etiquette:",
    "- Continue autonomously for routine work.",
    "- For critical operations, request approval and stop at the durable approval item until a grant exists.",
  ].join("\n");
}
