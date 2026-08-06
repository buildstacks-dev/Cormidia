// `cormidia pipelines [path]` — validate pipelines.yaml and print the pass table.
//
// Role names come from roles.yaml next to the pipelines file, templates from
// its sibling prompts/ dir — the org-home layout (docs/loop/design.md §4), which the
// repo root mirrors.

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadPipelines } from "../loop/pipelines.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { loadRoles } from "../org/roles.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdPipelines(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "pipelines");
  let json = false;
  let pathArgument: string | undefined;
  for (const arg of common.rest) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) throw new Error(`pipelines: unknown argument "${arg}"`);
    else if (pathArgument === undefined) pathArgument = arg;
    else throw new Error("pipelines: expected at most one pipelines.yaml path");
  }
  const path = pathArgument
    ? resolve(pathArgument)
    : join((await resolveCormidiaHomes(common)).orgHome, "pipelines.yaml");
  // Check the target first: a missing pipelines.yaml must not surface as a
  // confusing error about the sibling roles.yaml the user never named.
  try {
    await access(path);
  } catch {
    throw new Error(`${path}: not found — pass a pipelines.yaml path or run from the org home`);
  }
  const home = dirname(path);
  const { roles } = await loadRoles(join(home, "roles.yaml"));
  const file = await loadPipelines(path, {
    roleNames: roles.map((r) => r.name),
    promptsDir: join(home, "prompts"),
  });
  const report = {
    schema_version: 1,
    kind: "pipelines",
    path,
    pipelineCount: file.pipelines.length,
    pipelines: file.pipelines,
  } as const;
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(`${report.path}: OK — ${report.pipelineCount} pipelines\n`);
  const width = Math.max(10, ...report.pipelines.map((p) => p.name.length + 2));
  console.log("PIPELINE".padEnd(width) + "PASSES");
  for (const p of report.pipelines) {
    const passes = p.passes.map((x) => `${x.id}(${x.role})`).join(", ");
    console.log(p.name.padEnd(width) + (p.mechanical ? "[mechanical] " : "") + passes);
  }
  return 0;
}
