// `operon run-role <role> [--app <app>] [--turn <id>] [--template <path>]
// [--dry-run]` — one plain role turn as a synthesized one-pass pipeline.
// --dry-run prints the assembled brief and constructs no Runtime (the
// token-free path). Live CLI runs arrive with the dispatcher wiring; the
// loop-layer contract (src/loop/runRole.ts) is already live-capable and
// the dispatcher will call it with this exact signature.

import { loadRoles } from "../org/roles.js";
import { runRole } from "../loop/runRole.js";
import { loadApps } from "../org/apps.js";
import { runDispatchedTurn } from "../org/turn-runner.js";

export async function cmdRunRole(args: string[]): Promise<number> {
  let name: string | undefined;
  let app: string | undefined;
  let turnId: string | undefined;
  let templatePath: string | undefined;
  let home: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--app") app = args[++i];
    else if (arg === "--turn") turnId = args[++i];
    else if (arg === "--template") templatePath = args[++i];
    else if (arg === "--home") home = args[++i];
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
    if (app === undefined) throw new Error("run-role: live turns require --app <app>");
    if (turnId === undefined) throw new Error("run-role: live turns require --turn <id>");
    const appsFile = await loadApps("apps.yaml");
    const appEntry = appsFile.apps.find((entry) => entry.name === app);
    if (appEntry === undefined) throw new Error(`run-role: unknown app "${app}" in apps.yaml`);
    const result = await runDispatchedTurn({
      role,
      app: appEntry,
      appsFile,
      turnId,
      ...(home !== undefined ? { runtimeHome: home } : {}),
    });
    console.log(`${turnId}: ${result.status} — ${result.summary}`);
    return result.status === "failed" ? 1 : 0;
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
