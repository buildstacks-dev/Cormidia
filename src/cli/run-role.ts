// `operon run-role <role> [--app <app>] [--turn <id>] [--template <path>]
// [--dry-run]` — one plain role turn as a synthesized one-pass pipeline.
// --dry-run prints the assembled brief and constructs no Runtime (the
// token-free path). Live CLI runs arrive with the dispatcher wiring; the
// loop-layer contract (src/loop/runRole.ts) is already live-capable and
// the dispatcher will call it with this exact signature.

import { homedir } from "node:os";
import { join } from "node:path";
import { loadRoles } from "../org/roles.js";
import { runRole } from "../loop/runRole.js";
import { loadApps } from "../org/apps.js";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { assembleContext } from "../org/context.js";
import { runDispatchedTurn } from "../org/turn-runner.js";
import type { ContextBundle } from "../runtime/types.js";

export async function cmdRunRole(args: string[]): Promise<number> {
  let name: string | undefined;
  let app: string | undefined;
  let turnId: string | undefined;
  let templatePath: string | undefined;
  let home: string | undefined;
  let workdir: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--app") app = args[++i];
    else if (arg === "--turn") turnId = args[++i];
    else if (arg === "--template") templatePath = args[++i];
    else if (arg === "--home") home = args[++i];
    else if (arg === "--workdir") workdir = args[++i];
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

  let resolvedWorkdir = workdir ?? process.cwd();
  let context: ContextBundle | undefined;
  if (app !== undefined) {
    const appsFile = await loadApps("apps.yaml");
    const appEntry = appsFile.apps.find((entry) => entry.name === app);
    if (appEntry === undefined) throw new Error(`run-role: unknown app "${app}" in apps.yaml`);
    resolvedWorkdir = resolveAppWorkdir(appEntry, {
      orgRoot: process.cwd(),
      runtimeHome: join(homedir(), ".operon", appsFile.org.name),
      ...(workdir !== undefined ? { explicitWorkdir: workdir } : {}),
    });
    context = (
      await assembleContext({
        orgHome: process.cwd(),
        appWorkdir: resolvedWorkdir,
        app: appEntry.name,
        role,
        taskText: `manual ${role.name} turn for ${appEntry.name}`,
      })
    ).bundle;
  }

  const result = await runRole({
    role,
    ...(app !== undefined ? { app } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(templatePath !== undefined ? { templatePath } : {}),
    ...(context !== undefined ? { context } : {}),
    dryRun: true,
    workdir: resolvedWorkdir,
  });
  console.log(result.brief);
  // The brief references the context by count; a live turn passes the full
  // bundle through the adapter context channel. In the token-free inspection
  // path we also print the assembled app-aware context so the operator can
  // actually verify what the role would see (M12: app charter, role addendum,
  // memory excerpts) rather than trusting a count.
  if (context !== undefined) printContext(context);
  return 0;
}

function printContext(context: ContextBundle): void {
  console.log("\n[context] assembled taste layers and memory excerpts (adapter context channel):");
  context.taste.forEach((layer, i) => {
    console.log(`\n--- taste[${i}] ---`);
    console.log(layer);
  });
  context.memoryExcerpts.forEach((excerpt, i) => {
    console.log(`\n--- memory[${i}] ---`);
    console.log(excerpt);
  });
}
