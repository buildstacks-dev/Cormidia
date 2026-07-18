// `operon bootstrap publish <app>` — coordinated draft-PR publication of the
// artifacts `operon bootstrap` wrote (#61).
//
// Preview is the default. Publishing opens pull requests on GitHub, which is
// an outward-facing effect, so it follows the same convention as `operon
// scheduler install`: describe exactly what would happen, and require an
// explicit `--execute` to do it. `--dry-run` is accepted as an explicit way to
// ask for the default, so a script can state its intent rather than rely on it.

import { resolve } from "node:path";
import { findExistingOrg } from "../org/apps.js";
import { resolveOperonHomes, validateOrgHome } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeBootstrapPublish,
  planBootstrapPublish,
  type BootstrapPublishPlan,
} from "../org/bootstrap-publish.js";

export async function cmdBootstrapPublish(args: string[]): Promise<number> {
  let app: string | undefined;
  let appDir: string | undefined;
  let orgHomeFlag: string | undefined;
  let stateHome: string | undefined;
  let execute = false;
  let json = false;
  let skipOrgHome = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--dry-run") {
      // The default. Accepted so callers can be explicit; mutually exclusive
      // with --execute so an ambiguous invocation never guesses.
      execute = false;
      if (args.includes("--execute")) {
        throw new Error("bootstrap publish: choose either --dry-run or --execute, not both");
      }
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--app-only") {
      skipOrgHome = true;
    } else if (arg === "--app-dir") {
      appDir = requireValue(args, i, "--app-dir requires a path to the app checkout");
      i++;
    } else if (arg === "--org-home") {
      orgHomeFlag = requireValue(args, i, "--org-home requires a path to an existing org home");
      i++;
    } else if (arg === "--state-home") {
      stateHome = requireValue(args, i, "--state-home requires a local path");
      i++;
    } else if (!arg.startsWith("--")) {
      if (app !== undefined) {
        throw new Error(`bootstrap publish: unexpected extra argument "${arg}"`);
      }
      app = arg;
    } else {
      throw new Error(`bootstrap publish: unknown flag "${arg}"`);
    }
  }

  if (app === undefined) {
    throw new Error("bootstrap publish: an app name is required (operon bootstrap publish <app>)");
  }

  const existingOrgHome = await findExistingOrg(orgHomeFlag ? { orgHome: orgHomeFlag } : {});
  if (existingOrgHome === undefined) {
    throw new Error(
      "bootstrap publish: no active org — initialize one with `operon org init <path> --name <name>`",
    );
  }
  await validateOrgHome(existingOrgHome);
  const homes = await resolveOperonHomes({
    orgHome: existingOrgHome,
    ...(stateHome !== undefined ? { stateHome } : {}),
  });

  const plan = await planBootstrapPublish({
    app,
    orgHome: homes.orgHome,
    appDir: resolve(appDir ?? "."),
    ...(skipOrgHome ? { publishOrgHome: false } : {}),
  });

  if (plan.blockers.length > 0) {
    if (json) {
      console.log(stableJson(planJson(plan, { executed: false })).trimEnd());
    } else {
      console.error("bootstrap publish: refusing to publish\n");
      for (const blocker of plan.blockers) console.error(`  - ${blocker}`);
    }
    return 1;
  }

  if (!execute) {
    if (json) console.log(stableJson(planJson(plan, { executed: false })).trimEnd());
    else printPreview(plan);
    return 0;
  }

  const result = await executeBootstrapPublish(plan, {
    app,
    orgHome: homes.orgHome,
    appDir: resolve(appDir ?? "."),
    ...(skipOrgHome ? { publishOrgHome: false } : {}),
  });

  if (json) {
    console.log(
      stableJson({
        ...planJson(plan, { executed: true }),
        published: result.repos.map((repo) => ({
          kind: repo.kind,
          branch: repo.branch,
          committed: repo.committed,
          pushed: repo.pushed,
          pr_number: repo.prNumber ?? null,
          pr_url: repo.prUrl ?? null,
          skipped: repo.skipped ?? null,
        })),
      }).trimEnd(),
    );
    return 0;
  }

  console.log(`published bootstrap artifacts for ${plan.app}\n`);
  for (const repo of result.repos) {
    if (repo.skipped !== undefined) {
      console.log(`  ${repo.kind}: skipped — ${repo.skipped}`);
      continue;
    }
    const pr = repo.prUrl ?? (repo.prNumber !== undefined ? `#${repo.prNumber}` : "(no pull request)");
    console.log(`  ${repo.kind}: pushed ${repo.branch} → draft PR ${pr}`);
  }
  console.log("\nBoth pull requests are drafts. Review and merge them together; Operon will not.");
  return 0;
}

function printPreview(plan: BootstrapPublishPlan): void {
  if (plan.noop) {
    console.log(`bootstrap publish: ${plan.app} is already published — nothing to do`);
    return;
  }
  console.log(`bootstrap publish preview for ${plan.app} (nothing has been changed)\n`);
  for (const repo of plan.repos) {
    console.log(`  ${repo.kind} repo: ${repo.root}`);
    if (repo.alreadyPublished) {
      console.log("    already published — would be skipped");
      continue;
    }
    console.log(`    branch:  ${repo.branch} (from ${repo.base.ref})`);
    console.log(`    commit:  ${repo.commitMessage.split("\n")[0]}`);
    console.log("    files:");
    for (const file of repo.files) console.log(`      - ${file}`);
    console.log(`    push:    origin ${repo.branch}`);
    if (repo.pr !== undefined) {
      const target = repo.pr.existingNumber !== undefined
        ? `reuse existing PR #${repo.pr.existingNumber}`
        : `open DRAFT pull request into ${repo.base.defaultBranch}`;
      console.log(`    pr:      ${target} on ${repo.pr.repo}`);
    }
  }
  console.log("\nRe-run with --execute to publish. Pull requests are opened as drafts.");
}

function planJson(plan: BootstrapPublishPlan, options: { executed: boolean }): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: "bootstrap-publish",
    app: plan.app,
    mutating: options.executed,
    blockers: plan.blockers,
    noop: plan.noop,
    repos: plan.repos.map((repo) => ({
      kind: repo.kind,
      root: repo.root,
      branch: repo.branch,
      base_ref: repo.base.ref,
      base_branch: repo.base.defaultBranch,
      files: repo.files,
      already_published: repo.alreadyPublished,
      pr: repo.pr === undefined
        ? null
        : {
            repo: repo.pr.repo,
            title: repo.pr.title,
            draft: true,
            existing_number: repo.pr.existingNumber ?? null,
          },
    })),
    provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
  };
}

function requireValue(args: string[], index: number, message: string): string {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`bootstrap publish: ${message}`);
  return next;
}
