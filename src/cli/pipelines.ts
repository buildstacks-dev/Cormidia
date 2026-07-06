// `operon pipelines [path]` — validate pipelines.yaml and print the pass table.
//
// Role names come from roles.yaml next to the pipelines file, templates from
// its sibling prompts/ dir — the org-home layout (docs/loop.md §4), which the
// repo root mirrors.

import { dirname, join } from "node:path";
import { loadPipelines } from "../loop/pipelines.js";
import { loadRoles } from "../org/roles.js";

export async function cmdPipelines(path = "pipelines.yaml"): Promise<number> {
  const home = dirname(path);
  const { roles } = await loadRoles(join(home, "roles.yaml"));
  const file = await loadPipelines(path, {
    roleNames: roles.map((r) => r.name),
    promptsDir: join(home, "prompts"),
  });

  console.log(`${path}: OK — ${file.pipelines.length} pipelines\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("PIPELINE", 10) + "PASSES");
  for (const p of file.pipelines) {
    const passes = p.passes.map((x) => `${x.id}(${x.role})`).join(", ");
    console.log(pad(p.name, 10) + (p.mechanical ? "[mechanical] " : "") + passes);
  }
  return 0;
}
