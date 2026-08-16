import { execFileSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  GENERATED_VIEW_RELATIVE_PATHS,
  HOST_POLICY_RELATIVE_PATH,
  selectValidationAuthority,
  type ValidationAuthoritySelection,
} from "../fixtures/validation-authority.js";
import { assertNoDirtyCampaignProductPaths } from "./repository-cleanliness.js";

export type CampaignRepositoryRevalidator = () => Promise<void>;

export interface CampaignRepositoryAdmissionSnapshot {
  root: string;
  commit: string;
  configuredPolicyPath: string;
  policyPath: string;
  validationAuthority: ValidationAuthoritySelection;
  validationAuthorityPaths: string[];
  generatedViewPaths: string[];
  trackedInputs: Array<{ configured: string; canonical: string }>;
}

/** Repeats every mutable repository fact used by campaign admission. */
export function createCampaignRepositoryRevalidator(
  admitted: CampaignRepositoryAdmissionSnapshot,
): CampaignRepositoryRevalidator {
  return async () => {
    const head = git(admitted.root, ["rev-parse", "HEAD"]);
    if (head !== admitted.commit)
      throw new Error(`campaign refused: authorized commit ${admitted.commit} does not equal checked-out HEAD ${head}`);
    assertNoDirtyCampaignProductPaths(admitted.root);

    await assertRepositoryRegularFile(admitted.root, join(admitted.root, HOST_POLICY_RELATIVE_PATH), "host policy");
    const policyPath = await exactRealpath(admitted.configuredPolicyPath, "host policy");
    if (policyPath !== admitted.policyPath) throw new Error("campaign refused: canonical host policy path changed");
    await assertTrackedBlob(
      admitted.root,
      admitted.commit,
      join(admitted.root, HOST_POLICY_RELATIVE_PATH),
      "host policy",
    );

    const selected = selectValidationAuthority(admitted.root);
    if (
      selected.kind !== admitted.validationAuthority.kind ||
      JSON.stringify(selected.paths) !== JSON.stringify(admitted.validationAuthority.paths)
    )
      throw new Error("campaign refused: selected validation authority changed after admission");
    for (const [index, relativePath] of selected.paths.entries()) {
      const lexical = join(admitted.root, relativePath);
      await assertRepositoryRegularFile(admitted.root, lexical, "validation authority");
      const path = await exactRealpath(lexical, "validation authority");
      if (path !== admitted.validationAuthorityPaths[index])
        throw new Error(`campaign refused: validation authority path changed: ${relativePath}`);
      await assertTrackedBlob(admitted.root, admitted.commit, lexical, "validation authority");
    }
    if (selected.kind === "model") {
      for (const [index, relativePath] of GENERATED_VIEW_RELATIVE_PATHS.entries()) {
        const lexical = join(admitted.root, relativePath);
        await assertRepositoryRegularFile(admitted.root, lexical, "generated validation view");
        const path = await exactRealpath(lexical, "generated validation view");
        if (path !== admitted.generatedViewPaths[index])
          throw new Error(`campaign refused: generated validation view path changed: ${relativePath}`);
        await assertTrackedBlob(admitted.root, admitted.commit, lexical, "generated validation view");
      }
    }
    for (const input of admitted.trackedInputs) {
      const path = await exactRealpath(input.configured, "campaign input");
      if (path !== input.canonical) throw new Error("campaign refused: tracked input path changed after admission");
      await assertRepositoryRegularFile(admitted.root, path, "campaign input");
      await assertTrackedBlob(admitted.root, admitted.commit, path, "campaign input");
    }
  };
}

/** Refuses a symlink in any repository-relative path component. */
export async function assertRepositoryRegularFile(root: string, path: string, name: string): Promise<void> {
  const repoRelative = repositoryRelativePath(root, path, name);
  const components = repoRelative.split(sep);
  for (const [index] of components.entries()) {
    const candidate = join(root, ...components.slice(0, index + 1));
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(candidate);
    } catch {
      throw new Error(`campaign refused: ${name} is missing or unreadable`);
    }
    if (entry.isSymbolicLink()) throw new Error(`campaign refused: ${name} path contains a symlink: ${repoRelative}`);
    const final = index === components.length - 1;
    if ((final && !entry.isFile()) || (!final && !entry.isDirectory()))
      throw new Error(`campaign refused: ${name} must be a regular repository file`);
  }
}

export async function assertTrackedBlob(root: string, commit: string, path: string, name: string): Promise<void> {
  const repoRelative = repositoryRelativePath(root, path, name);
  let committedOid: string;
  try {
    committedOid = git(root, ["rev-parse", `${commit}:${repoRelative}`]);
  } catch {
    throw new Error(`campaign refused: ${name} is not tracked at the authorized commit: ${repoRelative}`);
  }
  const workingOid = git(root, ["hash-object", "--", path]);
  if (workingOid !== committedOid)
    throw new Error(`campaign refused: ${name} differs from the authorized commit: ${repoRelative}`);
}

/** Reads an admitted input from the immutable authorized commit. */
export function readCommittedBlob(root: string, commit: string, path: string, name: string): Buffer {
  const repoRelative = repositoryRelativePath(root, path, name);
  try {
    return execFileSync("git", ["show", `${commit}:${repoRelative}`], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`campaign refused: ${name} is not tracked at the authorized commit: ${repoRelative}`);
  }
}

async function exactRealpath(path: string, name: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new Error(`campaign refused: ${name} is missing or no longer resolves`);
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repositoryRelativePath(root: string, path: string, name: string): string {
  const repoRelative = relative(root, path);
  if (repoRelative === "" || repoRelative === ".." || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative))
    throw new Error(`campaign refused: ${name} is outside the authorized repository`);
  return repoRelative;
}
