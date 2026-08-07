#!/usr/bin/env node

// Upstream freshness probe for the seven harnesses (#332).
//
// Keeping harness support current "need not be manual" (product owner,
// 2026-08-07): this script fetches the latest versions, model rosters and
// prices from the official sources recorded in
// `research/2026-08-06_adapter-upstream-references.md` and each adapter's dated
// certification record, diffs them against `src/runtime/harness-metadata.json`,
// and — on a delta — updates that one file and opens a pull request for a human
// to read and merge.
//
// Hard boundaries, enforced here and tested in `tests/unit/cf-reg-332/`:
//  - It NEVER merges. The pull request is the whole output.
//  - It NEVER edits a human-ratified surface (`roles.yaml`, `TASTE.md`,
//    `docs/PURPOSE.md`, `pipelines.yaml`, `prompts/**`). Model-id consequences
//    are prose in the PR body.
//  - It NEVER moves a `testedWith` band. That is a re-certification claim
//    (`docs/harness/adding-updating.md` §6); the probe only reports the drift.
//  - A source it could not read is a FAILURE, never "no changes". Exit 1.
//
// Usage:
//   node scripts/harness-freshness.mjs [--json] [--out <file>]
//   node scripts/harness-freshness.mjs --fixtures <dir>        # offline, recorded payloads
//   node scripts/harness-freshness.mjs --apply --open-pr       # the scheduled path
//   node scripts/harness-freshness.mjs --apply --dry-run-pr    # print the plan, touch nothing
//
// Exit codes: 0 fresh · 3 delta · 1 probe failure or usage error.

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  diffUpstream,
  exitCodeFor,
  plannedRequests,
  PROTECTED_PATHS,
  readHarnessBands,
  renderReport,
  WRITABLE_METADATA_PATH,
} from "./harness-freshness-diff.mjs";

const execFile = promisify(execFileCallback);

const FETCH_TIMEOUT_MS = 20_000;
const BRANCH = "chore/harness-freshness";
const PR_TITLE = "chore(harness): upstream freshness — versions, models, pricing";

export function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    fixtures: undefined,
    metadata: undefined,
    support: undefined,
    out: undefined,
    json: false,
    apply: false,
    format: true,
    openPr: false,
    dryRunPr: false,
    now: undefined,
  };
  const pathFlags = { "--root": "root", "--fixtures": "fixtures", "--metadata": "metadata", "--support": "support" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag in pathFlags || flag === "--out" || flag === "--now") {
      if (value === undefined) throw new Error(`${flag} requires a value`);
      if (flag === "--now") options.now = value;
      else if (flag === "--out") options.out = resolve(value);
      else options[pathFlags[flag]] = resolve(value);
      index += 1;
      continue;
    }
    if (flag === "--json") options.json = true;
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--no-format") options.format = false;
    else if (flag === "--open-pr") options.openPr = true;
    else if (flag === "--dry-run-pr") options.dryRunPr = true;
    else throw new Error(`unknown option ${flag}`);
  }
  options.metadata ??= join(options.root, WRITABLE_METADATA_PATH);
  options.support ??= join(options.root, "src", "runtime", "harness-support.ts");
  if (options.openPr) options.apply = true;
  return options;
}

/**
 * Load a recorded-payload index, following `extends` so a scenario is a small
 * overlay on the shared corpus and only states what it changes. Each response
 * remembers the directory that declared it, so a child's `bodyFile` resolves
 * against the child and an inherited one against its parent.
 */
export async function loadFixtureIndex(directory, seen = new Set()) {
  const path = resolve(directory);
  if (seen.has(path)) throw new Error(`fixture extends cycle at ${path}`);
  seen.add(path);
  const index = JSON.parse(await readFile(join(path, "index.json"), "utf8"));
  const responses = index.extends === undefined ? new Map() : await loadFixtureIndex(join(path, index.extends), seen);
  for (const [url, recorded] of Object.entries(index.responses ?? {})) {
    responses.set(url, { ...recorded, directory: path });
  }
  return responses;
}

/** Recorded-payload reader. An unlisted URL is a failure, not an empty result:
 *  a fixture set that forgot a source must not look like a clean probe. */
export async function fixtureFetcher(directory) {
  const responses = await loadFixtureIndex(directory);
  return async (request) => {
    const recorded = responses.get(request.url);
    if (recorded === undefined) return { ok: false, reason: `no recorded fixture for ${request.url}` };
    if ((recorded.status ?? 200) >= 400 || recorded.bodyFile === undefined) {
      return { ok: false, reason: recorded.reason ?? `recorded status ${recorded.status ?? "unknown"}` };
    }
    const body = await readFile(join(recorded.directory, recorded.bodyFile), "utf8");
    return { ok: true, body, digest: createHash("sha256").update(body).digest("hex") };
  };
}

export function networkFetcher(env = process.env) {
  return async (request) => {
    const headers = { "user-agent": "cormidia-harness-freshness (+https://github.com/cormidia/Cormidia)" };
    if (request.url.startsWith("https://api.github.com/")) {
      headers.accept = "application/vnd.github+json";
      headers["x-github-api-version"] = "2022-11-28";
      if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
    } else if (request.accept === "json") {
      headers.accept = "application/json";
    }
    try {
      const response = await fetch(request.url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
      const body = await response.text();
      return { ok: true, body, digest: createHash("sha256").update(body).digest("hex") };
    } catch (error) {
      return { ok: false, reason: `request failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
}

export async function probe(options, fetcher) {
  const [metadataText, supportText] = await Promise.all([
    readFile(options.metadata, "utf8"),
    readFile(options.support, "utf8"),
  ]);
  const metadata = JSON.parse(metadataText);
  const bands = readHarnessBands(supportText, options.support);
  const requests = plannedRequests(metadata);
  const responses = new Map();
  for (const request of requests) responses.set(request.url, await fetcher(request));
  const generatedAt = options.now ?? new Date().toISOString();
  return diffUpstream({ metadata, bands, responses, generatedAt, observedAt: generatedAt.slice(0, 10) });
}

async function git(root, args) {
  const { stdout } = await execFile("git", ["-C", root, ...args], { encoding: "utf8" });
  return stdout.trim();
}

/** Fail-closed: the working tree may differ from HEAD only in the one file the
 *  probe is allowed to write. Anything else means something edited a surface
 *  automation must never touch, and the run stops before a commit exists. */
export function assertOnlyWritablePaths(changed) {
  const forbidden = changed.filter((path) => path !== WRITABLE_METADATA_PATH);
  if (forbidden.length === 0) return;
  const ratified = forbidden.filter((path) => PROTECTED_PATHS.some((guard) => path.startsWith(guard)));
  throw new Error(
    `refusing to commit: the probe may only write ${WRITABLE_METADATA_PATH}, but the tree also changed ` +
      `${forbidden.join(", ")}${ratified.length > 0 ? ` (HUMAN-RATIFIED: ${ratified.join(", ")})` : ""}`,
  );
}

async function writeMetadata(options, metadata) {
  await writeFile(options.metadata, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (!options.format) return false;
  try {
    await execFile(join(options.root, "node_modules", ".bin", "biome"), ["format", "--write", options.metadata]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exactly ONE pull request: the head branch is stable, so a second run updates
 * the open request instead of opening a rival. Never merges, never approves.
 */
async function openPullRequest(options, body) {
  const base = await execFile("gh", ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], {
    cwd: options.root,
    encoding: "utf8",
  }).then(({ stdout }) => stdout.trim());
  if (base === "") throw new Error("could not resolve the remote default branch; refusing to guess one");

  const changed = (await git(options.root, ["diff", "--name-only"])).split("\n").filter(Boolean);
  assertOnlyWritablePaths(changed);
  if (changed.length === 0) return { opened: false, reason: "no metadata change to publish" };

  // Outside the repository on purpose: the pull request carries one file, and a
  // stray report in the worktree would be one more thing to explain away.
  const bodyFile = join(await mkdtemp(join(tmpdir(), "cormidia-freshness-pr-")), "body.md");
  await writeFile(bodyFile, body, "utf8");
  await git(options.root, ["checkout", "-B", BRANCH]);
  await git(options.root, ["add", WRITABLE_METADATA_PATH]);
  await git(options.root, [
    "commit",
    "-m",
    `${PR_TITLE}\n\nRefs #332. Automated probe; human review and merge required.`,
  ]);
  await git(options.root, ["push", "--force-with-lease", "-u", "origin", BRANCH]);

  const existing = await execFile(
    "gh",
    ["pr", "list", "--head", BRANCH, "--state", "open", "--json", "url", "-q", ".[0].url"],
    { cwd: options.root, encoding: "utf8" },
  ).then(({ stdout }) => stdout.trim());
  if (existing !== "") {
    await execFile("gh", ["pr", "edit", existing, "--body-file", bodyFile], { cwd: options.root });
    return { opened: true, url: existing, updated: true };
  }
  const { stdout } = await execFile(
    "gh",
    ["pr", "create", "--base", base, "--head", BRANCH, "--title", PR_TITLE, "--body-file", bodyFile],
    { cwd: options.root, encoding: "utf8" },
  );
  return { opened: true, url: stdout.trim(), updated: false };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fetcher = options.fixtures === undefined ? networkFetcher() : await fixtureFetcher(options.fixtures);
  const { report, metadata } = await probe(options, fetcher);
  const rendered = renderReport(report);

  if (options.apply && report.metadataChanged && report.status !== "failed") {
    report.formatted = await writeMetadata(options, metadata);
  }
  if (options.dryRunPr) {
    report.pullRequestPlan = {
      branch: BRANCH,
      title: PR_TITLE,
      wouldOpen: report.metadataChanged && report.status !== "failed",
      writablePath: WRITABLE_METADATA_PATH,
      protectedPaths: PROTECTED_PATHS,
    };
  } else if (options.openPr && report.status !== "failed" && report.metadataChanged) {
    report.pullRequest = await openPullRequest(options, rendered);
  }

  if (options.out !== undefined) await writeFile(options.out, rendered, "utf8");
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${rendered}\n`);
  process.exitCode = exitCodeFor(report.status);
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`harness freshness probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
