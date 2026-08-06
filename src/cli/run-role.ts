// `cormidia run-role <role> --app <app> --turn <id> --template <path>`
// [--assignment <candidate-id>@<effort>] [--allow-network] [--dry-run]`.
// Both modes first traverse the same read-only argument/template/assignment/
// creator-scope inspection. --dry-run then prints that execution intent and
// constructs no Runtime or state; live persists the already-validated manual
// creator journal before the dispatcher constructs a provider. Existing
// scheduled/event routes retain their governed pipeline or ticket EpisodePlan
// boundaries and reject standalone scope overrides.

import { join } from "node:path";
import { runRole } from "../loop/runRole.js";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { assembleContext } from "../org/context.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { resolveParentTaskId } from "../org/parent-task.js";
import { loadRoles } from "../org/roles.js";
import {
  inspectStandaloneRunRoleScope,
  prepareStandaloneRunRoleScope,
  type PreparedStandaloneRunRoleScope,
} from "../org/run-role-episode.js";
import { runDispatchedTurn, turnWorktreeIdentity } from "../org/turn-runner.js";
import type { ContextBundle, RoleConfig } from "../runtime/types.js";
import { extractHomeFlags } from "./home-flags.js";
import { installProcessCancellation } from "./process-signal.js";
import { definedProps } from "../runtime/optional-properties.js";

interface RunRoleCommandDependencies {
  /** Test seam at the provider-owning boundary. Dry-run must never call it. */
  runDispatchedTurn?: typeof runDispatchedTurn;
}

export async function cmdRunRole(args: string[], dependencies: RunRoleCommandDependencies = {}): Promise<number> {
  const common = extractHomeFlags(args, "run-role");
  args = common.rest;
  let name: string | undefined;
  let app: string | undefined;
  let turnId: string | undefined;
  let templatePath: string | undefined;
  let workdir: string | undefined;
  let dryRun = false;
  let parentTaskInput: string | undefined;
  let assignmentSelector: string | undefined;
  let networkAccess = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-network") networkAccess = true;
    else if (arg === "--app") app = needValue(args, ++i, "--app");
    else if (arg === "--turn") turnId = needValue(args, ++i, "--turn");
    else if (arg === "--template") templatePath = needValue(args, ++i, "--template");
    else if (arg === "--workdir") workdir = needValue(args, ++i, "--workdir");
    else if (arg === "--parent-task") parentTaskInput = needValue(args, ++i, "--parent-task");
    else if (arg === "--assignment") assignmentSelector = needValue(args, ++i, "--assignment");
    else if (arg !== undefined && !arg.startsWith("--") && name === undefined) name = arg;
    else throw new Error(`run-role: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("run-role: role name required — cormidia run-role <role>");
  if (app === undefined) {
    throw new Error("run-role: --app <app> is required for both dry-run and live turns");
  }
  if (turnId === undefined) {
    throw new Error("run-role: --turn <invocation-id> is required for both dry-run and live turns");
  }
  validateInvocationId(turnId);
  if (workdir !== undefined) {
    throw new Error(
      "run-role: --workdir is not supported; preview reads a discovered registered checkout " +
        "and live execution uses the route-selected org-managed checkout",
    );
  }

  const homes = await resolveCormidiaHomes(common);
  const parentTaskId = await resolveParentTaskId(homes.stateHome, parentTaskInput);
  const rolesPath = join(homes.orgHome, "roles.yaml");
  const { roles } = await loadRoles(rolesPath);
  const role = roles.find((r) => r.name === name);
  if (role === undefined) {
    throw new Error(`unknown role "${name}" — roles.yaml defines: ${roles.map((r) => r.name).join(", ")}`);
  }
  const appsFile = homes.appsFile;
  const appEntry = appsFile.apps.find((entry) => entry.name === app);
  if (appEntry === undefined) throw new Error(`run-role: unknown app "${app}" in apps.yaml`);
  const scopeOptions = {
    stateHome: homes.stateHome,
    app: appEntry,
    roles,
    role,
    turnId,
    ...(assignmentSelector === undefined ? {} : { assignmentSelector }),
    ...(templatePath === undefined ? {} : { templatePath }),
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
    networkAccess,
  };

  if (!dryRun) {
    const prepared = await prepareStandaloneRunRoleScope(scopeOptions);
    const cancellation = installProcessCancellation();
    const result = await (dependencies.runDispatchedTurn ?? runDispatchedTurn)({
      role,
      app: appEntry,
      appsFile,
      turnId,
      orgRoot: homes.orgHome,
      runtimeHome: homes.stateHome,
      signal: cancellation.signal,
      ...definedProps({ parentTaskId }),
      ...(prepared.creatorScope === undefined ? {} : { creatorScope: prepared.creatorScope }),
      ...(networkAccess ? { networkAccess: true } : {}),
    }).finally(() => cancellation.dispose());
    console.log(`${turnId}: ${result.status} — ${result.summary}`);
    return cancellation.exitCode ?? (result.status === "completed" ? 0 : 1);
  }

  const prepared = await inspectStandaloneRunRoleScope(scopeOptions);
  const resolvedWorkdir = resolveAppWorkdir(appEntry, {
    orgRoot: homes.orgHome,
    runtimeHome: homes.stateHome,
  });
  const managedWorkdir = join(homes.stateHome, "repos", appEntry.name);
  const standaloneWorktree =
    prepared.creatorScope?.planningDisposition === "execution_ready" &&
    prepared.creatorScope.workKind === "standalone-role-turn"
      ? turnWorktreeIdentity(homes.stateHome, appEntry.name, turnId)
      : undefined;
  const context: ContextBundle = (
    await assembleContext({
      orgHome: homes.orgHome,
      appWorkdir: resolvedWorkdir,
      app: appEntry.name,
      role,
      taskText: prepared.creatorScope?.objective ?? `manual ${role.name} turn for ${appEntry.name}`,
    })
  ).bundle;

  const result = await runRole({
    role,
    app,
    turnId,
    ...definedProps({ templatePath }),
    context,
    dryRun: true,
    workdir: resolvedWorkdir,
    ...definedProps({ parentTaskId }),
    ...(networkAccess ? { networkAccess: true } : {}),
  });
  printPreview({
    prepared,
    app: appEntry.name,
    role,
    turnId,
    previewWorkdir: resolvedWorkdir,
    managedWorkdir,
    liveWorkdir: standaloneWorktree?.path ?? managedWorkdir,
    ...(standaloneWorktree === undefined ? {} : { liveBranch: standaloneWorktree.branch }),
  });
  console.log(result.brief);
  // The brief references the context by count; a live turn passes the full
  // bundle through the adapter context channel. In the token-free inspection
  // path we also print the assembled app-aware context so the operator can
  // actually verify what the role would see (M12: app charter, role addendum,
  // memory excerpts) rather than trusting a count.
  printContext(context);
  return 0;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`run-role: ${flag} requires a value`);
  }
  return value;
}

function validateInvocationId(value: string): void {
  if (
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim() ||
    value === "." ||
    value === ".." ||
    /[\\/\0]/u.test(value)
  ) {
    throw new Error(
      "run-role: --turn must be a non-empty path-safe invocation identity; " + "it is not a GitHub ticket number",
    );
  }
}

function printPreview(options: {
  prepared: PreparedStandaloneRunRoleScope;
  app: string;
  role: RoleConfig;
  turnId: string;
  previewWorkdir: string;
  managedWorkdir: string;
  liveWorkdir: string;
  liveBranch?: string;
}): void {
  const { prepared } = options;
  console.log("[run-role preview]");
  console.log("Mode: token-free, read-only validation; provider/runtime turns: 0; state writes: 0");
  console.log(`App: ${options.app}`);
  console.log(`Role: ${options.role.name}`);
  console.log(`Turn invocation identity: ${options.turnId}`);
  console.log(
    "Turn semantics: --turn is an invocation/trace identity only; it is not a GitHub ticket " +
      "number and does not bind this turn to a ticket.",
  );
  console.log(
    prepared.journal.ticketRef === undefined
      ? "Ticket binding: none; no ticket is inferred from --turn."
      : `Ticket context: ${prepared.journal.ticketRef} comes from the durable journal, not from --turn.`,
  );
  console.log(`Preview context checkout (read-only): ${options.previewWorkdir}`);
  console.log(`Managed synchronization checkout: ${options.managedWorkdir}`);
  console.log(`Live execution checkout: ${options.liveWorkdir}`);
  if (options.liveBranch !== undefined) console.log(`Live execution branch: ${options.liveBranch}`);
  console.log(
    "Workdir contract: --workdir is unsupported; live synchronizes the registered app's managed clone " +
      "and isolates explicit standalone turns in a durable per-turn worktree.",
  );

  const scope = prepared.creatorScope;
  if (scope === undefined) {
    console.log(`Execution scope: governed ${describeRoute(prepared)}; no standalone override accepted.`);
  } else {
    console.log(
      `Execution scope: ${scope.planningDisposition} ${scope.workKind}; ` +
        `${scope.steps?.length ?? 0} bounded step(s); persisted intent reused: ${prepared.reusedPersistedIntent}`,
    );
    if (prepared.template !== undefined) {
      console.log(
        `Template: ${prepared.template.path} (${prepared.template.bytes} bytes, ` + `${prepared.template.lines} lines)`,
      );
      console.log(`Template summary: ${prepared.template.summary}`);
      console.log(`Template SHA-256: ${prepared.template.sha256}`);
    } else {
      console.log("Template: reused from durable creator scope; no mutable template file was read.");
      console.log(`Template SHA-256: ${templateSha256(scope) ?? "unavailable"}`);
    }
    console.log(
      `Provenance: ${scope.provenance.source} ${scope.provenance.creatorId} at ` + `${scope.provenance.createdAt}`,
    );
    console.log(`Provenance evidence: ${scope.provenance.evidenceRefs.join(", ")}`);
    const providerStep = scope.steps?.find((step) => step.kind === "provider_turn");
    if (providerStep?.kind === "provider_turn") {
      const assignment =
        providerStep.assignment === undefined
          ? `${options.role.runtime}/${options.role.model}@${options.role.effort} (configured fixed tuple)`
          : `${providerStep.assignment.harness}/${providerStep.assignment.model}@${providerStep.assignment.effort} ` +
            "(creator-selected approved tuple)";
      console.log(`Assignment: ${assignment}`);
      console.log(`Assignment rationale: ${providerStep.selectionReason}`);
      console.log(`Execution input refs: ${providerStep.inputRefs.map((input) => input.ref).join(", ")}`);
    }
    console.log("Objective:");
    console.log(scope.objective);
  }
  console.log(
    "Live readiness exclusions: provider authentication/readiness, budget and approval outcomes, " +
      "managed-clone synchronization, and external state changes after this preview.",
  );
  console.log("");
}

function templateSha256(scope: NonNullable<PreparedStandaloneRunRoleScope["creatorScope"]>): string | undefined {
  const standalone = scope.declaredConstraints["standaloneRunRole"];
  if (typeof standalone !== "object" || standalone === null || Array.isArray(standalone)) {
    return undefined;
  }
  const value = standalone["templateSha256"];
  return typeof value === "string" ? value : undefined;
}

function describeRoute(prepared: PreparedStandaloneRunRoleScope): string {
  const route = prepared.route;
  return route.kind === "skip" ? route.reason : `${route.kind} ${route.pipeline}`;
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
