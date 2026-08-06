import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GhCliOps, type GhIssue, type GhOps, type GhPullRequest } from "../../src/loop/github.js";
import type { GithubConformanceSurface } from "../fixtures/github-double/conformance/suite.js";

const execFileAsync = promisify(execFile);

export interface GithubConformanceArtifactTracker {
  issues: Set<number>;
  prs: Set<number>;
  branches: Set<string>;
  labels: Set<string>;
}

/** Track effects created through the real conformance surface. A successful
 * branch deletion is itself a consumed cleanup effect: remove it from the
 * outstanding set immediately so final cleanup never re-performs it. */
export function trackGithubConformanceOps(raw: GhOps, tracker: GithubConformanceArtifactTracker): GhOps {
  return new Proxy(raw, {
    get(target, property) {
      if (property === "createIssue")
        return async (input: Parameters<GhOps["createIssue"]>[0]): Promise<GhIssue> => {
          const result = await target.createIssue(input);
          tracker.issues.add(result.number);
          return result;
        };
      if (property === "createPR")
        return async (input: Parameters<GhOps["createPR"]>[0]): Promise<GhPullRequest> => {
          const result = await target.createPR(input);
          tracker.prs.add(result.number);
          return result;
        };
      if (property === "ensureLabel")
        return async (input: Parameters<GhOps["ensureLabel"]>[0]): Promise<void> => {
          await target.ensureLabel(input);
          tracker.labels.add(input.name);
        };
      if (property === "deleteBranch")
        return async (branch: string): Promise<void> => {
          await target.deleteBranch(branch);
          tracker.branches.delete(branch);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as GhOps;
}

export class RealGithubConformanceSurface implements GithubConformanceSurface {
  readonly label: string;
  readonly ops: GhOps;
  private readonly raw: GhCliOps;
  private readonly root: string;
  private readonly checkout: string;
  private readonly artifacts: GithubConformanceArtifactTracker = {
    issues: new Set<number>(),
    prs: new Set<number>(),
    branches: new Set<string>(),
    labels: new Set<string>(),
  };
  private sequence = 0;
  private cleaned = false;

  private constructor(
    readonly repo: string,
    root: string,
    checkout: string,
  ) {
    this.label = `github:${repo}`;
    this.root = root;
    this.checkout = checkout;
    this.raw = new GhCliOps(repo);
    this.ops = trackGithubConformanceOps(this.raw, this.artifacts);
  }

  static async create(repo: string): Promise<RealGithubConformanceSurface> {
    const root = await mkdtemp(join(tmpdir(), "cormidia-live-github-"));
    const checkout = join(root, "checkout");
    await run(root, "gh", ["repo", "clone", repo, checkout, "--", "--filter=blob:none"]);
    await run(checkout, "git", ["config", "user.name", "Cormidia Validation"]);
    await run(checkout, "git", ["config", "user.email", "validation@cormidia.invalid"]);
    await run(checkout, "git", ["config", "commit.gpgsign", "false"]);
    return new RealGithubConformanceSurface(repo, root, checkout);
  }

  async resolveDefaultBranch(): Promise<string> {
    return (
      await run(this.checkout, "gh", [
        "repo",
        "view",
        this.repo,
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ])
    ).trim();
  }

  async prepareBranch(prefix: string): Promise<{ branch: string; headOid: string }> {
    const base = await this.resolveDefaultBranch();
    const branch = `cormidia-conformance/${prefix}-${Date.now().toString(36)}-${++this.sequence}`;
    await run(this.checkout, "git", ["fetch", "origin", base]);
    await run(this.checkout, "git", ["switch", "--force-create", branch, `origin/${base}`]);
    const rel = `.cormidia-conformance/${branch.replaceAll("/", "-")}.txt`;
    await mkdir(join(this.checkout, ".cormidia-conformance"), { recursive: true });
    await writeFile(join(this.checkout, rel), `${branch}\n`, "utf8");
    await run(this.checkout, "git", ["add", "--", rel]);
    await run(this.checkout, "git", ["commit", "--no-gpg-sign", "-m", `test(validation): ${prefix}`]);
    await run(this.checkout, "git", ["push", "--set-upstream", "origin", branch]);
    this.artifacts.branches.add(branch);
    return { branch, headOid: await this.head() };
  }

  async advanceBranch(branch: string): Promise<string> {
    await run(this.checkout, "git", ["switch", branch]);
    const rel = `.cormidia-conformance/advance-${++this.sequence}.txt`;
    await writeFile(join(this.checkout, rel), `${branch} advance ${this.sequence}\n`, "utf8");
    await run(this.checkout, "git", ["add", "--", rel]);
    await run(this.checkout, "git", ["commit", "--no-gpg-sign", "-m", "test(validation): advance conformance branch"]);
    await run(this.checkout, "git", ["push", "origin", branch]);
    return this.head();
  }

  async cleanup(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    const failures: string[] = [];
    for (const pr of this.artifacts.prs) {
      try {
        if ((await this.raw.readPR(pr)).state === "OPEN") await this.raw.closePullRequest(pr);
      } catch (error) {
        failures.push(`pr:${pr}:${errorMessage(error)}`);
      }
    }
    for (const issue of this.artifacts.issues) {
      try {
        if ((await this.raw.readIssue(issue)).state === "OPEN") await this.raw.closeIssue(issue);
      } catch (error) {
        failures.push(`issue:${issue}:${errorMessage(error)}`);
      }
    }
    for (const branch of this.artifacts.branches) {
      try {
        await this.raw.deleteBranch(branch);
      } catch (error) {
        failures.push(`branch:${branch}:${errorMessage(error)}`);
      }
    }
    for (const label of this.artifacts.labels) {
      try {
        await run(this.checkout, "gh", ["label", "delete", label, "--repo", this.repo, "--yes"]);
      } catch (error) {
        failures.push(`label:${label}:${errorMessage(error)}`);
      }
    }
    await rm(this.root, { recursive: true, force: true });
    if (failures.length > 0)
      throw new AggregateError(failures, `GitHub conformance cleanup failed for ${failures.length} artifact(s)`);
  }

  private async head(): Promise<string> {
    return (await run(this.checkout, "git", ["rev-parse", "HEAD"])).trim();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(cwd: string, command: string, args: string[]): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout;
}
