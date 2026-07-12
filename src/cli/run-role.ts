// `operon run-role <role> [--app <app>] [--turn <id>] [--template <path>]
// [--dry-run]` — one plain role turn as a synthesized one-pass pipeline.
// --dry-run prints the assembled brief and constructs no Runtime (the
// token-free path). Live CLI runs arrive with the dispatcher wiring; the
// loop-layer contract (src/loop/runRole.ts) is already live-capable and
// the dispatcher will call it with this exact signature.

import { join } from "node:path";
import { loadRoles } from "../org/roles.js";
import { runRole } from "../loop/runRole.js";
import { loadApps } from "../org/apps.js";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { assembleContext } from "../org/context.js";
import { runDispatchedTurn } from "../org/turn-runner.js";
import type { ContextBundle } from "../runtime/types.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { installProcessCancellation } from "./process-signal.js";
import { resolveParentTaskId } from "../org/parent-task.js";

export async function cmdRunRole(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "run-role");
  args = common.rest;
  let name: string | undefined;
  let app: string | undefined;
  let turnId: string | undefined;
  let templatePath: string | undefined;
  let workdir: string | undefined;
  let dryRun = false;
  let parentTaskInput: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--app") app = needValue(args, ++i, "--app");
    else if (arg === "--turn") turnId = needValue(args, ++i, "--turn");
    else if (arg === "--template") templatePath = needValue(args, ++i, "--template");
    else if (arg === "--workdir") workdir = needValue(args, ++i, "--workdir");
    else if (arg === "--parent-task") parentTaskInput = needValue(args, ++i, "--parent-task");
    else if (arg !== undefined && !arg.startsWith("--") && name === undefined) name = arg;
    else throw new Error(`run-role: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("run-role: role name required — operon run-role <role>");

  const homes = await resolveOperonHomes(common);
  const parentTaskId = await resolveParentTaskId(homes.stateHome, parentTaskInput);
  const rolesPath = join(homes.orgHome, "roles.yaml");
  const appsPath = join(homes.orgHome, "apps.yaml");
  const { roles } = await loadRoles(rolesPath);
  const role = roles.find((r) => r.name === name);
  if (role === undefined) {
    throw new Error(
      `unknown role "${name}" — roles.yaml defines: ${roles.map((r) => r.name).join(", ")}`,
    );
  }

  if (!dryRun) {
    if (app === undefined) throw new Error("run-role: live turns require --app <app>");
    if (turnId === undefined) throw new Error("run-role: live turns require --turn <id>");
    const appsFile = await loadApps(appsPath);
    const appEntry = appsFile.apps.find((entry) => entry.name === app);
    if (appEntry === undefined) throw new Error(`run-role: unknown app "${app}" in apps.yaml`);
    const cancellation = installProcessCancellation();
    const result = await runDispatchedTurn({
      role,
      app: appEntry,
      appsFile,
      turnId,
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
      signal: cancellation.signal,
      ...(parentTaskId !== undefined ? { parentTaskId } : {}),
    }).finally(() => cancellation.dispose());
    console.log(`${turnId}: ${result.status} — ${result.summary}`);
    return cancellation.exitCode ?? (result.status === "failed" ? 1 : 0);
  }

  let resolvedWorkdir = workdir ?? process.cwd();
  let context: ContextBundle | undefined;
  if (app !== undefined) {
    const appsFile = await loadApps(appsPath);
    const appEntry = appsFile.apps.find((entry) => entry.name === app);
    if (appEntry === undefined) throw new Error(`run-role: unknown app "${app}" in apps.yaml`);
    resolvedWorkdir = resolveAppWorkdir(appEntry, {
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
      ...(workdir !== undefined ? { explicitWorkdir: workdir } : {}),
    });
    context = (
      await assembleContext({
        orgHome: homes.orgHome,
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
    ...(parentTaskId !== undefined ? { parentTaskId } : {}),
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

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`run-role: ${flag} requires a value`);
  }
  return value;
}

function printContext(context: ContextBundle): void {
  console.log("\n[context] assembled authority, taste layers, and memory excerpts (adapter context channel):");
  if (context.authority !== undefined) {
    console.log(`\n--- authority ${context.authority.version} sha256:${context.authority.sha256} ---`);
    console.log(context.authority.text);
  }
  context.taste.forEach((layer, i) => {
    console.log(`\n--- taste[${i}] ---`);
    console.log(layer);
  });
  context.memoryExcerpts.forEach((excerpt, i) => {
    console.log(`\n--- memory[${i}] ---`);
    console.log(excerpt);
  });
}
