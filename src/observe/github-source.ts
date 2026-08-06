import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GhCliOps } from "../loop/github.js";
import type { AppEntry } from "../org/apps.js";
import type { GitHubAppSnapshot, SourceHealthView } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ObserveGitHubSource {
  read(apps: readonly AppEntry[], now: Date): Promise<GitHubReadResult>;
}

export interface GitHubReadResult {
  apps: GitHubAppSnapshot[];
  health: SourceHealthView;
}

interface GhObserveOptions {
  timeoutMs?: number;
  issueLimit?: number;
  pullRequestLimit?: number;
  client?: (repo: string) => GhCliOps;
  checks?: (
    repo: string,
    pullRequest: number,
    timeoutMs: number,
  ) => Promise<Array<{ name: string; state: string; link?: string }>>;
}

export class GhObserveSource implements ObserveGitHubSource {
  private readonly timeoutMs: number;
  private readonly issueLimit: number;
  private readonly pullRequestLimit: number;
  private readonly client: (repo: string) => GhCliOps;
  private readonly checks: NonNullable<GhObserveOptions["checks"]>;

  constructor(options: GhObserveOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.issueLimit = options.issueLimit ?? 100;
    this.pullRequestLimit = options.pullRequestLimit ?? 50;
    this.client = options.client ?? ((repo) => new GhCliOps(repo));
    this.checks = options.checks ?? readChecks;
  }

  async read(apps: readonly AppEntry[], now: Date): Promise<GitHubReadResult> {
    const observedAt = now.toISOString();
    const snapshots: GitHubAppSnapshot[] = [];
    for (const app of apps) {
      const gh = this.client(app.repo);
      try {
        const [issues, pullRequests] = await bounded(
          Promise.all([
            gh.listIssues({ state: "all", limit: this.issueLimit }),
            gh.listPullRequests({ state: "all", limit: this.pullRequestLimit }),
          ]),
          this.timeoutMs,
          `GitHub read timed out for ${app.repo}`,
        );
        const withReviews = [] as GitHubAppSnapshot["pull_requests"];
        for (const pullRequest of pullRequests) {
          const reviews = await bounded(
            gh.listReviews(pullRequest.number),
            this.timeoutMs,
            `GitHub review read timed out for ${app.repo}#${pullRequest.number}`,
          );
          const checks = await this.checks(app.repo, pullRequest.number, this.timeoutMs);
          withReviews.push({ pull_request: pullRequest, reviews, checks });
        }
        snapshots.push({
          app: app.name,
          repo: app.repo,
          issues,
          pull_requests: withReviews,
          observed_at: observedAt,
        });
      } catch (error) {
        snapshots.push({
          app: app.name,
          repo: app.repo,
          issues: [],
          pull_requests: [],
          observed_at: observedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const failed = snapshots.filter((snapshot) => snapshot.error !== undefined);
    const status =
      failed.length === 0
        ? "healthy"
        : failed.length === snapshots.length && snapshots.length > 0
          ? "unavailable"
          : "degraded";
    return {
      apps: snapshots,
      health: {
        id: "github",
        status,
        observed_at: observedAt,
        last_success_at: status === "unavailable" ? null : observedAt,
        detail:
          snapshots.length === 0
            ? "No registered apps; no GitHub read required"
            : failed.length === 0
              ? `Read-only GitHub projection refreshed for ${snapshots.length} app(s)`
              : failed.map((snapshot) => `${snapshot.repo}: ${snapshot.error}`).join("; "),
      },
    };
  }
}

async function readChecks(
  repo: string,
  pullRequest: number,
  timeoutMs: number,
): Promise<Array<{ name: string; state: string; link?: string }>> {
  let stdout = "";
  try {
    const result = await execFileAsync(
      "gh",
      ["pr", "checks", String(pullRequest), "--repo", repo, "--json", "name,state,link"],
      { encoding: "utf8", timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    stdout = result.stdout;
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    // `gh pr checks` exits non-zero when checks are red while still returning
    // the requested structured JSON. Preserve that evidence.
    stdout = detail.stdout ?? "";
    if (/no checks reported/i.test(`${detail.stderr ?? ""}\n${detail.message ?? ""}`)) return [];
    if (stdout.trim().length === 0) throw error;
  }
  const raw = JSON.parse(stdout) as unknown;
  if (!Array.isArray(raw)) throw new Error(`GitHub checks for ${repo}#${pullRequest} were not a list`);
  return raw.flatMap((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record["name"] !== "string" || typeof record["state"] !== "string") return [];
    return [
      {
        name: record["name"],
        state: record["state"],
        ...(typeof record["link"] === "string" ? { link: record["link"] } : {}),
      },
    ];
  });
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
