// Product-document disposition ↔ the app repository's Git remote (#389).
//
// `cormidia app product-docs --execute` wrote the decision into the operator's
// checkout at `.cormidia/bootstrap/product-docs.json` and reported `recorded`.
// Live planning does not read arbitrary human working-tree state — it
// synchronizes Cormidia's managed checkout from the app remote — so the read
// side still saw `disposition: null` and refused, telling the operator to run
// the command they had just run.
//
// The decision is an app-repository transaction, so it publishes through the
// same primitive #388 established for the org home: declared owned paths only,
// a dedicated branch cut from the resolved remote default branch, a push, and a
// draft pull request a human merges. `remove` binds the manifest update and the
// byte-exact placeholders it deletes into one commit, so a merged decision can
// never describe documents the same revision still contains.

import { resolve } from "node:path";
import { executeGitPublication, type PublicationGhOps } from "./git-publication-execute.js";
import {
  publicationNextAction,
  type PublicationDurability,
  type PublicationTransaction,
} from "./git-publication-journal.js";
import { preflightGitPublication, type GitPublicationPreflight } from "./git-publication.js";
import { PRODUCT_DOC_RECORD_PATH } from "./product-doc-record.js";

const ERROR_PREFIX = "app product-docs";

/** The surface id this publication records in its journal. One id, so the
 *  planning side can find an in-flight decision without guessing. */
export const PRODUCT_DOC_PUBLICATION_SURFACE = "product-doc-disposition";

/** The journal namespace for one app's repository publications. */
export function productDocPublicationScope(app: string): string {
  return `app-${app}`;
}

/** The dedicated branch a disposition publishes on — never a default branch. */
export function productDocPublicationBranch(app: string): string {
  return `op/cormidia-product-docs-${app}`;
}

/** The resume command an operator runs to finish an already-recorded decision.
 *  Deliberately NOT the disposition command: an operator who just recorded a
 *  decision must never be told to record it again. */
export function productDocPublishCommand(app: string, workdir: string): string {
  return `cormidia app product-docs ${app} --workdir ${workdir} --publish --execute --confirm ${app}:publish`;
}

export interface ProductDocPublicationPlan {
  app: string;
  preflight: GitPublicationPreflight;
  /** What the command may honestly claim if it stops here. */
  durability: PublicationDurability;
  next_action: string;
  publish_command: string;
}

export interface PlanProductDocPublicationInput {
  /** The operator's app checkout — where the disposition was written. */
  workdir: string;
  app: string;
  /** Scaffold placeholders `remove` deletes, repo-relative. Empty otherwise. */
  removePaths?: readonly string[];
}

export async function planProductDocPublication(
  input: PlanProductDocPublicationInput,
): Promise<ProductDocPublicationPlan> {
  const workdir = resolve(input.workdir);
  const branch = productDocPublicationBranch(input.app);
  const publishCommand = productDocPublishCommand(input.app, workdir);
  // The owned set is the manifest plus exactly the placeholders this
  // disposition authorizes removing. Nothing else in the app repo is ever
  // Cormidia's to commit here.
  const preflight = preflightGitPublication({
    root: workdir,
    branch,
    ownedPaths: [PRODUCT_DOC_RECORD_PATH, ...(input.removePaths ?? [])],
    errorPrefix: ERROR_PREFIX,
    scope: `${PRODUCT_DOC_PUBLICATION_SURFACE}:${input.app}`,
  });
  const durability: PublicationDurability =
    preflight.mode !== "publishable"
      ? "local_only"
      : preflight.reachable_at_base
        ? "reachable_at_remote"
        : "recorded_locally";
  return {
    app: input.app,
    preflight,
    durability,
    next_action: publicationNextAction(durability, {
      branch,
      defaultBranch: preflight.base?.default_branch ?? "the remote default branch",
      publishCommand,
    }),
    publish_command: publishCommand,
  };
}

export interface ExecuteProductDocPublicationInput extends PlanProductDocPublicationInput {
  stateHome: string;
  repository: string;
  disposition: string;
  expectedContentId?: string;
  gh?: PublicationGhOps;
  now?: Date;
}

export async function executeProductDocPublication(
  input: ExecuteProductDocPublicationInput,
): Promise<{ plan: ProductDocPublicationPlan; transaction: PublicationTransaction | null }> {
  const plan = await planProductDocPublication(input);
  if (plan.preflight.mode !== "publishable" || plan.preflight.blockers.length > 0) {
    return { plan, transaction: null };
  }
  const transaction = await executeGitPublication({
    preflight: plan.preflight,
    stateHome: resolve(input.stateHome),
    scope: productDocPublicationScope(input.app),
    surface: PRODUCT_DOC_PUBLICATION_SURFACE,
    commitMessage: commitMessage(input),
    publishCommand: plan.publish_command,
    errorPrefix: ERROR_PREFIX,
    ...(plan.preflight.identity.github_slug === null
      ? {}
      : {
          pullRequest: { title: `chore(cormidia): product documents ${input.disposition}`, body: prBody(input, plan) },
        }),
    ...(input.expectedContentId === undefined ? {} : { expectedContentId: input.expectedContentId }),
    ...(input.gh === undefined ? {} : { gh: input.gh }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return { plan: { ...plan, durability: transaction.durability, next_action: transaction.next_action }, transaction };
}

function commitMessage(input: ExecuteProductDocPublicationInput): string {
  const removals = (input.removePaths ?? []).map((path) => `  removes ${path}`).join("\n");
  return (
    `chore(cormidia): record product-document disposition ${input.disposition}\n\n` +
    `Binds the ${input.disposition} decision to the exact scaffold document bytes it\n` +
    `was reviewed against, so automated planning reads one repository view.\n` +
    (removals === "" ? "" : `\n${removals}\n`)
  );
}

function prBody(input: ExecuteProductDocPublicationInput, plan: ProductDocPublicationPlan): string {
  return [
    "## What",
    "",
    `Records the \`${input.disposition}\` product-document disposition for \`${input.app}\` (${input.repository}).`,
    "",
    "## Owned paths",
    "",
    ...plan.preflight.changed_paths.map((path) => `- \`${path}\``),
    "",
    "## Review notes",
    "",
    "- The manifest binds the decision to the exact document bytes it was reviewed",
    "  against. Automated planning refuses if those bytes change afterwards.",
    input.disposition === "remove"
      ? "- The placeholder deletions and the manifest update land together, so no revision describes documents it still contains."
      : "- Only the manifest changes; the documents themselves are untouched.",
    "",
    "Opened as a draft by `cormidia app product-docs`. Cormidia does not merge this.",
  ].join("\n");
}
