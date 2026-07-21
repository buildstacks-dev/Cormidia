// `operon org init|show|use|list|archive|upgrade` — explicit organization-home
// lifecycle.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  executeOrgInit,
  ORG_HOME_DEFINITION,
  planOrgInit,
  readActiveOrgPointer,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
  validateOrgHome,
  writeActiveOrgPointer,
  type InitOrgHomePlanPreview,
  type InitOrgHomeResult,
} from "../org/home.js";
import { loadApps } from "../org/apps.js";
import { findExistingOrg } from "../org/apps.js";
import {
  authorityPreview,
  resolveAuthority,
  type AuthorityProfile,
} from "../org/authority.js";
import { executeOrgUpgrade, planOrgUpgrade, type UpgradeAuthorityChoice } from "../org/org-upgrade.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeOrgArchive,
  formatOrgArchivePlan,
  formatOrgList,
  listOrgs,
  orgRetirementLedgerHome,
  planOrgArchive,
  recordOrgBacklink,
} from "../org/org-archive.js";
import {
  bindCliInvocationStateHome,
  currentCliInvocationStateHome,
  redirectCliInvocationLedger,
  reportCliInvocation,
} from "./invocation-audit.js";

export interface OrgCommandOptions {
  homeDir?: string;
  pointerPath?: string;
  templateRoot?: string;
}

export async function cmdOrg(args: string[], options: OrgCommandOptions = {}): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "init") return init(args.slice(1), options);
  if (subcommand === "show") return show(args.slice(1), options);
  if (subcommand === "use") return use(args.slice(1), options);
  if (subcommand === "upgrade") return upgrade(args.slice(1), options);
  if (subcommand === "list") return list(args.slice(1), options);
  if (subcommand === "archive") return archive(args.slice(1), options);
  throw new Error(
    'org: expected "init", "show", "use", "list", "archive", or "upgrade" — run `operon org --help`',
  );
}

function activePointerPath(options: OrgCommandOptions): string {
  return options.pointerPath ?? join(options.homeDir ?? homedir(), ".operon", "config");
}

async function list(args: string[], options: OrgCommandOptions): Promise<number> {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else throw new Error(`org list: unknown argument "${arg}"`);
  }
  const pointerPath = activePointerPath(options);
  const orgs = await listOrgs({ pointerPath });
  if (json) {
    console.log(stableJson({ schema_version: 1, kind: "org-list", pointerPath, orgs }).trimEnd());
  } else {
    console.log(formatOrgList(orgs));
  }
  return 0;
}

async function archive(args: string[], options: OrgCommandOptions): Promise<number> {
  const org = args[0];
  if (org === undefined || org.startsWith("--")) {
    throw new Error("org archive: org name required — operon org archive <org> (see operon org list)");
  }
  let execute = false;
  let dryRun = false;
  let confirm: string | undefined;
  let archiveRoot: string | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--confirm") confirm = needValue(args, ++i, "--confirm");
    else if (arg === "--archive-root") archiveRoot = needValue(args, ++i, "--archive-root");
    else if (arg === "--json") json = true;
    else throw new Error(`org archive: unknown argument "${arg}"`);
  }
  if (execute && dryRun) {
    throw new Error("org archive: choose either --dry-run or --execute, not both");
  }
  if (execute && confirm !== org) {
    throw new Error(`org archive: --execute requires --confirm ${org}`);
  }
  const pointerPath = activePointerPath(options);
  const planOptions = {
    pointerPath,
    org,
    ...(archiveRoot === undefined ? {} : { archiveRoot }),
  };

  // `org archive` is the one cross-org lifecycle command: it runs inside the
  // invoking (normally active) org's audit scope and retires a DIFFERENT org.
  // It must not rebind the audit to the target. Rebinding refuses as an
  // ambiguous state-home change — which made every non-active org, the entire
  // point of ENH-001, impossible to retire — and on --execute it would bind
  // the audit to the exact tree the command is about to remove. The retirement
  // belongs in a ledger that outlives it, named by `provenance.archivedOrg`.
  const plan = await planOrgArchive(planOptions);
  // With no invoking org — the state directly after retiring the active one —
  // there is no ledger at all, and the org named here is the wrong place to
  // start one: a preview must write nothing into the org it only describes,
  // and an execution would be seeding audit state in a tree it is about to
  // remove. Both journal into the retirement ledger instead, so the row is
  // still written and the removed path stays removed.
  if (currentCliInvocationStateHome() === undefined) {
    await bindCliInvocationStateHome(orgRetirementLedgerHome(plan.archiveRoot), { org });
  }
  if (!execute) {
    if (json) console.log(stableJson(plan).trimEnd());
    else console.log(formatOrgArchivePlan(plan));
    reportCliInvocation({
      dryRun: true,
      provenance: { archivedOrg: org },
      outcome: plan.blockers.length === 0 ? "org-archive-preview-ready" : "org-archive-preview-blocked",
    });
    return plan.blockers.length === 0 ? 0 : 2;
  }

  const result = await executeOrgArchive({ ...planOptions, confirm: confirm! });
  // The archived state home is gone. If it was this invocation's audit home —
  // the operator retired the org they were working in — the terminal row must
  // land somewhere that outlives it, not back inside the removed path. The
  // running row already written there is preserved in the verified archive.
  const ledgerHome = orgRetirementLedgerHome(result.plan.archiveRoot);
  const redirected = await redirectCliInvocationLedger(result.plan.org.stateHome, ledgerHome);
  reportCliInvocation({
    outcome: "org-archived",
    provenance: {
      archivedOrg: org,
      archivePath: result.archivePath,
      ...(redirected
        ? {
            auditLedger: ledgerHome,
            auditLedgerReason: "this command removed the state home it was journaling to",
          }
        : {}),
    },
  });
  if (json) {
    console.log(stableJson({
      schema_version: 1,
      kind: "org-archive-result",
      org,
      archive_path: result.archivePath,
      manifest_sha256: result.manifestSha256,
      plan: result.plan,
    }).trimEnd());
  } else {
    console.log(formatOrgArchivePlan(result.plan));
    console.log(`  manifest sha256: ${result.manifestSha256}`);
  }
  return 0;
}

async function upgrade(args: string[], options: OrgCommandOptions): Promise<number> {
  let orgHomeFlag: string | undefined;
  let stateHomeFlag: string | undefined;
  let archiveRoot: string | undefined;
  let authorityChoice: UpgradeAuthorityChoice | undefined;
  let authorityFile: string | undefined;
  let authorityBy: string | undefined;
  let execute = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--org-home") orgHomeFlag = needValue(args, ++i, "--org-home");
    else if (arg === "--state-home") stateHomeFlag = needValue(args, ++i, "--state-home");
    else if (arg === "--archive-root") archiveRoot = needValue(args, ++i, "--archive-root");
    else if (arg === "--authority") {
      const value = needValue(args, ++i, "--authority");
      if (["preserve", "delegated-operator", "conservative", "custom"].includes(value)) {
        authorityChoice = value as UpgradeAuthorityChoice;
      } else throw new Error("org upgrade: --authority must be preserve | delegated-operator | conservative | custom");
    } else if (arg === "--authority-file") authorityFile = needValue(args, ++i, "--authority-file");
    else if (arg === "--authority-by") authorityBy = needValue(args, ++i, "--authority-by");
    else if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--json") json = true;
    else throw new Error(`org upgrade: unknown argument "${arg}"`);
  }
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  const orgHome = orgHomeFlag
    ? resolve(orgHomeFlag)
    : await findExistingOrg({ homeDir, pointerPath });
  if (orgHome === undefined) throw new Error("org upgrade: no active org home; pass --org-home <path>");
  const rawApps = await loadApps(join(orgHome, "apps.yaml"));
  const pointer = await readActiveOrgPointer(pointerPath);
  const pointerStateHome = pointer.orgHome === resolve(orgHome) ? pointer.stateHome : undefined;
  const stateHome = resolve(stateHomeFlag ?? pointerStateHome ?? join(homeDir, ".operon", rawApps.org.name));
  const authorityCustomText = authorityFile ? await readFile(resolve(authorityFile), "utf8") : undefined;
  const input = {
    orgHome,
    stateHome,
    ...(authorityChoice !== undefined ? { authorityChoice } : {}),
    ...(authorityCustomText !== undefined ? { authorityCustomText } : {}),
    ...(authorityBy !== undefined ? { authorityGrantedBy: authorityBy } : {}),
    ...(archiveRoot !== undefined ? { archiveRoot } : {}),
    ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
  };
  const plan = await planOrgUpgrade(input);
  if (!execute) {
    if (json) console.log(stableJson(plan).trimEnd());
    else printUpgradePlan(plan);
    return plan.executable ? 0 : 2;
  }
  const result = await executeOrgUpgrade(input, plan);
  if (json) console.log(stableJson(result).trimEnd());
  else {
    console.log(`Org upgrade ${result.status}: ${result.plan.org_home}`);
    console.log(`Archive: ${result.archive_path ?? "not needed"}`);
    console.log(`Doctor: ${result.doctor.status} — ${result.doctor.detail}`);
  }
  return 0;
}

function printUpgradePlan(plan: Awaited<ReturnType<typeof planOrgUpgrade>>): void {
  console.log(`Org upgrade plan: schema ${plan.current_schema} -> ${plan.target_schema}`);
  console.log(`Org home: ${plan.org_home}`);
  console.log(`Archive: ${plan.archive_root}/${plan.archive_id}`);
  console.log(`Authority: ${plan.authority.choice}`);
  for (const change of plan.changes) console.log(`  ${change.action}: ${change.path} — ${change.detail}`);
  for (const blocker of plan.blockers) console.log(`  blocked: ${blocker.code} — ${blocker.remediation}`);
  console.log("No org upgrade changes made. The invocation audit row is still recorded.");
}

async function init(args: string[], options: OrgCommandOptions): Promise<number> {
  const target = args[0];
  if (!target || target.startsWith("--")) {
    throw new Error("org init: local target path required — operon org init <path> --name <name>");
  }
  let name: string | undefined;
  let stateHome: string | undefined;
  let authorityProfile: AuthorityProfile = "delegated-operator";
  let authorityFile: string | undefined;
  let authorityBy: string | undefined;
  let dryRun = false;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--name") name = needValue(args, ++i, "--name");
    else if (arg === "--state-home") stateHome = needValue(args, ++i, "--state-home");
    else if (arg === "--authority") {
      const value = needValue(args, ++i, "--authority");
      if (value === "delegated" || value === "delegated-operator") {
        authorityProfile = "delegated-operator";
      } else if (value === "conservative" || value === "custom") authorityProfile = value;
      else throw new Error("org init: --authority must be delegated-operator | conservative | custom");
    } else if (arg === "--authority-file") authorityFile = needValue(args, ++i, "--authority-file");
    else if (arg === "--authority-by") authorityBy = needValue(args, ++i, "--authority-by");
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else throw new Error(`org init: unknown argument "${arg}"`);
  }
  if (name === undefined) throw new Error("org init: --name <name> is required");
  if (authorityProfile === "custom" && (authorityFile === undefined || authorityBy === undefined)) {
    throw new Error("org init: custom authority requires --authority-file <path> and --authority-by <identity>");
  }
  if (authorityProfile !== "custom" && (authorityFile !== undefined || authorityBy !== undefined)) {
    throw new Error("org init: --authority-file/--authority-by are valid only with --authority custom");
  }
  const authorityCustomText =
    authorityFile !== undefined ? await readFile(resolve(authorityFile), "utf8") : undefined;

  const plan = await planOrgInit({
    target,
    name,
    ...(stateHome !== undefined ? { stateHome } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.pointerPath !== undefined ? { pointerPath: options.pointerPath } : {}),
    ...(options.templateRoot !== undefined ? { templateRoot: options.templateRoot } : {}),
    authorityProfile,
    ...(authorityCustomText !== undefined ? { authorityCustomText } : {}),
    ...(authorityBy !== undefined ? { authorityGrantedBy: authorityBy } : {}),
  });
  // org init has no pre-existing active state home. Bind its exact planned
  // target before the first domain mutation so creation itself has provenance.
  await bindCliInvocationStateHome(plan.preview.state_home, { org: name });
  if (dryRun) {
    if (json) console.log(stableJson(plan.preview).trimEnd());
    else printInitPlan(plan.preview);
    reportCliInvocation({
      dryRun: true,
      outcome: plan.preview.executable ? "org-init-preview-ready" : "org-init-preview-blocked",
      provenance: { authorityProfile },
    });
    return plan.preview.executable ? 0 : 2;
  }

  const result = await executeOrgInit(plan);
  // Keep the org home discoverable from its state home, so `operon org list`
  // and `operon org archive` still work after the active pointer moves on.
  await recordOrgBacklink(result.stateHome, result.orgHome);
  reportCliInvocation({
    org: result.appsFile.org.name,
    outcome: "org-created-and-selected",
    provenance: { authorityProfile },
  });
  printHomes(result, json, "created and selected");
  if (!json) {
    console.log("Next: run `operon doctor`, then onboard an app with `operon bootstrap <local-repo-path>`.");
  }
  return 0;
}

function printInitPlan(plan: InitOrgHomePlanPreview): void {
  console.log(`Org init preview: ${plan.status}`);
  console.log(`Org home:   ${plan.org_home} — ${ORG_HOME_DEFINITION}.`);
  console.log(`State home: ${plan.state_home} — ${STATE_HOME_DEFINITION}.`);
  console.log(`Pointer:    ${plan.pointer_path}`);
  console.log("Effects:");
  console.log(`  - ${plan.effects.org_home.action} org home: ${plan.effects.org_home.path}`);
  console.log(`  - ${plan.effects.state_home.action} state home: ${plan.effects.state_home.path}`);
  console.log(`  - ${plan.effects.active_pointer.action} active pointer: ${plan.effects.active_pointer.path}`);
  console.log("Generated destinations:");
  for (const destination of plan.effects.generated_destinations) {
    const suffix = destination.kind === "directory" ? "/" : "";
    console.log(
      `  - ${destination.disposition.padEnd(7)} ${destination.kind.padEnd(9)} ${destination.path}${suffix}`,
    );
  }
  console.log(`Authority: ${plan.authority.version}`);
  console.log("Automatic:");
  for (const action of plan.authority.automatic) console.log(`  - ${action}`);
  console.log("Human-gated:");
  for (const action of plan.authority.human_gated) console.log(`  - ${action}`);
  console.log("Default role chart:");
  const roleWidth = Math.max(12, ...plan.roles.map((role) => role.name.length + 2));
  const pad = (value: string, width: number) => value.padEnd(width);
  console.log(
    pad("ROLE", roleWidth) + pad("RUNTIME", 9) + pad("MODEL", 22) + pad("EFFORT", 8) + "TRIGGERS",
  );
  for (const role of plan.roles) {
    console.log(
      pad(role.name, roleWidth) +
        pad(role.runtime, 9) +
        pad(role.model, 22) +
        pad(role.effort, 8) +
        renderTriggers(role.triggers),
    );
  }
  for (const blocker of plan.blockers) {
    console.log(`Blocked: ${blocker.code} — ${blocker.detail}`);
    console.log(`  ${blocker.remediation}`);
  }
  console.log("No changes made to org/config. A dispatched CLI writes only its invocation audit row.");
}

function renderTriggers(triggers: InitOrgHomePlanPreview["roles"][number]["triggers"]): string {
  return triggers
    .map((trigger) => {
      if (trigger.schedule !== undefined) return `schedule:${trigger.schedule}`;
      if (trigger.event !== undefined) return `event:${trigger.event}`;
      return "manual";
    })
    .join(", ") || "-";
}

async function show(args: string[], options: OrgCommandOptions): Promise<number> {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else throw new Error(`org show: unknown argument "${arg}"`);
  }
  const homes = await resolveOperonHomes({
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    ...(options.pointerPath !== undefined ? { pointerPath: options.pointerPath } : {}),
  });
  const authority = await resolveAuthority({ orgHome: homes.orgHome });
  printHomes(
    { ...homes, authority, authorityPreview: previewFor(authority.profile) },
    json,
    "active",
  );
  return 0;
}

async function use(args: string[], options: OrgCommandOptions): Promise<number> {
  const orgHome = args[0];
  if (!orgHome || orgHome.startsWith("--")) throw new Error("org use: local org-home path required");
  let json = false;
  let stateHome: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--state-home") stateHome = needValue(args, ++i, "--state-home");
    else throw new Error(`org use: unknown argument "${arg}"`);
  }
  const resolvedOrgHome = resolve(orgHome);
  await validateOrgHome(resolvedOrgHome);
  const appsFile = await loadApps(join(resolvedOrgHome, "apps.yaml"));
  const homeDir = options.homeDir ?? homedir();
  const pointerPath = options.pointerPath ?? join(homeDir, ".operon", "config");
  const selectedStateHome = resolve(stateHome ?? join(homeDir, ".operon", appsFile.org.name));
  await bindCliInvocationStateHome(selectedStateHome, { org: appsFile.org.name });
  // Record the state home this selection actually resolved to, not only the
  // flag. A pointer carrying org_home alone forces every later reader to
  // re-derive it, and the ones that did not — `org list`'s active marker,
  // `org archive`'s pointer clearing — disagreed with the state home the
  // command was really using, which is how a retired org came back.
  await writeActiveOrgPointer(pointerPath, resolvedOrgHome, selectedStateHome);
  const homes = await resolveOperonHomes({
    orgHome: resolvedOrgHome,
    stateHome: selectedStateHome,
    homeDir,
    pointerPath,
  });
  await recordOrgBacklink(homes.stateHome, homes.orgHome);
  const authority = await resolveAuthority({ orgHome: homes.orgHome });
  printHomes(
    { ...homes, appsFile, authority, authorityPreview: previewFor(authority.profile) },
    json,
    "selected",
  );
  reportCliInvocation({ org: appsFile.org.name, outcome: "org-selected" });
  return 0;
}

function printHomes(
  homes: Pick<InitOrgHomeResult, "packageRoot" | "orgHome" | "stateHome" | "pointerPath" | "appsFile"> &
    Partial<Pick<InitOrgHomeResult, "authority" | "authorityPreview">>,
  json: boolean,
  status: string,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          status,
          packageRoot: homes.packageRoot,
          orgHome: homes.orgHome,
          orgHomeMeaning: ORG_HOME_DEFINITION,
          stateHome: homes.stateHome,
          stateHomeMeaning: STATE_HOME_DEFINITION,
          pointerPath: homes.pointerPath,
          org: homes.appsFile.org.name,
          apps: homes.appsFile.apps.map((app) => app.name),
          ...(homes.authority !== undefined
            ? {
                authority: {
                  profile: homes.authority.profile,
                  version: homes.authority.version,
                  sha256: homes.authority.sha256,
                  sources: homes.authority.sources,
                  ...(homes.authorityPreview !== undefined
                    ? {
                        automatic: homes.authorityPreview.automatic,
                        humanGated: homes.authorityPreview.humanGated,
                      }
                    : {}),
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`Org ${status}: ${homes.appsFile.org.name}`);
  console.log(`Org home:   ${homes.orgHome} — ${ORG_HOME_DEFINITION}.`);
  console.log(`State home: ${homes.stateHome} — ${STATE_HOME_DEFINITION}.`);
  console.log(`Pointer:    ${homes.pointerPath}`);
  console.log(`Apps:       ${homes.appsFile.apps.length}`);
  if (homes.authority !== undefined) {
    console.log(`Authority:  ${homes.authority.version} (sha256:${homes.authority.sha256})`);
    if (homes.authorityPreview !== undefined) {
      console.log("Automatic:");
      for (const action of homes.authorityPreview.automatic) console.log(`  - ${action}`);
      console.log("Human-gated:");
      for (const action of homes.authorityPreview.humanGated) console.log(`  - ${action}`);
    }
  }
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`org: ${flag} requires a value`);
  return value;
}

function previewFor(profile: string): ReturnType<typeof authorityPreview> {
  return authorityPreview(
    profile === "conservative"
      ? "conservative"
      : profile === "custom"
        ? "custom"
        : "delegated-operator",
  );
}
