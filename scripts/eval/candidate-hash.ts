import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFile, hashTree, sha256, type CampaignManifest } from "./core.js";

export interface CandidateSnapshot {
  commit: string;
  package_sha256: string;
  suite_sha256: string;
  org_fingerprint: string;
  system_fingerprint: string;
  release_package_sha256?: string;
  executable_suite_sha256?: string;
}

/** Stable short identity for every execution-pinned candidate dimension. */
export function candidateIdentity(snapshot: CandidateSnapshot): string {
  return sha256(JSON.stringify({ schema_version: 1, ...snapshot })).slice(0, 12);
}

/** Hash the exact tracked/untracked candidate view, including tracked deletes. */
export function hashWorkingFiles(cwd: string, prefixes: string[] = []): string {
  return hashSelectedWorkingFiles(cwd, (name) => prefixes.length === 0 || prefixes.some((prefix) => prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix));
}

export function releasePackageHash(cwd: string): string {
  const destination = mkdtempSync(join(tmpdir(), "operon-release-pack-"));
  try {
    const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const records = JSON.parse(output) as Array<{ filename?: unknown }>;
    const archives = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
    if (records.length !== 1 || typeof records[0]?.filename !== "string" || archives.length !== 1 || archives[0] !== records[0].filename || archives[0]!.includes("/") || archives[0]!.includes("\\")) throw new Error("release_package_inventory_invalid");
    return hashFile(join(destination, archives[0]!));
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

export function executableSuiteHash(cwd: string): string {
  return hashSelectedWorkingFiles(cwd, (name) =>
    name === ".github/workflows/efficiency-qualification.yml" ||
    name.startsWith("scripts/eval/") ||
    name.startsWith("test/") ||
    (name.startsWith("eval/") && name !== "eval/contracts.yaml"));
}

function hashSelectedWorkingFiles(cwd: string, include: (name: string) => boolean): string {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean).filter(include).sort();
  const chunks = names.map((name) => {
    const path = join(cwd, name);
    if (!existsSync(path)) return `${name}\0deleted`;
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error(`candidate_special_file_forbidden: ${name}`);
    return `${name}\0${stat.mode & 0o111 ? "x" : "-"}\0${sha256(readFileSync(path))}`;
  });
  return sha256(chunks.join("\n"));
}

/** Recompute every checkout-dependent value pinned by a prepared campaign. */
export function currentCandidateSnapshot(cwd: string): CandidateSnapshot {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  return {
    commit: dirty === "" ? commit : `${commit}+dirty`,
    package_sha256: `sha256:${hashWorkingFiles(cwd)}`,
    suite_sha256: `sha256:${sha256([hashTree(join(cwd, "eval")), hashTree(join(cwd, "scripts/eval")), hashTree(join(cwd, "test"))].join("\n"))}`,
    org_fingerprint: `sha256:${hashWorkingFiles(cwd, ["roles.yaml", "pipelines.yaml", "prompts/", "TASTE.md", "taste/"])}`,
    system_fingerprint: `sha256:${sha256(systemFingerprint(cwd))}`,
    release_package_sha256: `sha256:${releasePackageHash(cwd)}`,
    executable_suite_sha256: `sha256:${executableSuiteHash(cwd)}`,
  };
}

/** Fail before a campaign lock, GitHub mutation, or provider construction if
 * the prepared checkout/system identity no longer matches the live executor. */
export function assertPreparedCandidate(cwd: string, campaign: Pick<CampaignManifest, "candidate" | "org_fingerprint" | "system_fingerprint">): CandidateSnapshot {
  const current = currentCandidateSnapshot(cwd);
  const expected: CandidateSnapshot = { ...campaign.candidate, org_fingerprint: campaign.org_fingerprint, system_fingerprint: campaign.system_fingerprint };
  const drift = (Object.keys(expected) as Array<keyof CandidateSnapshot>).filter((key) => expected[key] !== current[key]);
  if (drift.length > 0) throw new Error(`prepared_candidate_drift:${drift.join(",")}`);
  return current;
}

function systemFingerprint(cwd: string): string {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { packageManager?: unknown; dependencies?: Record<string, string> };
  const dependencies = Object.entries(pkg.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const git = execFileSync("git", ["--version"], { cwd, encoding: "utf8" }).trim();
  const npm = execFileSync("npm", ["--version"], { cwd, encoding: "utf8" }).trim();
  return JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, git, npm, packageManager: pkg.packageManager, dependencies });
}
