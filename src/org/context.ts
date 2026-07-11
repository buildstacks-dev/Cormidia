// Five-layer context assembly (docs/architecture.md §5).
//
// The assembler returns the runtime-layer ContextBundle unchanged: layers
// [1]-[4] are taste entries in fixed order, layer [5] is memoryExcerpts.
// It never writes assembled context into a repo.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContextBundle, RoleConfig } from "../runtime/types.js";
import { loadLearningPolicy } from "./learning/policy.js";
import {
  resolveLearningContext,
  type ResolvedLearningContext,
} from "./learning/resolver.js";
import { selectExcerpts } from "./memory.js";

export interface AssembleContextOptions {
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
    stateHome: string;
    turnId: string;
    episodeId: string;
  };
}

export interface AssembledContext {
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

  const orgTaste = await readRequiredLayer(join(orgHome, "TASTE.md"), "Org TASTE.md", sources);
  taste.push(orgTaste);

  const roleTaste = await readLayer(
    join(orgHome, "taste", `${options.role.name}.md`),
    `Role taste/${options.role.name}.md`,
    sources,
    false,
  );
  if (roleTaste !== undefined) taste.push(roleTaste);

  const appTaste = await readLayer(
    join(appWorkdir, ".operon", "TASTE.md"),
    "App .operon/TASTE.md",
    sources,
    false,
  );
  if (appTaste !== undefined) taste.push(appTaste);

  taste.push(roleProtocol(options.role));

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
      stateHome: options.learning.stateHome,
    });
    legacyCap = Math.min(legacyCap, resolved.bytes_remaining);
    sources.push(join(orgHome, "learning"), join(appWorkdir, ".operon", "learning"));
  }

  const memoryDirs = [
    join(orgHome, "memory", "roles", options.role.name),
    join(appWorkdir, ".operon", "memory", options.role.name),
  ].filter((dir) => existsSync(dir));
  const memoryExcerpts = [
    ...(resolved?.sections ?? []),
    ...(await selectExcerpts(memoryDirs, options.taskText, legacyCap)),
  ];
  sources.push(...memoryDirs);

  const bundle: ContextBundle = { taste, memoryExcerpts };
  const systemPrompt = renderContextBundle(bundle);
  return {
    bundle,
    systemPrompt,
    byteSize: Buffer.byteLength(systemPrompt, "utf8"),
    sources,
    ...(resolved !== undefined ? { resolvedLearning: resolved } : {}),
  };
}

export function renderContextBundle(bundle: ContextBundle): string {
  const sections = [...bundle.taste];
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
    "- Craft notes go to org learning/candidates/<role>/; app-domain notes go to .operon/learning/candidates/<role>/ on the ticket branch.",
    "- A note states what you observed and the evidence for it. Notes carry no authority: nothing you write there loads into future context until it passes review.",
    "- Never write into memory/ trees or learning governance surfaces (bundle/, manifest.yaml, policy.yaml, quarantine/, evals/, reviews/, rejections.jsonl); those writes are critical ops and will be denied.",
    "",
    "Approval etiquette:",
    "- Continue autonomously for routine work.",
    "- For critical operations, request approval and stop at the durable approval item until a grant exists.",
  ].join("\n");
}
