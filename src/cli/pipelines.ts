// `operon pipelines [path]` — validate pipelines.yaml and print the pass table.
//
// Role names come from roles.yaml next to the pipelines file, templates from
// its sibling prompts/ dir — the org-home layout (docs/loop.md §4), which the
// repo root mirrors.

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadPipelines } from "../loop/pipelines.js";
import { loadRoles } from "../org/roles.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdPipelines(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "pipelines");
  if (common.rest.length > 1) throw new Error("pipelines: expected at most one pipelines.yaml path");
  const path = common.rest[0]
    ? resolve(common.rest[0])
    : join((await resolveOperonHomes(common)).orgHome, "pipelines.yaml");
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

  console.log(`${path}: OK — ${file.pipelines.length} pipelines\n`);
  const width = Math.max(10, ...file.pipelines.map((p) => p.name.length + 2));
  console.log("PIPELINE".padEnd(width) + "PASSES");
  for (const p of file.pipelines) {
    const passes = p.passes.map((x) => `${x.id}(${x.role})`).join(", ");
    console.log(p.name.padEnd(width) + (p.mechanical ? "[mechanical] " : "") + passes);
  }
  return 0;
}
