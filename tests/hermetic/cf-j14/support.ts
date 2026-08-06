// hermetic/cf-j14 support — the app-reset world and the SIBLING-DIFF ORACLE
// (HB-015: CF-J14-*, CF-INV-010 seeds, CF-C-OPLIFE §6).
//
// The world: a real org home (built by the product init transaction) with a
// TARGET app and a SIBLING app registered through the product registrar, a
// seeded state home holding attributable state for BOTH apps, a human
// checkout, and the scripted GitHub double (fixtures/github-double) carrying
// identifiable `op:*` work. TEMP-FS ONLY — never the operator checkout or
// the real ~/.cormidia.
//
// The oracle (CORMIDIA-INV-010): a full-state bit-identical diff across org
// home + state home + human checkout; every changed/added/removed path must
// sit inside the AUTHORIZED DESTRUCTIVE SET for the named app (the
// operation's legitimate non-destructive writes — intent journal, role
// locks, efficiency/lifecycle step rows — are enumerated and excluded).
// `assertResetScope` THROWS ResetScopeViolation naming the offenders; the
// negative controls in cf-j14-a prove it fires on seeded violations.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { GhCliOps, type GhIssue, type GhPullRequest } from "../../../src/loop/github.js";
import { initOrgHome } from "../../../src/org/home.js";
import { joinExistingOrg, loadApps, type AppsFile } from "../../../src/org/apps.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import { stableJson } from "../../../src/org/lifecycle.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { diffSnapshots, snapshotTree, type SnapshotDiff, type TreeSnapshot } from "../cf-j01/support.js";

export { diffIsEmpty, diffPaths, diffSnapshots, snapshotTree } from "../cf-j01/support.js";
export type { SnapshotDiff, TreeSnapshot } from "../cf-j01/support.js";

export const TARGET_APP = "alpha";
export const SIBLING_APP = "beta";
export const DOUBLE_DEFAULT_BRANCH = "trunk"; // deliberately not main (#101)

export const OP_LABELS = [{ name: "op:task", color: "1d76db", description: "cormidia-managed work" }];

/** gh double ops that mutate remote state (reads are always permitted). */
const MUTATING_GH_OPS = new Set([
  "issue.create",
  "issue.edit",
  "issue.comment",
  "issue.close",
  "pr.create",
  "pr.edit",
  "pr.close",
  "pr.review",
  "pr.merge",
  "ref.delete",
  "label.create",
]);

export interface ResetWorld {
  root: string;
  orgHome: string;
  stateHome: string;
  homeDir: string;
  pointerPath: string;
  humanCheckout: string;
  archiveRoot: string;
  handle: GithubDoubleHandle;
  gh: GhCliOps;
  appsFile: AppsFile;
  issue: GhIssue;
  pr: GhPullRequest;
  opBranch: string;
  /** call-log length right after seeding — mutations before this are ours. */
  baseCallCount: number;
  /** State-home-relative paths of the target app's approval artifacts. */
  targetApprovalFiles: string[];
  cleanup(): Promise<void>;
}

export interface MakeResetWorldOptions {
  /** Also write a lifecycle record naming this recorded default branch. */
  recordDefaultBranch?: string;
}

export async function makeResetWorld(options: MakeResetWorldOptions = {}): Promise<ResetWorld> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-j14-"));
  await writeFile(join(root, "sentinel.txt"), "world sentinel — walks are never empty\n", "utf8");
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  const homeDir = join(root, "home");
  const pointerPath = join(homeDir, ".cormidia", "config");
  const humanCheckout = join(root, "human-checkout");
  const archiveRoot = join(root, "reset-archives");

  const handle = await installGithubDouble({
    defaultBranch: DOUBLE_DEFAULT_BRANCH,
    labels: OP_LABELS,
  });
  const gh = new GhCliOps(handle.repo, handle.exec);

  await initOrgHome({ target: orgHome, name: "cf-j14-org", stateHome, homeDir, pointerPath });
  await joinExistingOrg(orgHome, { name: TARGET_APP, repo: handle.repo });
  await joinExistingOrg(orgHome, { name: SIBLING_APP, repo: "cf-j14/sibling" });
  const appsFile = await loadApps(join(orgHome, "apps.yaml"));

  // --- Managed state for BOTH apps at the real product paths.
  for (const app of [TARGET_APP, SIBLING_APP]) {
    await mkdir(join(stateHome, "repos", app), { recursive: true });
    await writeFile(join(stateHome, "repos", app, "clone-marker.txt"), `${app} clone bytes\n`, "utf8");
    await mkdir(join(stateHome, "worktrees", app), { recursive: true });
    await writeFile(join(stateHome, "worktrees", app, "wt.txt"), `${app} worktree bytes\n`, "utf8");
    await mkdir(join(stateHome, "runs", app, "seed-run"), { recursive: true });
    await writeFile(join(stateHome, "runs", app, "seed-run", "artifact.txt"), `${app} run artifact\n`, "utf8");
    await mkdir(join(stateHome, "tickets", app), { recursive: true });
    await writeFile(join(stateHome, "tickets", app, "1.json"), stableJson({ app, issue: 1 }), "utf8");
    await mkdir(join(stateHome, "standing-roles", app), { recursive: true });
    await writeFile(join(stateHome, "standing-roles", app, "notes.md"), `${app} standing role\n`, "utf8");
    await mkdir(join(stateHome, "lifecycle", "apps", app), { recursive: true });
    await writeFile(
      join(stateHome, "lifecycle", "apps", app, "answers.json"),
      stableJson({ schema_version: 1, kind: "onboarding-answers", app }),
      "utf8",
    );
    await mkdir(join(stateHome, "lifecycle", "readiness"), { recursive: true });
    await writeFile(
      join(stateHome, "lifecycle", "readiness", `${app}.json`),
      stableJson({ app, status: "seeded" }),
      "utf8",
    );
  }

  if (options.recordDefaultBranch !== undefined) {
    await writeFile(
      join(stateHome, "lifecycle", "apps", TARGET_APP, "record.json"),
      stableJson({
        schema_version: 1,
        kind: "app-lifecycle",
        app: TARGET_APP,
        repo: handle.repo,
        remote_url: `https://github.com/${handle.repo}.git`,
        default_branch: options.recordDefaultBranch,
        default_base: "0000000000000000000000000000000000000000",
        source: {
          path: humanCheckout,
          branch: options.recordDefaultBranch,
          head: "0".repeat(40),
          status_sha256: "0".repeat(64),
        },
        onboarding_commit: "0".repeat(40),
        managed_clone: join(stateHome, "repos", TARGET_APP),
        authority_sha256: "0".repeat(64),
        config_sha256: `sha256:${"0".repeat(64)}`,
        answers_sha256: "0".repeat(64),
      }),
      "utf8",
    );
  }

  // Approvals: decided + grant for the target (attributable, removable);
  // a decided one for the sibling (must survive bit-identical). No PENDING
  // approvals here — those are blocker material (cf-j14-r seeds them).
  //
  // BLOCKED: F-PT-008 (grant-expiry item disposition) is a parked open
  // finding — this world treats the grant file ONLY as app-attributable
  // state for the INV-010 scope oracle and deliberately encodes nothing
  // about how expiring/expired grants are disposed of.
  await mkdir(join(stateHome, "approvals", "decided"), { recursive: true });
  await mkdir(join(stateHome, "approvals", "grants"), { recursive: true });
  await writeFile(
    join(stateHome, "approvals", "decided", "appr-target.json"),
    stableJson({ app: TARGET_APP, id: "appr-target", status: "approved" }),
    "utf8",
  );
  await writeFile(
    join(stateHome, "approvals", "grants", "grant-target.json"),
    stableJson({ app: TARGET_APP, id: "grant-target" }),
    "utf8",
  );
  await writeFile(
    join(stateHome, "approvals", "decided", "appr-sibling.json"),
    stableJson({ app: SIBLING_APP, id: "appr-sibling", status: "approved" }),
    "utf8",
  );

  // Shared JSONL ledgers: one mixed file (rewritten minus target lines) and
  // one sibling-only file (must never be rewritten).
  await mkdir(join(stateHome, "telemetry"), { recursive: true });
  await writeFile(
    join(stateHome, "telemetry", "mixed.jsonl"),
    `${JSON.stringify({ app: TARGET_APP, turn: 1 })}\n${JSON.stringify({ app: SIBLING_APP, turn: 2 })}\n`,
    "utf8",
  );
  await writeFile(
    join(stateHome, "telemetry", "sibling-only.jsonl"),
    `${JSON.stringify({ app: SIBLING_APP, turn: 3 })}\n`,
    "utf8",
  );
  await mkdir(join(stateHome, "invocations"), { recursive: true });
  await writeFile(
    join(stateHome, "invocations", "audit.jsonl"),
    `${JSON.stringify({ app: TARGET_APP, command: "seed" })}\n${JSON.stringify({ app: SIBLING_APP, command: "seed" })}\n`,
    "utf8",
  );

  // Schedule + budget overlay: both apps present; only target keys may go.
  await mkdir(join(stateHome, "state"), { recursive: true });
  await writeFile(
    join(stateHome, "state", "schedule.json"),
    stableJson({ [`${TARGET_APP}|daily`]: { last: "2026-07-30" }, [`${SIBLING_APP}|daily`]: { last: "2026-07-30" } }),
    "utf8",
  );
  await writeFile(
    join(stateHome, "state", "budget-overlay.json"),
    stableJson({ pausedApps: [TARGET_APP, SIBLING_APP] }),
    "utf8",
  );

  // The human checkout Cormidia must never touch.
  await mkdir(join(humanCheckout, "src"), { recursive: true });
  await writeFile(join(humanCheckout, "README.md"), "human project — hands off\n", "utf8");
  await writeFile(join(humanCheckout, "src", "app.ts"), "export const human = true;\n", "utf8");

  // Identifiable op:* GitHub work: one labeled issue, one op/ PR + branch.
  const issue = await gh.createIssue({
    title: "Managed work item",
    body: "Cormidia-managed ticket.",
    labels: ["op:task"],
  });
  const opBranch = `op/${issue.number}-managed-work`;
  handle.seedBranch(opBranch);
  const pr = await gh.createPR({
    head: opBranch,
    base: DOUBLE_DEFAULT_BRANCH,
    title: "Managed delivery",
    body: `Closes #${issue.number}`,
  });

  return {
    root,
    orgHome,
    stateHome,
    homeDir,
    pointerPath,
    humanCheckout,
    archiveRoot,
    handle,
    gh,
    appsFile,
    issue,
    pr,
    opBranch,
    baseCallCount: handle.callLog().length,
    targetApprovalFiles: ["approvals/decided/appr-target.json", "approvals/grants/grant-target.json"],
    cleanup: async () => {
      await handle.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Mutating gh ops recorded since the world finished seeding. */
export function mutatingOpsSince(world: ResetWorld, since = world.baseCallCount): string[] {
  return world.handle
    .callLog()
    .slice(since)
    .map((entry) => entry.op)
    .filter((op) => MUTATING_GH_OPS.has(op));
}

// --- blocker seeding (each maps to one LifecycleBlocker class) -------------

/** A `running` run row at the product envelope path; staleness is decided
 *  against last_seen_at (>10 min per journey-acceptance J-14). */
export async function seedRunningRun(world: ResetWorld, runId: string, lastSeenAt: Date): Promise<void> {
  const dir = join(world.stateHome, "runs", TARGET_APP, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "envelope.json"),
    stableJson({
      schema_version: 1,
      run_id: runId,
      trace_id: `trace-${runId}`,
      app: TARGET_APP,
      pipeline: "build",
      pass: "implement",
      role: "builder",
      status: "running",
      started_at: new Date(lastSeenAt.getTime() - 60_000).toISOString(),
      last_seen_at: lastSeenAt.toISOString(),
      refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
    }),
    "utf8",
  );
}

export async function seedActiveJournal(world: ResetWorld, app = TARGET_APP): Promise<string> {
  const turnId = `turn-${app}-journal`;
  await writeJournalPatch(world.stateHome, turnId, { role: "builder", app, phase: "assembling" });
  await writeJournalPatch(world.stateHome, turnId, { role: "builder", app, phase: "running" });
  return turnId;
}

export async function seedActiveLock(world: ResetWorld): Promise<string> {
  const path = join(world.stateHome, "locks", `${TARGET_APP}--builder.lock`);
  await mkdir(join(world.stateHome, "locks"), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        app: TARGET_APP,
        role: "builder",
        pid: process.pid, // alive: this test process
        turnId: "turn-held-by-live-process",
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path;
}

export async function seedPendingApproval(world: ResetWorld, app = TARGET_APP): Promise<string> {
  const id = `pending-${app}`;
  await mkdir(join(world.stateHome, "approvals", "pending"), { recursive: true });
  await writeFile(
    join(world.stateHome, "approvals", "pending", `${id}.json`),
    stableJson({ app, id, status: "pending" }),
    "utf8",
  );
  return id;
}

// --- the sibling-diff oracle -----------------------------------------------

export class ResetScopeViolation extends Error {
  constructor(
    readonly app: string,
    readonly offenders: string[],
  ) {
    super(
      `INV-010 violation: destructive/unexpected writes outside the authorized set for "${app}": ${offenders.join(", ")}`,
    );
    this.name = "ResetScopeViolation";
  }
}

export interface WorldSnapshots {
  org: TreeSnapshot;
  state: TreeSnapshot;
  human: TreeSnapshot;
}

export async function snapshotWorld(world: ResetWorld): Promise<WorldSnapshots> {
  return {
    org: await snapshotTree(world.orgHome),
    state: await snapshotTree(world.stateHome),
    human: await snapshotTree(world.humanCheckout),
  };
}

export interface WorldDiff {
  org: SnapshotDiff;
  state: SnapshotDiff;
  human: SnapshotDiff;
}

export function diffWorld(before: WorldSnapshots, after: WorldSnapshots): WorldDiff {
  return {
    org: diffSnapshots(before.org, after.org),
    state: diffSnapshots(before.state, after.state),
    human: diffSnapshots(before.human, after.human),
  };
}

/** The authorized destructive set for a COMPLETED reset of `app`, as
 *  state-home-relative regexes (C-OP-LIFE §6, INV-010). `extraExact` names
 *  the world-specific shared files a legitimate rewrite may touch
 *  (attributable approval files, seeded mixed ledgers). */
export function completedResetAllowance(
  app: string,
  extraExact: readonly string[],
): {
  state: (rel: string) => boolean;
  org: (rel: string) => boolean;
} {
  const patterns = [
    new RegExp(`^(?:repos|worktrees|runs|tickets|standing-roles)/${app}(?:/|$)`),
    new RegExp(`^lifecycle/apps/${app}(?:/|$)`),
    new RegExp(`^lifecycle/readiness/${app}\\.json$`),
    new RegExp(`^lifecycle/transactions/reset-${app}\\.json$`),
    new RegExp(`^locks/${app}--[^/]+\\.lock$`),
    /^efficiency\//, // lifecycle-step episode rows (non-destructive journal)
    /^learning\//, // episode closure rows written by the reset finalizer
    /^state\/schedule\.json$/,
    /^state\/budget-overlay\.json$/,
  ];
  const exact = new Set(extraExact);
  return {
    state: (rel) => exact.has(rel) || patterns.some((pattern) => pattern.test(rel)),
    org: (rel) => rel === "apps.yaml",
  };
}

/** Before destruction is authorized (refusals, archive failures): ONLY the
 *  non-destructive journal writes are permitted. */
export function preDestructionAllowance(app: string): {
  state: (rel: string) => boolean;
  org: (rel: string) => boolean;
} {
  const patterns = [
    new RegExp(`^lifecycle/transactions/reset-${app}\\.json$`),
    new RegExp(`^locks/${app}--[^/]+\\.lock$`),
    /^efficiency\//,
    /^learning\//,
  ];
  return {
    state: (rel) => patterns.some((pattern) => pattern.test(rel)),
    org: () => false,
  };
}

/** THE ORACLE: every diff path must be inside the allowance; the human
 *  checkout admits no diff at all. Throws ResetScopeViolation naming every
 *  offender (the negative controls prove it fires). */
export function assertResetScope(
  app: string,
  diff: WorldDiff,
  allowance: { state: (rel: string) => boolean; org: (rel: string) => boolean },
): void {
  const offenders: string[] = [];
  for (const rel of [...diff.org.added, ...diff.org.removed, ...diff.org.changed]) {
    if (!allowance.org(rel)) offenders.push(`org:${rel}`);
  }
  for (const rel of [...diff.state.added, ...diff.state.removed, ...diff.state.changed]) {
    if (!allowance.state(rel)) offenders.push(`state:${rel}`);
  }
  for (const rel of [...diff.human.added, ...diff.human.removed, ...diff.human.changed]) {
    offenders.push(`human-checkout:${rel}`);
  }
  if (offenders.length > 0) throw new ResetScopeViolation(app, offenders.sort());
}

// --- subprocess kill scenario ----------------------------------------------

/** Kill-point scenario driving the REAL executeAppReset in a subprocess: the
 *  product fault hook is bridged onto kp() markers, and the gh double serves
 *  the UNMODIFIED GhCliOps through PATH (the B-01 process seam). */
export const RESET_KILL_SCENARIO = `
import { join } from "node:path";
import { loadApps } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "..", "src", "org", "apps.js"))};
import { GhCliOps } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "..", "src", "loop", "github.js"))};
import { executeAppReset } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "..", "src", "org", "app-reset.js"))};
await kp("start");
const orgHome = process.env.CF_ORG_HOME!;
const appsFile = await loadApps(join(orgHome, "apps.yaml"));
await executeAppReset({
  orgHome,
  stateHome: process.env.CF_STATE_HOME!,
  appsFile,
  appName: process.env.CF_APP!,
  gh: new GhCliOps(process.env.CF_REPO!),
  archiveRoot: process.env.CF_ARCHIVE_ROOT!,
  fault: async (point) => { await kp(point); },
});
await kp("done");
`;

export function resetKillEnv(world: ResetWorld): Record<string, string> {
  return {
    CF_ORG_HOME: world.orgHome,
    CF_STATE_HOME: world.stateHome,
    CF_APP: TARGET_APP,
    CF_REPO: world.handle.repo,
    CF_ARCHIVE_ROOT: world.archiveRoot,
    PATH: `${world.handle.binDir}${delimiter}${process.env.PATH ?? ""}`,
  };
}
