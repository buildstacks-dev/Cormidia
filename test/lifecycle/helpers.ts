import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { bootstrapFromRecoveredAnswers, verifyApp, type RecoveredBootstrapResult } from "../../src/org/app-lifecycle.js";
import { initOrgHome } from "../../src/org/home.js";
import { makeBareWithCloneAt, type BareCloneFixture } from "../fixtures/gitRepo.js";

export const LIFECYCLE_ANSWERS = {
  product: "A sparse deterministic lifecycle fixture.",
  good: "Every lifecycle transition is mechanical and reversible.",
  roles: ["planner"],
  budgetUsdMonth: 100,
  authority: { mode: "inherit" },
};

export interface LifecycleTestWorld {
  root: string;
  orgHome: string;
  stateHome: string;
  archives: string;
  git: BareCloneFixture;
  cleanup(): void;
}

export async function makeLifecycleTestWorld(): Promise<LifecycleTestWorld> {
  const root = mkdtempSync(join(tmpdir(), "operon-lifecycle-world-"));
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  const git = makeBareWithCloneAt(join(root, "git"));
  git.clone.commit("chore: lifecycle checks", {
    "package.json": `${JSON.stringify({
      name: "sparse",
      private: true,
      scripts: { test: "node -e \"process.exit(0)\"", lint: "node -e \"process.exit(0)\"" },
    }, null, 2)}\n`,
  });
  git.clone.git("push", "origin", "main");
  git.clone.git("checkout", "-b", "human/topic");
  git.clone.commit("docs: human branch", { "human.md": "human topic\n" });
  writeFileSync(join(git.clone.root, "untracked.txt"), "local-only\n");
  await initOrgHome({ target: orgHome, name: "lifecycle", stateHome, homeDir: join(root, "home") });
  return { root, orgHome, stateHome, archives: join(root, "archives"), git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export async function bootstrapReachable(world: LifecycleTestWorld): Promise<RecoveredBootstrapResult> {
  const result = await bootstrapFromRecoveredAnswers(world.git.clone.root, LIFECYCLE_ANSWERS, {
    orgHome: world.orgHome,
    stateHome: world.stateHome,
    appName: "sparse",
  });
  git(result.managedClone, "push", "origin", "HEAD:main");
  const verification = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse" });
  if (verification.status !== "ready") throw new Error(`fixture verification failed: ${JSON.stringify(verification.checks)}`);
  return result;
}

export function makeLegacy(world: LifecycleTestWorld): void {
  unlinkSync(join(world.orgHome, "AUTHORITY.md"));
  const path = join(world.orgHome, "apps.yaml");
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete raw["schema_version"];
  writeFileSync(path, stringify(raw), "utf8");
}

export function sourceSnapshot(root: string): Record<string, string> {
  const status = gitRaw(root, "status", "--porcelain=v2", "--untracked-files=all");
  return {
    branch: git(root, "branch", "--show-current"),
    head: git(root, "rev-parse", "HEAD"),
    status,
    diff_sha256: createHash("sha256").update(gitRaw(root, "diff", "--binary", "HEAD")).digest("hex"),
  };
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8" }).trim();
}

function gitRaw(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8" });
}
