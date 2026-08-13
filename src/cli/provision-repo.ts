// `cormidia app provision-repo` / `cormidia org provision-repo` — the governed
// route from a local checkout to a private GitHub repository (#382).
//
// This exists because "requires human approval" and "requires the human to type
// `gh repo create` themselves" are different things, and onboarding had
// collapsed them into one. The operator still decides — nothing reaches GitHub
// without an explicit `--execute` and an exact `--confirm` — but the deciding is
// done against a preview that names the exact repository, bytes, remote, branch,
// and labels, and the executing is done by a journaled transaction that
// reconciles rather than repeating.
//
// Preview is the default, matching `org publish` and `scheduler install`.

import { findExistingOrg, loadApps } from "../org/apps.js";
import { resolveCormidiaHomes, validateOrgHome } from "../org/home.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { executeRepositoryProvision, ProvisionRefusedError } from "../org/repo-provision-execute.js";
import type { ProvisionVerification } from "../org/repo-provision-verify.js";
import type { RepositoryProvisionTransaction } from "../org/repo-provision-journal.js";
import { preflightRepositoryProvision, type RepositoryProvisionPreflight } from "../org/repo-provision.js";
import { verifyRepositoryProvision } from "../org/repo-provision-verify.js";
import { emitProvisionReport } from "./provision-repo-report.js";
import type { NewAppTemplate } from "../org/new-app-paths.js";
import type { HomeFlags } from "./home-flags.js";
import { definedProps } from "../runtime/optional-properties.js";
import { join } from "node:path";

interface ProvisionArgs {
  execute: boolean;
  confirm?: string;
  json: boolean;
  sourceDir?: string;
  branch?: string;
  template?: NewAppTemplate;
}

export interface ProvisionCommandOptions {
  ghFactory?: (repo: string) => GhOps;
}

/** `cormidia app provision-repo <app>` — the greenfield app repository. */
export async function cmdAppProvisionRepo(
  appName: string,
  rest: string[],
  common: HomeFlags,
  options: ProvisionCommandOptions = {},
): Promise<number> {
  const parsed = parseArgs(rest, "app provision-repo");
  requireConfirmation(parsed, appName, "app provision-repo");

  const homes = await resolveHomes(common);
  const appsFile = await loadApps(join(homes.orgHome, "apps.yaml"));
  const entry = appsFile.apps.find((candidate) => candidate.name === appName);
  if (entry === undefined) {
    throw new Error(
      `app provision-repo: "${appName}" is not registered in ${join(homes.orgHome, "apps.yaml")} — ` +
        "run `cormidia new-app` or `cormidia bootstrap` for this app first",
    );
  }
  // The registry records identity, not a checkout path: guessing the source
  // would be guessing whose bytes get pushed into a brand-new repository.
  const sourceDir = parsed.sourceDir;
  if (sourceDir === undefined) {
    throw new Error(
      `app provision-repo: --source-dir <local-path> is required — it names the checkout whose ` +
        `bootstrap commit is pushed to ${entry.repo}, and it is never inferred`,
    );
  }

  return run({
    scope: "app",
    name: appName,
    repoSlug: entry.repo,
    root: sourceDir,
    ...definedProps({ template: parsed.template }),
    stateHome: homes.stateHome,
    errorPrefix: "app provision-repo",
    provisionCommand: `cormidia app provision-repo ${appName} --execute --confirm ${appName}`,
    verifyCommand: `cormidia app verify ${appName}`,
    commitMessage:
      `chore(cormidia): bootstrap ${appName}\n\n` +
      "The Cormidia-generated app scaffold and app-owned `.cormidia/` contract.\n" +
      "Review the charter, policy, and authority — these are human-ratified surfaces.\n",
    parsed,
    options,
  });
}

/** `cormidia org provision-repo` — the org home's own repository. */
export async function cmdOrgProvisionRepo(
  rest: string[],
  common: HomeFlags,
  options: ProvisionCommandOptions = {},
): Promise<number> {
  const parsed = parseArgs(rest, "org provision-repo");
  const homes = await resolveHomes(common);
  const orgName = homes.orgHome.split("/").filter(Boolean).at(-1) ?? "org";
  requireConfirmation(parsed, orgName, "org provision-repo");

  if (parsed.sourceDir !== undefined) {
    throw new Error(
      "org provision-repo: --source-dir is not accepted — the org home is the source, and pointing " +
        "provisioning at another directory is how the state home would end up in a commit",
    );
  }
  const repoSlug = requireOrgRepoSlug(rest);

  return run({
    scope: "org",
    name: orgName,
    repoSlug,
    // The ORG HOME, always. src/org/home.ts owns the org/state boundary and the
    // preflight re-checks every expanded path through classifyOrgHomeWrite, so
    // the state home can never enter this commit.
    root: homes.orgHome,
    stateHome: homes.stateHome,
    errorPrefix: "org provision-repo",
    provisionCommand: `cormidia org provision-repo --repo ${repoSlug} --execute --confirm ${orgName}`,
    verifyCommand: "cormidia context",
    commitMessage:
      "chore(cormidia): publish org configuration\n\n" +
      "The org's committed configuration surfaces. High-churn runtime state lives\n" +
      "in the state home and is deliberately absent.\n",
    parsed,
    options,
  });
}

interface RunInput {
  scope: "app" | "org";
  name: string;
  repoSlug: string;
  root: string;
  template?: NewAppTemplate;
  stateHome: string;
  errorPrefix: string;
  provisionCommand: string;
  verifyCommand: string;
  commitMessage: string;
  parsed: ProvisionArgs;
  options: ProvisionCommandOptions;
}

async function run(input: RunInput): Promise<number> {
  const gh = input.options.ghFactory?.(input.repoSlug) ?? ghForSlug(input.repoSlug);

  const preflight = await preflightRepositoryProvision({
    scope: input.scope,
    name: input.name,
    repoSlug: input.repoSlug,
    root: input.root,
    ...definedProps({ template: input.template }),
    ...definedProps({ pushBranch: input.parsed.branch }),
    errorPrefix: input.errorPrefix,
    ...(gh === undefined ? {} : { gh }),
  });

  if (!input.parsed.execute || preflight.blockers.length > 0) {
    report(input, preflight, null, null);
    return preflight.blockers.length > 0 ? 1 : 0;
  }

  let transaction: RepositoryProvisionTransaction;
  try {
    transaction = await executeRepositoryProvision({
      preflight,
      stateHome: input.stateHome,
      commitMessage: input.commitMessage,
      provisionCommand: input.provisionCommand,
      verifyCommand: input.verifyCommand,
      errorPrefix: input.errorPrefix,
      // Bind the reviewed content: if the target or the owned bytes moved
      // between the preview and this call, refuse rather than provision
      // something nobody looked at.
      expectedContentId: preflight.content_id,
      ...(gh === undefined ? {} : { gh }),
    });
  } catch (error) {
    if (error instanceof ProvisionRefusedError) {
      report(input, preflight, null, null, error);
      return 1;
    }
    throw error;
  }

  // Verify BEFORE reporting anything a readiness claim could rest on: reaching
  // `complete` is what this process believes, verification is what GitHub says.
  const verification =
    gh === undefined
      ? null
      : await verifyRepositoryProvision({
          slug: transaction.slug,
          root: transaction.root,
          branch: transaction.branch,
          expectedCommit: transaction.pushed_commit,
          expectedRemoteUrl: transaction.remote_url,
          remoteName: transaction.remote_name,
          gh,
          errorPrefix: input.errorPrefix,
        });

  report(input, preflight, transaction, verification);
  return verification !== null && !verification.ready ? 1 : 0;
}

/** Production `GhOps` for a slug, or undefined when the identity is not usable
 *  — `GhCliOps` refuses a placeholder at construction (#385), and a preview
 *  must still be able to REPORT that rather than crashing. */
function ghForSlug(repoSlug: string): GhOps | undefined {
  try {
    return new GhCliOps(repoSlug);
  } catch {
    return undefined;
  }
}

async function resolveHomes(common: HomeFlags): Promise<{ orgHome: string; stateHome: string }> {
  const existing = await findExistingOrg(common.orgHome === undefined ? {} : { orgHome: common.orgHome });
  if (existing === undefined) {
    throw new Error("provision-repo: no active org — initialize one with `cormidia org init <path> --name <name>`");
  }
  await validateOrgHome(existing);
  return resolveCormidiaHomes({ orgHome: existing, ...definedProps({ stateHome: common.stateHome }) });
}

/** The org home's target slug is explicit, never inferred. Inferring it from an
 *  existing remote would defeat the point (there is no remote yet), and
 *  inferring it from the directory name would create a repository whose name
 *  nobody chose. */
function requireOrgRepoSlug(rest: readonly string[]): string {
  const index = rest.indexOf("--repo");
  const value = index === -1 ? undefined : rest[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("org provision-repo: --repo <owner/repo> is required — the org repository name is never guessed");
  }
  return value;
}

function requireConfirmation(parsed: ProvisionArgs, expected: string, command: string): void {
  if (!parsed.execute) return;
  if (parsed.confirm !== expected) {
    throw new Error(
      `${command}: --execute requires --confirm ${expected}. Creating a repository is permanent and ` +
        "outward-facing; the confirmation is the deliberate step.",
    );
  }
}

function parseArgs(args: readonly string[], command: string): ProvisionArgs {
  const parsed: ProvisionArgs = { execute: false, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--dry-run") parsed.execute = false;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--confirm") parsed.confirm = value(args, ++i, "--confirm", command);
    else if (arg === "--source-dir") parsed.sourceDir = value(args, ++i, "--source-dir", command);
    else if (arg === "--branch") parsed.branch = value(args, ++i, "--branch", command);
    else if (arg === "--repo")
      i += 1; // consumed by requireOrgRepoSlug
    else if (arg === "--template") {
      const raw = value(args, ++i, "--template", command);
      if (raw !== "bare" && raw !== "typescript-node") {
        throw new Error(`${command}: --template must be bare or typescript-node`);
      }
      parsed.template = raw;
    } else throw new Error(`${command}: unknown flag "${arg}"`);
  }
  return parsed;
}

function value(args: readonly string[], index: number, flag: string, command: string): string {
  const found = args[index];
  if (found === undefined || found.startsWith("--")) throw new Error(`${command}: ${flag} requires a value`);
  return found;
}
/** Bind the command's context to the shared renderer. */
function report(
  input: RunInput,
  preflight: RepositoryProvisionPreflight,
  transaction: RepositoryProvisionTransaction | null,
  verification: ProvisionVerification | null,
  refusal?: ProvisionRefusedError,
): void {
  emitProvisionReport(
    {
      scope: input.scope,
      execute: input.parsed.execute,
      json: input.parsed.json,
      provisionCommand: input.provisionCommand,
    },
    preflight,
    transaction,
    verification,
    refusal,
  );
}
