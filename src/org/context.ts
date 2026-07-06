// Five-layer context assembly (docs/architecture.md §5).
//
// The assembler returns the runtime-layer ContextBundle unchanged: layers
// [1]-[4] are taste entries in fixed order, layer [5] is memoryExcerpts.
// It never writes assembled context into a repo.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContextBundle, RoleConfig } from "../runtime/types.js";
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
}

export interface AssembledContext {
  bundle: ContextBundle;
  /** Rendered native-channel text for CLI integrations that need a string. */
  systemPrompt: string;
  byteSize: number;
  sources: string[];
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

  const memoryDirs = [
    join(orgHome, "memory", "roles", options.role.name),
    join(appWorkdir, ".operon", "memory", options.role.name),
  ].filter((dir) => existsSync(dir));
  const memoryExcerpts = await selectExcerpts(
    memoryDirs,
    options.taskText,
    options.memoryCapBytes ?? 16 * 1024,
  );
  sources.push(...memoryDirs);

  const bundle: ContextBundle = { taste, memoryExcerpts };
  const systemPrompt = renderContextBundle(bundle);
  return {
    bundle,
    systemPrompt,
    byteSize: Buffer.byteLength(systemPrompt, "utf8"),
    sources,
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
    "End-of-turn memory write instruction:",
    "- Before finishing, record confirmed reusable lessons or corrections in the appropriate OKF memory bundle.",
    "- Craft lessons go to org memory/roles/<role>/; app-domain lessons go to .operon/memory/<role>/ on the ticket branch.",
    "- Do not hedge wrong lessons; curation deletes wrong lessons and deprecates doubtful ones.",
    "",
    "Approval etiquette:",
    "- Continue autonomously for routine work.",
    "- For critical operations, request approval and stop at the durable approval item until a grant exists.",
  ].join("\n");
}
