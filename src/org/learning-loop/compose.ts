// Compose the org's learning loop from resolved Cormidia homes — the one
// constructor every operator surface (CLI, scheduled turns, context
// assembly) shares, so they all bind the SAME kernel registry revision: the
// destination set is derived from apps.yaml alone, never from which app
// checkouts happen to exist on this machine (a plan bound by `learn publish`
// must still match when the approval is decided days later).

import { basename, join } from "node:path";
import type { Clock, IdGenerator } from "@cormidia/learning-loop";
import { GhCliOps, type GhOps } from "../../loop/github.js";
import { resolveAppWorkdir } from "../app-workdir.js";
import type { AppEntry } from "../apps.js";
import { ApprovalStore } from "../approvals.js";
import type { CormidiaHomes } from "../home.js";
import { loadLearningPolicy, type LearningPolicy } from "../learning/policy.js";
import { createCormidiaLearningLoop, type CormidiaLearningApp, type CormidiaLearningLoop } from "./loop.js";
import type { CormidiaReplayRunner } from "./replay-executor.js";

/** The org name is the state home's directory name (`~/.cormidia/<org>`). */
export function orgNameOf(stateHome: string): string {
  return basename(stateHome);
}

/** `owner/repo` slugs reach GitHub; paths and file: URLs are local seeds. */
export function isGitHubRepo(repo: string): boolean {
  return repo.includes("/") && !repo.startsWith("/") && !repo.startsWith(".") && !repo.startsWith("file:");
}

/** The app checkout for learning destinations: the resolved local checkout
 *  when one exists, else the managed-clone location the dispatcher would
 *  create — a deterministic path either way, because a destination root must
 *  not depend on what happens to be cloned today. */
export function appWorkdirFor(
  app: AppEntry,
  homes: Pick<CormidiaHomes, "orgHome" | "stateHome">,
): { readonly workdir: string; readonly resolved: boolean } {
  try {
    return {
      workdir: resolveAppWorkdir(app, { orgRoot: homes.orgHome, runtimeHome: homes.stateHome }),
      resolved: true,
    };
  } catch {
    return { workdir: join(homes.stateHome, "repos", app.name), resolved: false };
  }
}

export type DestinationKind = "okf" | "proposal" | "ticket";

/** The registry-stable destination id for a kind and (optional) app. */
export function destinationIdFor(kind: DestinationKind, app?: string): string {
  const prefix = kind === "okf" ? "okf-concept" : kind;
  if (app === undefined) {
    if (kind === "ticket") throw new Error("learning-loop: tickets land in an app repository; name the app");
    return `${prefix}:org`;
  }
  return `${prefix}:app:${app}`;
}

export interface ComposeLearningLoopOptions {
  readonly approvals?: ApprovalStore;
  readonly policy?: LearningPolicy;
  readonly replayRunner?: CormidiaReplayRunner;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** GitHub seam per app; defaults to `gh` against the app's `owner/repo`. */
  readonly gh?: (app: AppEntry) => GhOps | undefined;
}

function defaultGh(app: AppEntry): GhOps | undefined {
  return isGitHubRepo(app.repo) ? new GhCliOps(app.repo) : undefined;
}

export async function composeLearningLoop(
  homes: CormidiaHomes,
  options: ComposeLearningLoopOptions = {},
): Promise<CormidiaLearningLoop> {
  const policy = options.policy ?? (await loadLearningPolicy(homes.orgHome));
  const ghFor = options.gh ?? defaultGh;
  const apps: CormidiaLearningApp[] = homes.appsFile.apps.map((app) => {
    const workdir = appWorkdirFor(app, homes);
    return { name: app.name, workdir: workdir.workdir, resolved: workdir.resolved, gh: () => ghFor(app) };
  });
  return createCormidiaLearningLoop({
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    org: orgNameOf(homes.stateHome),
    approvals: options.approvals ?? new ApprovalStore(homes.stateHome),
    policy,
    apps,
    ...(options.replayRunner !== undefined ? { replayRunner: options.replayRunner } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.ids !== undefined ? { ids: options.ids } : {}),
  });
}
