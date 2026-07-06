// `operon run-role <role> [--app <app>] [--turn <id>] [--template <path>]
// [--dry-run]` — one plain role turn as a synthesized one-pass pipeline.
// --dry-run prints the assembled brief and constructs no Runtime (the
// token-free path). Live CLI runs arrive with the dispatcher wiring; the
// loop-layer contract (src/loop/runRole.ts) is already live-capable and
// the dispatcher will call it with this exact signature.

import { loadRoles } from "../org/roles.js";
import { runRole } from "../loop/runRole.js";

export async function cmdRunRole(args: string[]): Promise<number> {
  let name: string | undefined;
  let app: string | undefined;
  let turnId: string | undefined;
  let templatePath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--app") app = args[++i];
    else if (arg === "--turn") turnId = args[++i];
    else if (arg === "--template") templatePath = args[++i];
    else if (arg !== undefined && !arg.startsWith("--") && name === undefined) name = arg;
    else throw new Error(`run-role: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("run-role: role name required — operon run-role <role>");

  const { roles } = await loadRoles("roles.yaml");
  const role = roles.find((r) => r.name === name);
  if (role === undefined) {
    throw new Error(
      `unknown role "${name}" — roles.yaml defines: ${roles.map((r) => r.name).join(", ")}`,
    );
  }

  if (!dryRun) {
    throw new Error(
      "live run-role turns arrive with the dispatcher wiring; use --dry-run to print the assembled brief",
    );
  }

  const result = await runRole({
    role,
    ...(app !== undefined ? { app } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(templatePath !== undefined ? { templatePath } : {}),
    dryRun: true,
    workdir: process.cwd(),
  });
  console.log(result.brief);
  return 0;
}
