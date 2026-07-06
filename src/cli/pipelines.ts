// `operon pipelines [path]` — validate pipelines.yaml and print the pass table.
//
// Role names come from roles.yaml next to the pipelines file, templates from
// its sibling prompts/ dir — the org-home layout (docs/loop.md §4), which the
// repo root mirrors.

import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadPipelines } from "../loop/pipelines.js";
import { loadRoles } from "../org/roles.js";

export async function cmdPipelines(path = "pipelines.yaml"): Promise<number> {
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
  console.log("PIPELINE".padEnd(10) + "PASSES");
  for (const p of file.pipelines) {
    const passes = p.passes.map((x) => `${x.id}(${x.role})`).join(", ");
    console.log(p.name.padEnd(10) + (p.mechanical ? "[mechanical] " : "") + passes);
  }
  return 0;
}
