// Preflight for governed repository provisioning (#382).
//
// Pure inspection plus ONE read-only GitHub lookup. Nothing here creates,
// pushes, or labels: it answers "which repository would be created, from what
// local bytes, under what remote and branch, with which labels, and what would
// stop it" so that the preview an operator reviews and the transaction that
// executes decide from exactly the same facts.
//
// Three rules this module exists to enforce, in order of importance:
//
//  1. **Identity is settled before the network.** An unresolved or placeholder
//     slug is refused before any GitHub call — `classifyRepositoryIdentity` is
//     the one decision (#385), never re-derived here. Provisioning a repository
//     literally named YOUR_APP_REPOSITORY is the worst version of that bug,
//     because unlike a bad `gh issue comment` it is not recoverable by
//     retrying against the right target: the wrong repository now exists.
//
//  2. **The owned set is DECLARED, never discovered.** Callers pass exact file
//     paths and `dir/` prefixes; a prefix expands to its real files bounded by
//     the declaration at every step. "What happens to be in the directory" is
//     never the answer — that is how unrelated operator work ends up in an
//     onboarding commit (the `bootstrap publish` rule, generalized).
//
//  3. **The org home's state home is never publishable.** For the org scope
//     every expanded path is re-checked through `classifyOrgHomeWrite`, so a
//     runtime-state path cannot enter a commit even if a declaration grew wrong.
//     That guard is mechanical and doubled on purpose (src/org/home.ts owns the
//     boundary; this module refuses to restate it as a second list).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_LABELS } from "../loop/plan-tickets.js";
import {
  classifyRepositoryIdentity,
  isRepositoryIdentity,
  type RepositoryIdentity,
  type RepositoryIdentityRejection,
} from "../runtime/repo-identity.js";
import { COMMITTED_ORG_SURFACES } from "./committed-org-surfaces.js";
import { sha256Hex } from "./git-publication-substrate.js";
import {
  expandDeclaration,
  readLocalOrigin,
  remoteUrlNamesSlug,
  type RepositoryProvisionOwnedPath,
  type RepositoryProvisionScope,
} from "./repo-provision-scope.js";
import { NEW_APP_SCAFFOLD_PATHS, type NewAppTemplate } from "./new-app-paths.js";
import { readRemote, type ProvisionReadOps, type RepositoryProvisionRemote } from "./repo-provision-remote.js";

export { repositoryProvisionMarker } from "./repo-provision-marker.js";
export type { ProvisionReadOps, RepositoryProvisionRemote } from "./repo-provision-remote.js";

export type { RepositoryProvisionOwnedPath, RepositoryProvisionScope } from "./repo-provision-scope.js";

/** Total bytes a provisioning commit may carry. A bootstrap commit is
 *  documents and scaffold; anything at this scale is a build output, a vendored
 *  dependency tree, or a mistake, and pushing it into a brand-new repository is
 *  not recoverable by deleting a file afterwards. The preflight names the
 *  largest offenders rather than reporting a bare total. */
export const PROVISION_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export interface RepositoryProvisionPreflight {
  schema_version: 1;
  kind: "repository-provision-preflight";
  scope: RepositoryProvisionScope;
  /** Journal namespace — `org`, or `app-<name>`. */
  journal_scope: string;
  /** Validated target, or null when identity classification refused it. */
  target: RepositoryIdentity | null;
  identity_rejection: RepositoryIdentityRejection | null;
  /** #382 provisions private repositories only. Making one public is a
   *  separate human decision the gate classifies `repo-provisioning`. */
  visibility: "private";
  source_root: string;
  remote_name: string;
  /** The exact URL the push would go to. Derived from the slug in production;
   *  surfaced in the preview because "which remote" is one of the facts an
   *  operator is being asked to approve, not an implementation detail. */
  remote_url: string;
  /** The branch the bootstrap commit lands on and the push targets. */
  push_branch: string;
  declared_paths: string[];
  owned_paths: RepositoryProvisionOwnedPath[];
  total_bytes: number;
  labels: Array<{ name: string; color: string; description: string }>;
  /** Content identity of exactly this outward action. Two runs with the same
   *  answer are the same transaction; a changed target, branch, or byte is a
   *  different one. */
  content_id: string;
  /** Stable marker written into the repository description so a lost create
   *  response reconciles to the repository it actually made. */
  idempotency_key: string;
  remote: RepositoryProvisionRemote;
  /** The `origin` URL already configured in the source root, when any. */
  local_origin_url: string | null;
  /** Complete, actionable sentences. Non-empty means do not execute. */
  blockers: string[];
}

export interface PreflightRepositoryProvisionInput {
  scope: RepositoryProvisionScope;
  /** App name for the app scope; the org name for the org scope. Used for the
   *  journal namespace and the marker, never as a target. */
  name: string;
  /** The declared repository target, exactly as configured. */
  repoSlug: unknown;
  /** Local checkout whose bytes would be committed. */
  root: string;
  /** Greenfield template, for the app scope's declared scaffold paths. */
  template?: NewAppTemplate;
  /** Overrides the derived declaration. Used by tests and by callers that own
   *  a narrower set; always exact paths and `dir/` prefixes, never globs. */
  declaredPaths?: readonly string[];
  remoteName?: string;
  /** Overrides the derived `https://github.com/<slug>.git`. Hermetic tests
   *  point this at a local bare repository so a real push is exercised without
   *  a network; production never sets it. */
  remoteUrl?: string;
  pushBranch?: string;
  errorPrefix: string;
  /** Omitted ⇒ the remote is reported `unknown` and no GitHub call is made. */
  gh?: ProvisionReadOps;
}

/** Files and `dir/` prefixes a provisioning commit owns, per scope.
 *
 *  The org scope's declaration IS the committed-surface inventory, so a new
 *  committed writer is covered by registering itself there and nowhere else.
 *  The app scope's is the greenfield scaffold plus the app-owned `.cormidia/`
 *  contract and the instruction docs bootstrap composes into. */
export function provisionDeclaredPaths(
  scope: RepositoryProvisionScope,
  template: NewAppTemplate = "bare",
): readonly string[] {
  if (scope === "org") return [...new Set(COMMITTED_ORG_SURFACES.flatMap((surface) => surface.paths))].sort();
  return [...new Set([".cormidia/", "docs/", "AGENTS.md", "CLAUDE.md", ...NEW_APP_SCAFFOLD_PATHS[template]])].sort();
}

export async function preflightRepositoryProvision(
  input: PreflightRepositoryProvisionInput,
): Promise<RepositoryProvisionPreflight> {
  const root = resolve(input.root);
  const scope = input.scope;
  const journalScope = scope === "org" ? "org" : `app-${input.name}`;
  const remoteName = input.remoteName ?? "origin";
  const pushBranch = input.pushBranch ?? "main";
  const declared = [...new Set(input.declaredPaths ?? provisionDeclaredPaths(scope, input.template))].sort();
  const blockers: string[] = [];

  // Identity FIRST, before every other check and before any network call.
  const identity = classifyRepositoryIdentity(input.repoSlug);
  if (!isRepositoryIdentity(identity)) {
    blockers.push(
      `${input.errorPrefix}: ${identity.detail} — ${identity.remediation}. ` +
        "No repository was created and no GitHub call was made.",
    );
    return {
      ...emptyPreflight(input, root, journalScope, remoteName, pushBranch, declared),
      target: null,
      identity_rejection: identity,
      blockers,
    };
  }

  if (!existsSync(root)) {
    blockers.push(`${input.errorPrefix}: ${root} does not exist — nothing to provision from`);
  }

  const owned = existsSync(root) ? expandDeclaration(root, declared, scope, blockers, input.errorPrefix) : [];
  const totalBytes = owned.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes > PROVISION_MAX_TOTAL_BYTES) {
    const largest = [...owned]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 5)
      .map((entry) => `${entry.path} (${entry.bytes} bytes)`);
    blockers.push(
      `${input.errorPrefix}: the declared bootstrap scope is ${totalBytes} bytes, over the ` +
        `${PROVISION_MAX_TOTAL_BYTES}-byte bound — largest: ${largest.join(", ")}. ` +
        "Exclude build output or vendored dependencies before provisioning.",
    );
  }
  if (owned.length === 0 && blockers.length === 0) {
    blockers.push(
      `${input.errorPrefix}: none of the declared bootstrap paths exist under ${root} — ` +
        "there is nothing to commit, so provisioning would create an empty repository",
    );
  }

  const idempotencyKey = provisionIdempotencyKey(journalScope, identity.slug, pushBranch);
  const contentId = sha256Hex(
    [
      "repository-provision/v1",
      scope,
      journalScope,
      identity.slug,
      "private",
      remoteName,
      pushBranch,
      ...owned.map((entry) => `${entry.path}:${entry.sha256}`),
    ].join(" "),
  );

  const remoteUrl = input.remoteUrl ?? `https://github.com/${identity.slug}.git`;
  const localOriginUrl = readLocalOrigin(root, remoteName);
  // An already-wired remote is fine when it is the one this provisioning would
  // wire — compared EXACTLY against the resolved push URL first, and by
  // owner/repo tail second so SSH, HTTPS, and `.git`-suffixed spellings of the
  // same repository all agree. Anything else is a push aimed somewhere nobody
  // reviewed, which is a refusal rather than something to correct silently.
  if (localOriginUrl !== null && localOriginUrl !== remoteUrl && !remoteUrlNamesSlug(localOriginUrl, identity.slug)) {
    blockers.push(
      `${input.errorPrefix}: ${root} already has a "${remoteName}" remote pointing at ${localOriginUrl}, ` +
        `which is not ${identity.slug} — re-point or remove it before provisioning, ` +
        "so the push cannot land in a repository nobody reviewed",
    );
  }

  const remote = await readRemote(input, identity, idempotencyKey, blockers);

  return {
    schema_version: 1,
    kind: "repository-provision-preflight",
    scope,
    journal_scope: journalScope,
    target: identity,
    identity_rejection: null,
    visibility: "private",
    source_root: root,
    remote_name: remoteName,
    remote_url: remoteUrl,
    push_branch: pushBranch,
    declared_paths: declared,
    owned_paths: owned,
    total_bytes: totalBytes,
    labels: CANONICAL_LABELS.map((label) => ({
      name: label.name,
      color: label.color,
      description: label.description,
    })),
    content_id: contentId,
    idempotency_key: idempotencyKey,
    remote,
    local_origin_url: localOriginUrl,
    blockers,
  };
}

/** Stable across runs for the same target, so a lost create response is
 *  recoverable: the marker the next run looks for is the one the lost call
 *  wrote. Deliberately NOT the content id — the bytes may legitimately change
 *  between a failed attempt and its retry, while the repository being created
 *  is the same one. */
function provisionIdempotencyKey(journalScope: string, slug: string, branch: string): string {
  return `provision-${sha256Hex(`${journalScope} ${slug} ${branch}`).slice(0, 32)}`;
}

function emptyPreflight(
  input: PreflightRepositoryProvisionInput,
  root: string,
  journalScope: string,
  remoteName: string,
  pushBranch: string,
  declared: string[],
): RepositoryProvisionPreflight {
  return {
    schema_version: 1,
    kind: "repository-provision-preflight",
    scope: input.scope,
    journal_scope: journalScope,
    target: null,
    identity_rejection: null,
    visibility: "private",
    source_root: root,
    remote_name: remoteName,
    remote_url: "",
    push_branch: pushBranch,
    declared_paths: declared,
    owned_paths: [],
    total_bytes: 0,
    labels: [],
    content_id: "",
    idempotency_key: "",
    remote: { state: "unknown", detail: "identity refused before any GitHub call" },
    local_origin_url: null,
    blockers: [],
  };
}
