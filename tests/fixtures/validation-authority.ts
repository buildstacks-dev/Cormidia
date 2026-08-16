import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { QUALIFICATION_HOST_POLICY_PATH } from "../../src/org/qualification-host-policy.js";
import { VALIDATION_MODEL_PATHS } from "../../src/org/release-policy-authority.js";

export const HOST_POLICY_RELATIVE_PATH = QUALIFICATION_HOST_POLICY_PATH;
export const LEGACY_VALIDATION_POLICY_RELATIVE_PATH = "validation-design/validation-policy.yaml";
export const LEGACY_ROOT_AUTHORITY_RELATIVE_PATHS = [
  LEGACY_VALIDATION_POLICY_RELATIVE_PATH,
  "validation-design/case-catalog.yaml",
  "validation-design/case-catalog-generator.awk",
] as const;
export const MODEL_RELATIVE_PATHS = VALIDATION_MODEL_PATHS;
export const GENERATED_VIEW_RELATIVE_PATHS = [
  "validation-design/case-catalog.md",
  "validation-design/harness-backlog.md",
  "validation-design/owner-briefing.md",
  "validation-design/owner-backlog.md",
  "validation-design/planned-trace.md",
] as const;

export type ValidationAuthoritySelection =
  | { kind: "legacy"; paths: readonly [typeof LEGACY_VALIDATION_POLICY_RELATIVE_PATH] }
  | { kind: "model"; paths: typeof MODEL_RELATIVE_PATHS };

export class ValidationAuthorityError extends Error {
  constructor(message: string) {
    super(`validation authority refused: ${message}`);
    this.name = "ValidationAuthorityError";
  }
}

export interface CheckedModelCompile {
  revision: string;
  identity: string;
  views: Record<string, string>;
}

/**
 * Generated views are separately committed evidence, not compiler stdout.
 * Read them only after checked compilation and refuse dirty or missing bytes.
 */
export function readExactCommittedGeneratedViews(root: string, head: string): Record<string, string> {
  const views: Record<string, string> = {};
  for (const path of GENERATED_VIEW_RELATIVE_PATHS) {
    const absolute = join(resolve(root), path);
    const entry = lstatSync(absolute, { throwIfNoEntry: false });
    if (entry === undefined || !entry.isFile() || entry.isSymbolicLink()) {
      throw new ValidationAuthorityError(`generated view ${path} is missing or unsafe`);
    }
    const working = readFileSync(absolute, "utf8");
    let committed: string;
    try {
      committed = execFileSync("git", ["show", `${head}:${path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new ValidationAuthorityError(`generated view ${path} is not committed at ${head}`);
    }
    if (working !== committed) {
      throw new ValidationAuthorityError(`generated view ${path} differs from committed bytes at ${head}`);
    }
    views[path.slice("validation-design/".length)] = committed;
  }
  return views;
}

/**
 * The bounded #465 cutover rule. Zero checked-model files preserves the
 * temporary legacy bridge. The first exact checked-model file selects model
 * authority irrevocably, and all eight files must then be present as regular,
 * non-symlink files. Migration archives are deliberately outside this walk.
 */
export function selectValidationAuthority(root: string): ValidationAuthoritySelection {
  const absoluteRoot = resolve(root);
  const designRoot = join(absoluteRoot, "validation-design");
  const designRootEntry = lstatSync(designRoot, { throwIfNoEntry: false });
  if (designRootEntry === undefined || !designRootEntry.isDirectory() || designRootEntry.isSymbolicLink()) {
    throw new ValidationAuthorityError("validation-design is not a regular non-symlink directory");
  }
  const observed = MODEL_RELATIVE_PATHS.filter((path) =>
    lstatSync(join(absoluteRoot, path), { throwIfNoEntry: false }),
  );
  if (observed.length === 0) {
    const legacy = lstatSync(join(absoluteRoot, LEGACY_VALIDATION_POLICY_RELATIVE_PATH), { throwIfNoEntry: false });
    if (legacy === undefined || !legacy.isFile() || legacy.isSymbolicLink()) {
      throw new ValidationAuthorityError(
        `zero checked-model files requires ${LEGACY_VALIDATION_POLICY_RELATIVE_PATH} as a regular file`,
      );
    }
    return { kind: "legacy", paths: [LEGACY_VALIDATION_POLICY_RELATIVE_PATH] };
  }

  const modelRoot = join(designRoot, "model");
  const modelRootEntry = lstatSync(modelRoot, { throwIfNoEntry: false });
  if (modelRootEntry === undefined || !modelRootEntry.isDirectory() || modelRootEntry.isSymbolicLink()) {
    throw new ValidationAuthorityError("validation-design/model is not a regular directory");
  }
  const expectedNames = new Set(MODEL_RELATIVE_PATHS.map((path) => path.slice("validation-design/model/".length)));
  const unexpected = readdirSync(modelRoot, { withFileTypes: true })
    .filter((entry) => !expectedNames.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unexpected.length > 0) {
    throw new ValidationAuthorityError(`validation-design/model contains unexpected entries: ${unexpected.join(", ")}`);
  }

  const invalid = MODEL_RELATIVE_PATHS.filter((path) => {
    const entry = lstatSync(join(absoluteRoot, path), { throwIfNoEntry: false });
    return entry === undefined || !entry.isFile() || entry.isSymbolicLink();
  });
  if (invalid.length > 0) {
    throw new ValidationAuthorityError(
      `checked-model authority selected by ${observed.join(", ")}; exact eight-file set is incomplete or unsafe: ${invalid.join(", ")}`,
    );
  }
  const legacy = LEGACY_ROOT_AUTHORITY_RELATIVE_PATHS.filter(
    (path) => lstatSync(join(absoluteRoot, path), { throwIfNoEntry: false }) !== undefined,
  );
  if (legacy.length > 0) {
    throw new ValidationAuthorityError(
      `checked-model authority and legacy root inputs cannot coexist: ${legacy.join(", ")}`,
    );
  }
  return { kind: "model", paths: MODEL_RELATIVE_PATHS };
}

/** Installed public CLI over its real local RepositoryPort; never writes. */
export async function compileCheckedModel(root: string, productRevision: string): Promise<CheckedModelCompile> {
  const selection = selectValidationAuthority(root);
  if (selection.kind !== "model") {
    throw new ValidationAuthorityError(
      "public model compilation requested while the temporary legacy bridge is active",
    );
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const packageRoot = dirname(createRequire(import.meta.url).resolve("validation-architect/package.json"));
  const scratch = await mkdtemp(join(tmpdir(), "cormidia-va-compile-"));
  const admittedRoot = join(scratch, "repo");
  try {
    execFileSync("git", ["clone", "--no-hardlinks", "--quiet", root, admittedRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    git(admittedRoot, ["checkout", "--detach", "--quiet", head]);
    selectValidationAuthority(admittedRoot);
    const identity = runPublicCheckedCompiler(admittedRoot, productRevision, packageRoot);
    if (git(admittedRoot, ["rev-parse", "HEAD"]) !== head || git(root, ["rev-parse", "HEAD"]) !== head) {
      throw new ValidationAuthorityError("repository HEAD changed during public compilation");
    }
    const views = readExactCommittedGeneratedViews(admittedRoot, head);
    return { revision: productRevision, identity, views };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function runPublicCheckedCompiler(root: string, productRevision: string, packageRoot: string): string {
  const result = spawnSync(
    process.execPath,
    [join(packageRoot, "bin", "validation-architect.js"), "compile", resolve(root)],
    {
      encoding: "utf8",
    },
  );
  if (result.error !== undefined)
    throw new ValidationAuthorityError(`public compiler failed to spawn: ${result.error.message}`);
  if (result.stderr !== "") throw new ValidationAuthorityError(`public compiler wrote stderr: ${result.stderr.trim()}`);
  if (result.status !== 0) throw new ValidationAuthorityError(`public compiler exited ${String(result.status)}`);
  const accepted = /^accepted: model ([a-f0-9]{64}) at revision ([a-f0-9]{40})\n?$/.exec(result.stdout);
  if (accepted === null || accepted[2] !== productRevision) {
    throw new ValidationAuthorityError("public compiler did not accept the exact product revision");
  }
  const identity = accepted[1];
  if (identity === undefined) throw new ValidationAuthorityError("public compiler omitted its exact identity");
  return identity;
}

/** Matches the upstream CLI's product-revision rule for design-only commits. */
export function resolveValidationProductRevision(root: string, head: string): string {
  let revision = head;
  for (;;) {
    const row = git(root, ["rev-list", "--parents", "-n", "1", revision]).split(" ");
    const parent = row[1];
    if (parent === undefined) return revision;
    const changed = git(root, ["diff", "--no-renames", "--name-only", parent, revision])
      .split("\n")
      .filter((path) => path !== "");
    if (changed.some((path) => path !== "validation-design" && !path.startsWith("validation-design/"))) {
      return revision;
    }
    revision = parent;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
