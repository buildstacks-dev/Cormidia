// Reading the target repository during a provisioning preflight (#382).
//
// One question, asked without mutating anything: does this repository already
// exist, and if so what is it?
//
// The load-bearing rule is that "I could not look" is NEVER "it is not there".
// A preflight that reported `absent` from an expired token would send execution
// straight into creating a duplicate of a repository that already exists, so an
// unreadable remote is `unknown` AND a blocker.

import type { RepositoryIdentity } from "../runtime/repo-identity.js";
import { repositoryProvisionMarker } from "./repo-provision-marker.js";

/** What the remote already says, read without mutating it. `unknown` is a
 *  first-class answer: an auth failure must never be reported as "absent" on a
 *  path that decides whether to create something. */
export interface RepositoryProvisionRemote {
  state: "absent" | "present" | "unknown";
  visibility?: "PRIVATE" | "PUBLIC" | "INTERNAL";
  default_branch?: string | null;
  /** True when the existing repository carries THIS transaction's marker, i.e.
   *  a previous run created it and lost the response. */
  marker_matches?: boolean;
  detail?: string;
}

/** The narrowest GitHub surface a preflight needs: one read. Narrowed so a
 *  preview cannot quietly grow a mutation. */
export interface ProvisionReadOps {
  readRepository(): Promise<
    | { slug: string; visibility: "PRIVATE" | "PUBLIC" | "INTERNAL"; defaultBranch: string | null; description: string }
    | undefined
  >;
}

export async function readRemote(
  input: { errorPrefix: string; gh?: ProvisionReadOps },
  identity: RepositoryIdentity,
  idempotencyKey: string,
  blockers: string[],
): Promise<RepositoryProvisionRemote> {
  if (input.gh === undefined) return { state: "unknown", detail: "no GitHub reader supplied" };
  let view: Awaited<ReturnType<ProvisionReadOps["readRepository"]>>;
  try {
    view = await input.gh.readRepository();
  } catch (error) {
    // "I could not look" is never "it is not there". Report unknown and block:
    // creating from here could duplicate a repository that already exists.
    const detail = error instanceof Error ? error.message : String(error);
    blockers.push(
      `${input.errorPrefix}: could not read ${identity.slug} on GitHub, so whether it already exists is ` +
        `unknown and provisioning must not guess — ${detail}`,
    );
    return { state: "unknown", detail };
  }
  if (view === undefined) return { state: "absent" };

  const markerMatches = view.description.includes(repositoryProvisionMarker(idempotencyKey));
  if (view.visibility !== "PRIVATE") {
    blockers.push(
      `${input.errorPrefix}: ${identity.slug} already exists and is ${view.visibility}, not private — ` +
        "provisioning never changes an existing repository's visibility; inspect it, and either make it " +
        "private yourself or choose a different target",
    );
  }
  return {
    state: "present",
    visibility: view.visibility,
    default_branch: view.defaultBranch,
    marker_matches: markerMatches,
  };
}
