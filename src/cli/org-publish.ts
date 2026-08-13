// `cormidia org publish` — the supported way to get committed org-home
// configuration onto the remote (#388).
//
// This is also the recovery command for an org home that is already dirty,
// which is the state the first production org was left in. It exists so the
// answer to "my org home has local config changes that never reached origin" is
// a Cormidia command with a bounded, reviewable scope — never `git add -A` in a
// directory that also holds the operator's own edits.
//
// Preview is the default. Publishing pushes a branch and opens a draft pull
// request, which is outward-facing, so it follows the `bootstrap publish` and
// `scheduler install` convention: describe exactly what would happen, and
// require `--execute` to do it.

import { COMMITTED_ORG_SURFACES, type CommittedOrgSurfaceId } from "../org/committed-org-surfaces.js";
import { findExistingOrg } from "../org/apps.js";
import { resolveCormidiaHomes, validateOrgHome } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeOrgHomePublication,
  orgHomeDivergence,
  planOrgHomePublication,
  type OrgHomePublicationPlan,
} from "../org/org-home-publication.js";
import type { PublicationTransaction } from "../org/git-publication-journal.js";
import { definedProps } from "../runtime/optional-properties.js";

interface OrgPublishArgs {
  surfaces: CommittedOrgSurfaceId[];
  orgHome?: string;
  stateHome?: string;
  execute: boolean;
  json: boolean;
}

interface SurfaceOutcome {
  plan: OrgHomePublicationPlan;
  transaction: PublicationTransaction | null;
}

export async function cmdOrgPublish(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const existing = await findExistingOrg(parsed.orgHome === undefined ? {} : { orgHome: parsed.orgHome });
  if (existing === undefined) {
    throw new Error("org publish: no active org — initialize one with `cormidia org init <path> --name <name>`");
  }
  await validateOrgHome(existing);
  const homes = await resolveCormidiaHomes({ orgHome: existing, ...definedProps({ stateHome: parsed.stateHome }) });
  const divergence = orgHomeDivergence(homes.orgHome);

  const outcomes: SurfaceOutcome[] = [];
  for (const surface of parsed.surfaces) {
    const plan = await planOrgHomePublication({ orgHome: homes.orgHome, surface });
    // Nothing pending for this surface: skip silently in the all-surfaces
    // reconcile so the output names only real work.
    if (plan.preflight.changed_paths.length === 0 && plan.preflight.blockers.length === 0) continue;
    if (!parsed.execute || plan.preflight.mode !== "publishable" || plan.preflight.blockers.length > 0) {
      outcomes.push({ plan, transaction: null });
      continue;
    }
    outcomes.push(
      await executeOrgHomePublication({
        orgHome: homes.orgHome,
        stateHome: homes.stateHome,
        surface,
        commitMessage: commitMessage(surface, plan),
        pullRequestTitle: `chore(cormidia): publish org ${surface}`,
        pullRequestBody: pullRequestBody(surface, plan),
        expectedContentId: plan.preflight.content_id,
      }),
    );
  }

  const blocked = outcomes.some((outcome) => outcome.plan.preflight.blockers.length > 0);
  if (parsed.json) {
    console.log(
      stableJson({
        schema_version: 1,
        kind: "org-publish",
        org_home: homes.orgHome,
        mutating: parsed.execute,
        divergence,
        surfaces: outcomes.map((outcome) => surfaceJson(outcome)),
        provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
      }).trimEnd(),
    );
    return blocked ? 1 : 0;
  }
  printText(homes.orgHome, divergence.detail, outcomes, parsed.execute);
  return blocked ? 1 : 0;
}

function printText(
  orgHome: string,
  divergenceDetail: string,
  outcomes: readonly SurfaceOutcome[],
  execute: boolean,
): void {
  console.log(`org home: ${orgHome}`);
  console.log(`divergence: ${divergenceDetail}\n`);
  if (outcomes.length === 0) {
    console.log("org publish: no committed org configuration is pending publication");
    return;
  }
  for (const { plan, transaction } of outcomes) {
    console.log(`  ${plan.surface} — ${plan.summary}`);
    console.log(`    mode:        ${plan.preflight.mode}`);
    for (const blocker of plan.preflight.blockers) console.log(`    blocked:     ${blocker}`);
    for (const path of plan.preflight.changed_paths) console.log(`    path:        ${path}`);
    if (plan.preflight.base !== null) {
      console.log(`    base:        ${plan.preflight.base.ref} @ ${plan.preflight.base.commit.slice(0, 12)}`);
      console.log(`    branch:      ${plan.preflight.branch}`);
    }
    console.log(`    durability:  ${plan.durability}`);
    if (transaction?.pull_request != null) {
      console.log(`    pull request: ${transaction.pull_request.url ?? `#${transaction.pull_request.number}`} (draft)`);
    }
    console.log(`    next:        ${plan.next_action}`);
  }
  if (!execute) console.log("\nRe-run with --execute to publish. Pull requests are opened as drafts.");
}

function surfaceJson({ plan, transaction }: SurfaceOutcome): Record<string, unknown> {
  return {
    surface: plan.surface,
    summary: plan.summary,
    mode: plan.preflight.mode,
    blockers: plan.preflight.blockers,
    declared_paths: plan.preflight.declared_paths,
    owned_paths: plan.preflight.owned_paths,
    changed_paths: plan.preflight.changed_paths,
    foreign_staged: plan.preflight.foreign_staged,
    content_id: plan.preflight.content_id,
    base: plan.preflight.base,
    branch: plan.preflight.branch,
    durability: plan.durability,
    next_action: plan.next_action,
    transaction:
      transaction === null
        ? null
        : {
            phase: transaction.phase,
            commit: transaction.commit,
            pushed_commit: transaction.pushed_commit,
            pull_request: transaction.pull_request,
          },
  };
}

function commitMessage(surface: CommittedOrgSurfaceId, plan: OrgHomePublicationPlan): string {
  return (
    `chore(cormidia): publish org ${surface}\n\n` +
    `Publishes the committed org configuration Cormidia wrote for the ${surface} surface:\n` +
    `${plan.preflight.changed_paths.map((path) => `  ${path}`).join("\n")}\n`
  );
}

function pullRequestBody(surface: CommittedOrgSurfaceId, plan: OrgHomePublicationPlan): string {
  return [
    "## What",
    "",
    `Publishes the committed org-home configuration for the \`${surface}\` surface (${plan.summary}).`,
    "",
    "## Owned paths",
    "",
    ...plan.preflight.changed_paths.map((path) => `- \`${path}\``),
    "",
    "## Review notes",
    "",
    "- Only the paths above are staged. Everything else in the org home working tree is untouched.",
    "- The org home is a human-ratified surface: read the diff rather than skimming it.",
    "",
    "Opened as a draft by `cormidia org publish`. Cormidia does not merge this.",
  ].join("\n");
}

function parseArgs(args: string[]): OrgPublishArgs {
  const surfaces: CommittedOrgSurfaceId[] = [];
  let orgHome: string | undefined;
  let stateHome: string | undefined;
  let execute = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--json") json = true;
    else if (arg === "--surface") surfaces.push(parseSurface(readValue(args, ++index, "--surface")));
    else if (arg === "--org-home") orgHome = readValue(args, ++index, "--org-home");
    else if (arg === "--state-home") stateHome = readValue(args, ++index, "--state-home");
    else throw new Error(`org publish: unknown argument "${String(arg)}"`);
  }
  if (execute && args.includes("--dry-run")) {
    throw new Error("org publish: choose either --dry-run or --execute, not both");
  }
  return {
    surfaces: surfaces.length > 0 ? surfaces : COMMITTED_ORG_SURFACES.map((surface) => surface.id),
    ...definedProps({ orgHome, stateHome }),
    execute,
    json,
  };
}

function parseSurface(value: string): CommittedOrgSurfaceId {
  const surface = COMMITTED_ORG_SURFACES.find((candidate) => candidate.id === value);
  if (surface === undefined) {
    throw new Error(
      `org publish: unknown --surface "${value}" — expected one of ` +
        COMMITTED_ORG_SURFACES.map((candidate) => candidate.id).join(", "),
    );
  }
  return surface.id;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`org publish: ${flag} requires a value`);
  return value;
}
