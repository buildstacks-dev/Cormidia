// CF-REG-382 shared fixtures — a real greenfield checkout, a real bare remote
// pushed to over file://, and a scriptable GitHub double for the repository
// surface provisioning uses.
//
// Everything git is real and hermetic (fixtures/git-repo.ts conventions):
// system/global config cannot leak in and identity is pinned per repo. The
// default branch NAME is deliberately not `main` in the ancestry fixtures so a
// guessed base (#101/#203) is visibly wrong rather than accidentally right.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GhRepositoryView } from "../../../src/loop/github.js";
import { CANONICAL_LABELS } from "../../../src/loop/plan-tickets.js";
import type { ProvisionGhOps } from "../../../src/org/repo-provision-execute.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  }).trim();
}

export const FIXTURE_SLUG = "cormidia-fixture/widget";

/** Deliberate misbehaviors, one per seeded failure the issue requires. */
export interface DoubleFaults {
  /** `createRepository` throws AFTER the repository is really made — the lost
   *  response. A correct implementation reconciles by marker; a wrong one
   *  either fails outright or makes a second repository. */
  loseCreateResponse?: boolean;
  /** `createRepository` throws and NOTHING is made. */
  createFailsCleanly?: boolean;
  /** Install only the first N canonical labels, then start throwing. */
  labelsInstalledBeforeFailure?: number;
  /** `readRepository` throws instead of answering — "I could not look". */
  readThrows?: boolean;
}

/** The repository surface, in memory. Counts calls so a duplicate-create is
 *  observable rather than inferred. */
export class ProvisionGithubDouble implements ProvisionGhOps {
  createCalls = 0;
  readCalls = 0;
  private labels = new Map<string, { name: string; color: string; description: string }>();
  private repository: GhRepositoryView | undefined;

  constructor(
    public faults: DoubleFaults = {},
    initial?: Partial<GhRepositoryView>,
  ) {
    if (initial !== undefined) {
      this.repository = {
        slug: FIXTURE_SLUG,
        visibility: "PRIVATE",
        defaultBranch: null,
        description: "",
        isEmpty: true,
        ...initial,
      };
    }
  }

  /** What the remote really holds, for assertions. Never used by the product. */
  get state(): { repository: GhRepositoryView | undefined; labelNames: string[] } {
    return { repository: this.repository, labelNames: [...this.labels.keys()].sort() };
  }

  async readRepository(): Promise<GhRepositoryView | undefined> {
    this.readCalls += 1;
    if (this.faults.readThrows === true) throw new Error("HTTP 401: Bad credentials");
    return this.repository;
  }

  async createRepository(input: { visibility: "private"; description: string }): Promise<GhRepositoryView> {
    this.createCalls += 1;
    if (this.faults.createFailsCleanly === true) {
      throw new Error("HTTP 422: Validation Failed — could not create repository");
    }
    if (this.repository !== undefined) {
      throw new Error("HTTP 422: Validation Failed — name already exists on this account");
    }
    this.repository = {
      slug: FIXTURE_SLUG,
      visibility: "PRIVATE",
      defaultBranch: null,
      description: input.description,
      isEmpty: true,
    };
    if (this.faults.loseCreateResponse === true) {
      // The effect landed; the answer did not come back.
      throw new Error('Post "https://api.github.com/user/repos": read tcp: connection reset by peer');
    }
    return this.repository;
  }

  async ensureLabel(input: { name: string; color: string; description: string }): Promise<void> {
    const budget = this.faults.labelsInstalledBeforeFailure;
    if (budget !== undefined && this.labels.size >= budget) {
      throw new Error(`HTTP 502: Bad Gateway — label ${input.name} was not applied`);
    }
    this.labels.set(input.name, { ...input, color: input.color.toLowerCase() });
  }

  async listLabels(): Promise<Array<{ name: string; color: string; description: string }>> {
    return [...this.labels.values()];
  }

  /** Seed labels directly, for verification fixtures. */
  seedLabels(labels: ReadonlyArray<{ name: string; color: string; description: string }>): void {
    for (const label of labels) this.labels.set(label.name, { ...label, color: label.color.toLowerCase() });
  }

  seedAllCanonicalLabels(): void {
    this.seedLabels(
      CANONICAL_LABELS.map((label) => ({
        name: label.name,
        color: label.color,
        description: label.description,
      })),
    );
  }

  /** Reflect a push: the repository is no longer empty and has a default. */
  markPushed(branch: string): void {
    if (this.repository === undefined) return;
    this.repository = { ...this.repository, defaultBranch: branch, isEmpty: false };
  }

  /** Lift the label fault without losing the labels already installed, so a
   *  resume sees the same partially-installed world with GitHub healthy again. */
  liftLabelFault(): void {
    const { labelsInstalledBeforeFailure: _dropped, ...rest } = this.faults;
    this.faults = rest;
  }

  /** Seeded amnesia for the duplicate-create negative control: the remote
   *  forgets the repository, so a correct implementation's marker
   *  reconciliation has nothing to find and a second create really happens. */
  forgetRepository(): void {
    this.repository = undefined;
  }

  /** Flip visibility out from under a verification — the "someone made it
   *  public afterwards" facet. */
  setVisibility(visibility: "PRIVATE" | "PUBLIC" | "INTERNAL"): void {
    if (this.repository !== undefined) this.repository = { ...this.repository, visibility };
  }

  /** Remove one label, for the half-installed verification facet. */
  dropLabel(name: string): void {
    this.labels.delete(name);
  }
}

export interface GreenfieldCheckout {
  /** The app checkout whose bytes would be committed. */
  root: string;
  /** The bare repository the push really lands in. */
  remoteDir: string;
  stateHome: string;
  cleanup(): Promise<void>;
}

const SCAFFOLD: ReadonlyArray<readonly [string, string]> = [
  [".cormidia/config.yaml", "name: widget\nrepo: cormidia-fixture/widget\n"],
  [".cormidia/TASTE.md", "# widget charter\n"],
  [".cormidia/bootstrap/next-commands.md", "# next commands\n"],
  ["docs/VISION.md", "# Vision\n"],
  ["docs/REQUIREMENTS.md", "# Requirements\n"],
  ["AGENTS.md", "# widget\n"],
  ["README.md", "# widget\n"],
  [".gitignore", "node_modules/\n"],
];

/** A greenfield checkout exactly as `new-app` leaves it, plus a file:// bare
 *  repository standing in for the GitHub remote. `initGit` controls whether the
 *  checkout is already a git repository, so both the `git init` path and the
 *  already-initialized path are exercised for real. */
export async function makeGreenfieldCheckout(
  options: { initGit?: boolean; defaultBranch?: string; extraFiles?: ReadonlyArray<readonly [string, string]> } = {},
): Promise<GreenfieldCheckout> {
  const branch = options.defaultBranch ?? "main";
  const base = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-382-"));
  const root = join(base, "widget");
  const stateHome = join(base, "state");
  mkdirSync(root, { recursive: true });
  mkdirSync(stateHome, { recursive: true });

  for (const [rel, content] of [...SCAFFOLD, ...(options.extraFiles ?? [])]) {
    const absolute = join(root, rel);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }

  const remoteDir = join(base, "remote.git");
  git(base, ["init", "--bare", "-b", branch, remoteDir]);

  if (options.initGit === true) {
    git(root, ["init", "-b", branch]);
    pinIdentity(root);
  }

  return {
    root,
    remoteDir,
    stateHome,
    cleanup: async () => {
      await rm(base, { recursive: true, force: true });
    },
  };
}

/** Identity and signing pinned so a commit never depends on host config. */
export function pinIdentity(root: string): void {
  git(root, ["config", "user.name", "Cormidia Fixture"]);
  git(root, ["config", "user.email", "fixture@cormidia.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

/** Reject every push at the remote while leaving fetch healthy — the
 *  partial-provisioning seam (repository created, commit built, push refused). */
export function denyPush(remoteDir: string): void {
  const hook = join(remoteDir, "hooks", "pre-receive");
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\necho 'fixture: push denied' >&2\nexit 1\n", { mode: 0o755 });
}

export function allowPush(remoteDir: string): void {
  const hook = join(remoteDir, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}
