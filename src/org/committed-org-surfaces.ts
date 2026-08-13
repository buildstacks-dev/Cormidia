// The inventory of committed org-home configuration (#388).
//
// `ORG_HOME_DEFINITION` says the org home is "committed organization
// configuration". Until this module existed that sentence was prose: each
// command wrote its own file and decided for itself what "done" meant, so
// `new-app` could report `app-created-and-registered` while `origin/main`
// still carried `apps: {}`. One working tree is not org truth.
//
// This registry is the classification half of the fix. Every path a Cormidia
// command writes inside an org home is either COMMITTED configuration (it must
// reach the remote through a governed publication before any command may claim
// it durable) or high-churn STATE (it lives in the state home and never enters
// git). A path that is neither is a bug: `classifyOrgHomeWrite` returns
// `unclassified`, and the architectural guard turns that into a failing test
// rather than a silent third category.
//
// Adding a committed writer means adding its surface here. That is the point.

/** Stable ids for the committed org-home surfaces Cormidia mutates. */
export type CommittedOrgSurfaceId =
  | "app-registry"
  | "role-assignments"
  | "org-authority"
  | "org-schema-surfaces"
  | "governed-learning"
  | "curated-memory"
  | "org-retro";

/** How a surface's changes are allowed to reach the remote.
 *
 *  There is deliberately ONE policy today. A direct push to a remote default
 *  branch is unratified territory (F-PT-013: the enforcement locus is an open
 *  finding), and every surface here is human-ratified or governed, so a
 *  dedicated branch plus a draft pull request is the only route this module
 *  offers. Widening it is a human decision, not a convenience. */
export type OrgPublicationPolicy = "reviewed-branch";

export interface CommittedOrgSurface {
  readonly id: CommittedOrgSurfaceId;
  /** Repo-relative paths this surface owns. A trailing `/` marks a directory
   *  prefix; anything else is an exact file path. Never a glob — the owned set
   *  a publication stages must be enumerable and exact. */
  readonly paths: readonly string[];
  /** Commands authorized to write the surface, as an operator would type them.
   *  Mirrors system-map §2.2's "authorized write paths" column. */
  readonly writers: readonly string[];
  readonly policy: OrgPublicationPolicy;
  readonly summary: string;
}

export const COMMITTED_ORG_SURFACES: readonly CommittedOrgSurface[] = [
  {
    id: "app-registry",
    paths: ["apps.yaml"],
    writers: [
      "cormidia new-app",
      "cormidia bootstrap",
      "cormidia app promote --execute",
      "cormidia app reset --execute",
    ],
    policy: "reviewed-branch",
    summary: "app registry: registration, lifecycle status, and removal",
  },
  {
    id: "role-assignments",
    paths: ["roles.yaml"],
    writers: ["cormidia roles set --execute"],
    policy: "reviewed-branch",
    summary: "role runtime/model/effort/budget assignments",
  },
  {
    id: "org-authority",
    paths: ["AUTHORITY.md"],
    writers: ["cormidia org init", "cormidia org upgrade --execute"],
    policy: "reviewed-branch",
    summary: "the org's delegated-authority charter",
  },
  {
    id: "org-schema-surfaces",
    paths: ["TASTE.md", "pipelines.yaml", "prompts/", "taste/"],
    writers: ["cormidia org init", "cormidia org upgrade --execute"],
    policy: "reviewed-branch",
    summary: "packaged ratified surfaces added by org schema migration",
  },
  {
    id: "governed-learning",
    paths: ["learning/"],
    writers: ["cormidia learn publish (deterministic publisher)"],
    policy: "reviewed-branch",
    summary: "governed learning substrate: concepts, manifests, interventions, reviews",
  },
  {
    id: "curated-memory",
    paths: ["memory/"],
    writers: ["denial-lesson append (turn gate denial)"],
    policy: "reviewed-branch",
    summary: "curated per-role memory, including denial lessons",
  },
  {
    id: "org-retro",
    paths: ["retro/"],
    writers: ["cormidia retro"],
    policy: "reviewed-branch",
    summary: "written org retros",
  },
];

/** Paths inside an org home that are deliberately NOT committed configuration.
 *
 *  An org home is normally not also a state home, but the two can be pointed
 *  at the same directory, and `org init` writes neither of these. They are
 *  listed so the guard can tell "runtime state that happens to sit here" from
 *  "a committed writer nobody classified". */
const ORG_HOME_STATE_PREFIXES: readonly string[] = [
  ".git/",
  "runs/",
  "telemetry/",
  "locks/",
  "approvals/",
  "state/",
  "worktrees/",
  "repos/",
  "invocations/",
  "lifecycle/",
  "scheduler/",
  "planning/",
  "tickets/",
  "tasks/",
  "jobs/",
];

export type OrgHomeWriteClass =
  | { readonly kind: "committed"; readonly surface: CommittedOrgSurface }
  | { readonly kind: "state"; readonly prefix: string }
  | { readonly kind: "unclassified" };

/** Which class an org-home-relative write path falls into.
 *
 *  Fails open to `unclassified` on purpose: a new committed writer that forgot
 *  to register itself must be visible, and the architectural guard is what
 *  makes it visible. Never widen this to a catch-all. */
export function classifyOrgHomeWrite(relativePath: string): OrgHomeWriteClass {
  const path = normalizeRelative(relativePath);
  if (path === "") return { kind: "unclassified" };
  for (const surface of COMMITTED_ORG_SURFACES) {
    if (surface.paths.some((owned) => pathMatchesOwned(path, owned))) return { kind: "committed", surface };
  }
  for (const prefix of ORG_HOME_STATE_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return { kind: "state", prefix };
  }
  return { kind: "unclassified" };
}

export function committedOrgSurface(id: CommittedOrgSurfaceId): CommittedOrgSurface {
  const surface = COMMITTED_ORG_SURFACES.find((candidate) => candidate.id === id);
  if (surface === undefined) throw new Error(`org publication: unknown committed org surface "${id}"`);
  return surface;
}

/** Does this path sit under one of the surface's owned paths?
 *
 *  A directory prefix matches the directory itself and everything under it; an
 *  exact file path matches only itself. `../` can never match: the caller
 *  normalizes first and a traversal segment leaves the path unmatched, so an
 *  escape attempt lands in `unclassified` rather than inheriting a surface. */
function pathMatchesOwned(path: string, owned: string): boolean {
  if (owned.endsWith("/")) return path === owned.slice(0, -1) || path.startsWith(owned);
  return path === owned;
}

function normalizeRelative(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (path.startsWith("/") || path.split("/").includes("..")) return "";
  return path;
}
