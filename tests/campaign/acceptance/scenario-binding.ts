// campaign/acceptance/scenario-binding.ts — no campaign app or scenario
// worktree resolves to this repository (CORMIDIA-INV-ACC-3;
// acceptance/README.md hard boundary 2).
//
// `assertCampaignRepositoryBinding` already pins checked-out HEAD, the
// canonical host policy, and the selected Validation Architect authority bytes
// to the authorized commit, and it is REUSED
// rather than reimplemented (B-27 §1.1). What it does not cover is the three
// ways a scenario can point back at Cormidia anyway:
//
//   * the campaign app's configured SLUG names this repository;
//   * a scenario worktree's real git ORIGIN resolves to this repository, even
//     though the worktree itself lives elsewhere;
//   * a job scenario's `--workdir` sits inside this checkout.
//
// An app that edits this repo mid-campaign voids the campaign's own identity,
// which is why this is an invariant and not a preference. Cormidia feature work
// is a campaign OUTPUT — filed issues feeding a normal development cycle —
// never a step inside it.

import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type ScenarioBindingCode =
  | "app-slug"
  | "outside-campaign-org"
  | "worktree-inside-checkout"
  | "worktree-origin"
  | "job-workdir";

export class ScenarioBindingError extends Error {
  constructor(
    readonly code: ScenarioBindingCode,
    readonly scenarioId: string,
    message: string,
  ) {
    super(`campaign refused: scenario ${scenarioId} binds to this repository (${code}): ${message}`);
    this.name = "ScenarioBindingError";
  }
}

export interface CormidiaIdentity {
  /** This repository's canonical slug, e.g. `cormidia/cormidia`. */
  slug: string;
  /** Realpath of this checkout's root. */
  root: string;
}

export interface ScenarioBindingInput {
  scenarioId: string;
  /** The campaign app's configured repository slug. */
  appSlug: string;
  /** The owner every scenario repository must belong to — the campaign org's
   *  own disposable namespace. B-27 §1.3 requires "not this repository AND not
   *  any repository outside the campaign org", and the second half is the one
   *  that stops a campaign pointing at some unrelated real repository that
   *  merely is not Cormidia. */
  campaignOrg: string;
  /** The worktree the org will operate in for this scenario. */
  worktree: string;
  /** For a job scenario: the `--workdir` `cormidia-job` is invoked with. */
  jobWorkdir?: string;
  cormidia: CormidiaIdentity;
}

export interface ScenarioBindingProof {
  scenarioId: string;
  appSlug: string;
  campaignOrg: string;
  worktree: string;
  /** Normalized origin of the scenario worktree, or `null` when it has none. */
  worktreeOrigin: string | null;
  jobWorkdir: string | null;
}

/** `host/owner/repo`, lowercased, `.git` stripped. A filesystem ref (`file://`,
 *  absolute, or relative) keeps its exact case: it is compared as a PATH, and
 *  case-folding it silently breaks containment on a case-preserving filesystem
 *  — which is how a `/var/folders/…/T/…` origin slipped past this check once. */
export function normalizeRepositoryRef(ref: string): string {
  const trimmed = ref.trim().replace(/\.git$/, "");
  if (trimmed.startsWith("file://")) return decodeURIComponent(new URL(trimmed).pathname);
  if (trimmed.startsWith("/") || trimmed.startsWith(".")) return trimmed;
  const scp = /^[^/@]+@([^:]+):(.+)$/.exec(trimmed);
  if (scp !== null) return `${scp[1]}/${scp[2]}`.toLowerCase();
  try {
    const url = new URL(trimmed);
    return `${url.host}${url.pathname}`
      .replace(/\/+/g, "/")
      .replace(/^\/|\/$/g, "")
      .toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Two refs name the same repository when they are equal, or when their
 *  `owner/repo` tails match. Tail matching is deliberately generous: a
 *  host-qualified `github.com/cormidia/cormidia` and a bare `cormidia/cormidia`
 *  are the same repository, and INV-ACC-3 fails closed — over-refusing a
 *  sandbox app costs a rename, while under-refusing voids the campaign. */
export function isSameRepository(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.startsWith("/") || right.startsWith("/")) return false;
  const tail = (ref: string): string => ref.split("/").filter(Boolean).slice(-2).join("/");
  const leftTail = tail(left);
  return leftTail.includes("/") && leftTail === tail(right);
}

async function resolvedPath(candidate: string): Promise<string | null> {
  if (!candidate.startsWith("/")) return null;
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

async function realOrResolved(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    return resolve(candidate);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function gitOrigin(dir: string): string | null {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
  } catch {
    return null;
  }
}

/** Fail-closed, before any scenario repository is provisioned or mutated. */
export async function assertScenarioNotThisRepository(input: ScenarioBindingInput): Promise<ScenarioBindingProof> {
  const cormidiaSlug = normalizeRepositoryRef(input.cormidia.slug);
  const cormidiaRoot = await realpath(input.cormidia.root);

  const appSlug = normalizeRepositoryRef(input.appSlug);
  if (isSameRepository(appSlug, cormidiaSlug)) {
    throw new ScenarioBindingError(
      "app-slug",
      input.scenarioId,
      `campaign app slug ${JSON.stringify(input.appSlug)} is this repository`,
    );
  }

  // "Not Cormidia" is not enough: a slug that is neither Cormidia nor the
  // campaign org is some third party's real repository, and a campaign is only
  // ever authorized over its own disposable ones.
  const campaignOrg = input.campaignOrg.trim().toLowerCase();
  const owner = appSlug.split("/").filter(Boolean).slice(-2)[0];
  if (campaignOrg.length === 0 || owner === undefined || owner !== campaignOrg) {
    throw new ScenarioBindingError(
      "outside-campaign-org",
      input.scenarioId,
      `campaign app slug ${JSON.stringify(input.appSlug)} does not belong to the campaign org ` +
        `${JSON.stringify(input.campaignOrg)}; a campaign is authorized only over its own disposable repositories`,
    );
  }

  const worktree = await realOrResolved(input.worktree);
  if (isInside(cormidiaRoot, worktree)) {
    throw new ScenarioBindingError(
      "worktree-inside-checkout",
      input.scenarioId,
      `scenario worktree ${worktree} lies inside this checkout ${cormidiaRoot}`,
    );
  }

  const rawOrigin = gitOrigin(worktree);
  const worktreeOrigin = rawOrigin === null ? null : normalizeRepositoryRef(rawOrigin);
  if (worktreeOrigin !== null) {
    const originPath = await resolvedPath(worktreeOrigin);
    const originIsCormidiaSlug = isSameRepository(worktreeOrigin, cormidiaSlug);
    const originIsCormidiaPath = originPath !== null && isInside(cormidiaRoot, originPath);
    if (originIsCormidiaSlug || originIsCormidiaPath) {
      throw new ScenarioBindingError(
        "worktree-origin",
        input.scenarioId,
        `scenario worktree origin ${JSON.stringify(rawOrigin)} resolves to this repository`,
      );
    }
  }

  let jobWorkdir: string | null = null;
  if (input.jobWorkdir !== undefined) {
    jobWorkdir = await realOrResolved(input.jobWorkdir);
    if (isInside(cormidiaRoot, jobWorkdir)) {
      throw new ScenarioBindingError(
        "job-workdir",
        input.scenarioId,
        `job --workdir ${jobWorkdir} lies inside this checkout ${cormidiaRoot}`,
      );
    }
  }

  return { scenarioId: input.scenarioId, appSlug, campaignOrg, worktree, worktreeOrigin, jobWorkdir };
}
