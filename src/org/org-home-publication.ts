// Committed org-home configuration ↔ its Git remote (#388).
//
// The org home is defined as COMMITTED organization configuration. Before this
// module, every command that mutated it decided for itself what "done" meant,
// so `cormidia new-app` could report `app-created-and-registered` while
// `origin/main` still carried `apps: {}`: a second host, a fresh clone, or a
// recovery from the remote silently lost the app.
//
// This is the org-home face of the shared publication primitive. It resolves a
// surface's declared owned paths, runs one preflight, and publishes through a
// dedicated branch and a draft pull request — never a direct default-branch
// push (F-PT-013 leaves that enforcement locus open, and every surface here is
// human-ratified or governed). Consumers get `orgHomeDivergence`, so a dirty
// checkout is never silently treated as universally authoritative.

import { resolve } from "node:path";
import { executeGitPublication, type PublicationGhOps } from "./git-publication-execute.js";
import {
  COMMITTED_ORG_SURFACES,
  committedOrgSurface,
  type CommittedOrgSurface,
  type CommittedOrgSurfaceId,
} from "./committed-org-surfaces.js";
import type { GitPublicationExecuteInput } from "./git-publication-execute.js";
import {
  listPublicationTransactions,
  publicationNextAction,
  type PublicationDurability,
  type PublicationTransaction,
} from "./git-publication-journal.js";
import { publicationGitLines, publicationGitOptional } from "./git-publication-substrate.js";
import { preflightGitPublication, type GitPublicationPreflight } from "./git-publication.js";

const ERROR_PREFIX = "org publish";

/** The dedicated branch a surface publishes on. One branch per surface so two
 *  surfaces never contend, and never a default branch. */
export function orgHomePublicationBranch(surface: CommittedOrgSurfaceId): string {
  return `op/cormidia-org-${surface}`;
}

export interface OrgHomePublicationPlan {
  surface: CommittedOrgSurfaceId;
  summary: string;
  preflight: GitPublicationPreflight;
  /** What a command may honestly claim if it stops here. */
  durability: PublicationDurability;
  next_action: string;
  publish_command: string;
}

export interface PlanOrgHomePublicationInput {
  orgHome: string;
  surface: CommittedOrgSurfaceId;
  /** Narrow the surface to exactly the paths this command touched. Omitted
   *  means the surface's whole declaration — the reconcile case. */
  ownedPaths?: readonly string[];
}

export async function planOrgHomePublication(input: PlanOrgHomePublicationInput): Promise<OrgHomePublicationPlan> {
  const orgHome = resolve(input.orgHome);
  const surface = committedOrgSurface(input.surface);
  const branch = orgHomePublicationBranch(surface.id);
  const publishCommand = `cormidia org publish --surface ${surface.id} --execute`;
  const declared = narrowedDeclaration(surface, input.ownedPaths);
  const preflight = preflightGitPublication({
    root: orgHome,
    branch,
    ownedPaths: declared,
    errorPrefix: ERROR_PREFIX,
    scope: `org:${surface.id}`,
  });
  const durability = plannedDurability(preflight);
  return {
    surface: surface.id,
    summary: surface.summary,
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

export interface ExecuteOrgHomePublicationInput extends PlanOrgHomePublicationInput {
  stateHome: string;
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  expectedContentId?: string;
  gh?: PublicationGhOps;
  now?: Date;
}

export async function executeOrgHomePublication(
  input: ExecuteOrgHomePublicationInput,
): Promise<{ plan: OrgHomePublicationPlan; transaction: PublicationTransaction | null }> {
  const plan = await planOrgHomePublication(input);
  if (plan.preflight.mode !== "publishable" || plan.preflight.blockers.length > 0) {
    return { plan, transaction: null };
  }
  const executeInput: GitPublicationExecuteInput = {
    preflight: plan.preflight,
    stateHome: resolve(input.stateHome),
    scope: "org",
    surface: plan.surface,
    commitMessage: input.commitMessage,
    publishCommand: plan.publish_command,
    errorPrefix: ERROR_PREFIX,
    ...(plan.preflight.identity.github_slug === null
      ? {}
      : { pullRequest: { title: input.pullRequestTitle, body: input.pullRequestBody } }),
    ...(input.expectedContentId === undefined ? {} : { expectedContentId: input.expectedContentId }),
    ...(input.gh === undefined ? {} : { gh: input.gh }),
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  const transaction = await executeGitPublication(executeInput);
  return { plan: { ...plan, durability: transaction.durability, next_action: transaction.next_action }, transaction };
}

export interface OrgHomeDivergence {
  /** `unknown` is a real answer and never renders as agreement: an org home
   *  with no fetched remote ref cannot prove its configuration is recoverable
   *  (INV-008 — never green by absence). */
  state: "not_a_repository" | "local_only" | "unknown" | "converged" | "diverged";
  org_home: string;
  default_branch: string | null;
  detail: string;
  surfaces: Array<{ surface: CommittedOrgSurfaceId; paths: string[] }>;
}

/** Does this org home's committed configuration match its remote?
 *
 *  Deliberately offline: it reads the already-fetched remote-tracking ref
 *  rather than contacting the remote, so `context`, `doctor`, and dispatch can
 *  call it on every invocation. It resolves the branch name from git metadata
 *  (`refs/remotes/origin/HEAD`), never from a hardcoded `main`, and reports
 *  `unknown` when that metadata is absent. */
export function orgHomeDivergence(orgHomeIn: string): OrgHomeDivergence {
  const orgHome = resolve(orgHomeIn);
  const base = { org_home: orgHome, default_branch: null, surfaces: [] };
  if (publicationGitOptional(orgHome, ["rev-parse", "--git-dir"]) === undefined) {
    return { ...base, state: "not_a_repository", detail: "org home is not a git checkout" };
  }
  if (publicationGitOptional(orgHome, ["remote", "get-url", "origin"]) === undefined) {
    return { ...base, state: "local_only", detail: "org home has no configured remote (local-only org)" };
  }
  const ref = resolvedRemoteRef(orgHome);
  if (ref === undefined) {
    return {
      ...base,
      state: "unknown",
      detail:
        "org home has a remote but no fetched default-branch ref — run `git fetch origin` or " +
        "`cormidia org publish` to establish it; divergence cannot be proven either way",
    };
  }
  const defaultBranch = ref.slice("origin/".length);
  if (publicationGitOptional(orgHome, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === undefined) {
    return { ...base, state: "unknown", default_branch: defaultBranch, detail: `${ref} is not present locally` };
  }
  const surfaces = COMMITTED_ORG_SURFACES.map((surface) => ({
    surface: surface.id,
    paths: pendingSurfacePaths(orgHome, surface, ref),
  })).filter((entry) => entry.paths.length > 0);
  if (surfaces.length === 0) {
    return {
      ...base,
      state: "converged",
      default_branch: defaultBranch,
      detail: `committed org configuration matches ${ref}`,
    };
  }
  const count = surfaces.reduce((total, entry) => total + entry.paths.length, 0);
  return {
    org_home: orgHome,
    state: "diverged",
    default_branch: defaultBranch,
    surfaces,
    detail:
      `${count} committed org configuration path(s) differ from ${ref} — this checkout is not ` +
      "recoverable from the remote; publish them with `cormidia org publish`",
  };
}

export interface CommittedSurfaceStatus {
  surface: CommittedOrgSurfaceId;
  /** What the command that just wrote this surface may honestly claim.
   *  `unknown` is a real answer: an org home with a remote but no fetched
   *  default-branch ref cannot prove either way, and silence would read as
   *  agreement (INV-008 — never green by absence). */
  state: PublicationDurability | "unknown";
  /** The surface's own paths that differ from the fetched remote ref. */
  paths: string[];
  detail: string;
  next_action: string;
}

/** The honest state of ONE committed surface right after a command wrote it.
 *
 *  Offline by construction so every mutating command can call it without a
 *  network round-trip: it reads the fetched remote-tracking ref and, when a
 *  state home is supplied, the publication journal. `cormidia org publish` is
 *  what actually contacts the remote. */
export async function committedSurfaceStatus(
  orgHomeIn: string,
  surface: CommittedOrgSurfaceId,
  stateHome?: string,
): Promise<CommittedSurfaceStatus> {
  const orgHome = resolve(orgHomeIn);
  const branch = orgHomePublicationBranch(surface);
  const publishCommand = `cormidia org publish --surface ${surface} --execute`;
  const divergence = orgHomeDivergence(orgHome);
  const paths = divergence.surfaces.find((entry) => entry.surface === surface)?.paths ?? [];
  const finish = (state: PublicationDurability | "unknown", detail: string, url?: string | null) => ({
    surface,
    state,
    paths,
    detail,
    next_action:
      state === "unknown"
        ? "run `git fetch origin` in the org home (or `cormidia org publish`) to establish whether this reached the remote"
        : publicationNextAction(state, {
            branch,
            defaultBranch: divergence.default_branch ?? "the remote default branch",
            publishCommand,
            ...(url === undefined ? {} : { pullRequestUrl: url }),
          }),
  });
  if (divergence.state === "not_a_repository" || divergence.state === "local_only") {
    return finish("local_only", divergence.detail);
  }
  if (divergence.state === "unknown") return finish("unknown", divergence.detail);
  if (paths.length === 0) {
    return finish("reachable_at_remote", `${surface} matches origin/${divergence.default_branch ?? "HEAD"}`);
  }
  if (stateHome !== undefined) {
    const inFlight = (await listPublicationTransactions(resolve(stateHome), "org", surface)).find(
      (transaction) => transaction.pushed_commit !== null,
    );
    if (inFlight !== undefined) {
      return finish(
        "pending_merge",
        `${surface} is published on ${inFlight.branch} and awaiting human merge`,
        inFlight.pull_request?.url ?? null,
      );
    }
  }
  return finish("recorded_locally", `${surface} differs from the remote in ${paths.length} path(s)`);
}

/** Narrow a surface's declaration to the paths a command actually touched.
 *
 *  Narrowing only ever removes: a caller-supplied path outside the surface's
 *  declaration is dropped rather than published, because a command cannot
 *  widen its own owned set by asking. */
function narrowedDeclaration(surface: CommittedOrgSurface, ownedPaths?: readonly string[]): readonly string[] {
  if (ownedPaths === undefined) return surface.paths;
  const narrowed = ownedPaths.filter((path) => surfaceOwns(surface, path));
  return narrowed.length > 0 ? narrowed : surface.paths;
}

function plannedDurability(preflight: GitPublicationPreflight): PublicationDurability {
  if (preflight.mode !== "publishable") return "local_only";
  if (preflight.reachable_at_base) return "reachable_at_remote";
  return "recorded_locally";
}

/** The surface's owned paths that differ from the reference, bounded by the
 *  declaration at every step. */
function pendingSurfacePaths(orgHome: string, surface: CommittedOrgSurface, ref: string): string[] {
  const pathspecs = surface.paths.map((path) => (path.endsWith("/") ? path.slice(0, -1) : path));
  const changed = publicationGitLines(orgHome, ["diff", "--name-only", ref, "--", ...pathspecs], ERROR_PREFIX);
  const untracked = publicationGitLines(
    orgHome,
    ["ls-files", "--others", "--exclude-standard", "--", ...pathspecs],
    ERROR_PREFIX,
  );
  return [...new Set([...changed, ...untracked])].filter((path) => surfaceOwns(surface, path)).sort();
}

function surfaceOwns(surface: CommittedOrgSurface, path: string): boolean {
  return surface.paths.some((owned) => (owned.endsWith("/") ? path.startsWith(owned) : path === owned));
}

function resolvedRemoteRef(orgHome: string): string | undefined {
  const head = publicationGitOptional(orgHome, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const branch = head?.replace(/^refs\/remotes\/origin\//, "");
  if (branch === undefined || branch === "") return undefined;
  return `origin/${branch}`;
}
