// Fail-closed provenance binding for triggered validation campaigns. External
// authorization selects a commit; it cannot substitute an arbitrary policy or
// uncommitted golden set for the blobs reviewed at that commit.

import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export interface CampaignRepositoryBinding {
  commit: string;
  policyPath: string;
  trackedInputPaths?: string[];
  cwd?: string;
}

export async function assertCampaignRepositoryBinding(
  input: CampaignRepositoryBinding,
): Promise<{ root: string; policyPath: string; trackedInputPaths: string[] }> {
  const cwd = input.cwd ?? process.cwd();
  const root = await realpath(git(cwd, ["rev-parse", "--show-toplevel"]));
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== input.commit) {
    throw new Error(`campaign refused: authorized commit ${input.commit} does not equal checked-out HEAD ${head}`);
  }
  const canonicalPolicy = await realpath(join(root, "validation-design", "validation-policy.yaml"));
  const policyPath = await realpath(input.policyPath);
  if (policyPath !== canonicalPolicy) {
    throw new Error(`campaign refused: policy_path must be the canonical validation-design/validation-policy.yaml at HEAD`);
  }
  await assertTrackedBlob(root, input.commit, policyPath, "policy");
  const trackedInputPaths: string[] = [];
  for (const configured of input.trackedInputPaths ?? []) {
    if (!isAbsolute(configured)) throw new Error("campaign tracked input paths must be absolute");
    const path = await realpath(configured);
    await assertTrackedBlob(root, input.commit, path, "campaign input");
    trackedInputPaths.push(path);
  }
  return { root, policyPath, trackedInputPaths };
}

async function assertTrackedBlob(root: string, commit: string, path: string, name: string): Promise<void> {
  const repoRelative = relative(root, path);
  if (repoRelative === "" || repoRelative === ".." || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
    throw new Error(`campaign refused: ${name} is outside the authorized repository`);
  }
  let committedOid: string;
  try {
    committedOid = git(root, ["rev-parse", `${commit}:${repoRelative}`]);
  } catch {
    throw new Error(`campaign refused: ${name} is not tracked at the authorized commit: ${repoRelative}`);
  }
  const workingOid = git(root, ["hash-object", "--", path]);
  if (workingOid !== committedOid) {
    throw new Error(`campaign refused: ${name} differs from the authorized commit: ${repoRelative}`);
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
