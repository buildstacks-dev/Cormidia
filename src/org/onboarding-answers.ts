// Normalized onboarding answers are lifecycle inputs, not credentials. The
// durable copy is app-scoped state so reset can archive it without locating or
// touching a human checkout.

import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { SECRET_PATTERNS } from "../runtime/secret-patterns.js";
import type { BootstrapAnswers } from "./bootstrap.js";
import {
  LIFECYCLE_SCHEMA_VERSION,
  assertDirectoryNoSymlink,
  assertRegularFile,
  assertSafeRelativePath,
  assertSafeSegment,
  sha256,
  stableJson,
  writeLifecycleFileAtomic,
} from "./lifecycle.js";

export interface StoredOnboardingAnswers {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "onboarding-answers";
  app: string;
  answers: BootstrapAnswers;
  answers_sha256: string;
}

export interface OnboardingRecoverySource {
  app: string;
  answers: BootstrapAnswers;
}

export function onboardingAnswersPath(stateHome: string, app: string): string {
  assertSafeSegment(app, "onboarding answers app");
  return join(resolve(stateHome), "lifecycle", "apps", app, "answers.json");
}

/** Where a greenfield app was scaffolded, recorded so `operon app verify` can
 * synthesize a lifecycle record from the checkout's pushed remote. `new-app`
 * cannot write the full lifecycle record itself: at scaffold time there is no
 * commit, remote, or managed clone yet. This pointer captures the inputs verify
 * needs to build the record once the operator has pushed. */
export interface OnboardingSourceRecord {
  schema_version: typeof LIFECYCLE_SCHEMA_VERSION;
  kind: "onboarding-source";
  app: string;
  repo: string;
  checkout_path: string;
}

export function onboardingSourcePath(stateHome: string, app: string): string {
  assertSafeSegment(app, "onboarding source app");
  return join(resolve(stateHome), "lifecycle", "apps", app, "onboarding-source.json");
}

export async function storeOnboardingSource(
  stateHome: string,
  app: string,
  input: { repo: string; checkoutPath: string },
): Promise<OnboardingSourceRecord> {
  const record: OnboardingSourceRecord = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "onboarding-source",
    app,
    repo: input.repo,
    checkout_path: resolve(input.checkoutPath),
  };
  await writeLifecycleFileAtomic(onboardingSourcePath(stateHome, app), stableJson(record));
  return record;
}

export async function readOnboardingSource(
  stateHome: string,
  app: string,
): Promise<OnboardingSourceRecord | undefined> {
  const path = onboardingSourcePath(stateHome, app);
  if (!existsSync(path)) return undefined;
  await assertRegularFile(path, "onboarding source");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`onboarding source: invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = value as Partial<OnboardingSourceRecord>;
  if (
    record.schema_version !== LIFECYCLE_SCHEMA_VERSION ||
    record.kind !== "onboarding-source" ||
    record.app !== app ||
    typeof record.repo !== "string" ||
    typeof record.checkout_path !== "string"
  ) {
    throw new Error(`onboarding source: invalid record ${path}`);
  }
  return record as OnboardingSourceRecord;
}

export function assertNonSecretOnboardingAnswers(answers: BootstrapAnswers): void {
  const rendered = stableJson(answers);
  const matched = SECRET_PATTERNS.find((candidate) => candidate.pattern.test(rendered));
  if (matched !== undefined) {
    throw new Error(`bootstrap answers: secret-like value forbidden (${matched.name})`);
  }
}

export async function storeOnboardingAnswers(
  stateHome: string,
  app: string,
  answers: BootstrapAnswers,
): Promise<StoredOnboardingAnswers> {
  assertNonSecretOnboardingAnswers(answers);
  const answersBytes = stableJson(answers);
  const record: StoredOnboardingAnswers = {
    schema_version: LIFECYCLE_SCHEMA_VERSION,
    kind: "onboarding-answers",
    app,
    answers,
    answers_sha256: `sha256:${sha256(answersBytes)}`,
  };
  await writeLifecycleFileAtomic(onboardingAnswersPath(stateHome, app), stableJson(record));
  return record;
}

export async function readStoredOnboardingAnswers(stateHome: string, app: string): Promise<BootstrapAnswers> {
  const path = onboardingAnswersPath(stateHome, app);
  await assertRegularFile(path, "stored onboarding answers");
  const record = parseStoredAnswers(await readFile(path, "utf8"), path);
  if (record.app !== app) throw new Error(`bootstrap --answers-from: app mismatch in ${path}`);
  return record.answers;
}

export async function readAnswersFrom(sourceIn: string, stateHome: string): Promise<BootstrapAnswers> {
  return (await readOnboardingRecoverySource(sourceIn, stateHome)).answers;
}

export async function readOnboardingRecoverySource(
  sourceIn: string,
  stateHome: string,
  options: { archiveRoot?: string } = {},
): Promise<OnboardingRecoverySource> {
  const source = resolve(sourceIn);
  if (existsSync(source)) {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`bootstrap --answers-from: symlink source forbidden: ${source}`);
    if (info.isFile()) {
      const record = parseStoredAnswers(await readFile(source, "utf8"), source);
      return { app: record.app, answers: record.answers };
    }
    if (!info.isDirectory()) throw new Error(`bootstrap --answers-from: unsupported source: ${source}`);
    await assertDirectoryNoSymlink(source, "bootstrap answers source");
    const appOwned = join(source, ".operon", "onboarding-answers.json");
    if (existsSync(appOwned)) {
      await assertRegularFile(appOwned, "app onboarding answers");
      const record = parseStoredAnswers(await readFile(appOwned, "utf8"), appOwned);
      return { app: record.app, answers: record.answers };
    }
    const archiveManifest = join(source, "manifest.json");
    if (existsSync(archiveManifest)) {
      const answers = await readAnswersFromResetArchive(source);
      const manifest = JSON.parse(await readFile(archiveManifest, "utf8")) as Record<string, unknown>;
      const app = manifest["app"] as Record<string, unknown> | undefined;
      if (typeof app?.["name"] !== "string") throw new Error("bootstrap --answers-from: reset archive has no app identity");
      return { app: app["name"], answers };
    }
    throw new Error(`bootstrap --answers-from: no onboarding answers found under ${source}`);
  }
  // A simple safe segment is an app name in the selected isolated state home.
  assertSafeSegment(sourceIn, "bootstrap --answers-from app");
  const answersPath = onboardingAnswersPath(stateHome, sourceIn);
  if (!existsSync(answersPath) && options.archiveRoot !== undefined) {
    const archive = await latestResetArchiveForApp(resolve(options.archiveRoot), sourceIn);
    if (archive !== undefined) return readOnboardingRecoverySource(archive, stateHome);
  }
  await assertRegularFile(answersPath, "stored onboarding answers");
  const record = parseStoredAnswers(await readFile(answersPath, "utf8"), answersPath);
  if (record.app !== sourceIn) throw new Error(`bootstrap --answers-from: app mismatch in ${answersPath}`);
  return { app: record.app, answers: record.answers };
}

export async function readAnswersFromResetArchive(archiveIn: string): Promise<BootstrapAnswers> {
  const archive = await assertDirectoryNoSymlink(resolve(archiveIn), "reset archive");
  const manifestPath = join(archive, "manifest.json");
  await assertRegularFile(manifestPath, "reset archive manifest");
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  if (raw["kind"] !== "app-reset" || raw["schema_version"] !== LIFECYCLE_SCHEMA_VERSION) {
    throw new Error(`bootstrap --answers-from: unsupported reset archive manifest ${manifestPath}`);
  }
  const files = raw["files"];
  if (!Array.isArray(files)) throw new Error(`bootstrap --answers-from: archive files manifest missing`);
  const declared: string[] = [];
  for (const item of files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("bootstrap --answers-from: invalid archive file entry");
    const spec = item as Record<string, unknown>;
    if (typeof spec["path"] !== "string" || typeof spec["sha256"] !== "string" || typeof spec["bytes"] !== "number") {
      throw new Error("bootstrap --answers-from: invalid archive file entry");
    }
    assertSafeRelativePath(spec["path"], "reset archive file");
    declared.push(spec["path"]);
    const path = join(archive, spec["path"]);
    await assertRegularFile(path, "reset archive file");
    const content = await readFile(path);
    if (content.byteLength !== spec["bytes"] || sha256(content) !== spec["sha256"]) {
      throw new Error(`bootstrap --answers-from: archive checksum mismatch for ${spec["path"]}`);
    }
  }
  const actual = (await resetArchivePaths(archive)).filter((path) => path !== "manifest.json").sort();
  if (stableJson(actual) !== stableJson(declared.sort())) {
    throw new Error("bootstrap --answers-from: archive contains unchecksummed or missing paths");
  }
  const answersEntry = files.find(
    (item) => item && typeof item === "object" && (item as Record<string, unknown>)["path"] === "answers.json",
  ) as Record<string, unknown> | undefined;
  if (answersEntry === undefined) throw new Error("bootstrap --answers-from: reset archive has no normalized answers");
  const answersPath = join(archive, "answers.json");
  const record = parseStoredAnswers(await readFile(answersPath, "utf8"), answersPath);
  const app = raw["app"] as Record<string, unknown> | undefined;
  if (typeof app?.["name"] !== "string" || record.app !== app["name"]) {
    throw new Error("bootstrap --answers-from: reset archive app/answers mismatch");
  }
  return record.answers;
}

async function resetArchivePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`bootstrap --answers-from: symlink archive entry forbidden: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(relative(root, path));
      else throw new Error(`bootstrap --answers-from: unsupported archive entry: ${path}`);
    }
  }
  await visit(root);
  return paths.sort();
}

export async function latestResetArchiveForApp(archiveRoot: string, app: string): Promise<string | undefined> {
  assertSafeSegment(app, "reset archive app");
  if (!existsSync(archiveRoot)) return undefined;
  await assertDirectoryNoSymlink(resolve(archiveRoot), "reset archive root");
  const pointerPath = join(archiveRoot, `${app}-latest.json`);
  if (existsSync(pointerPath)) {
    await assertRegularFile(pointerPath, "reset archive latest pointer");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as Record<string, unknown>;
    if (
      pointer["schema_version"] !== LIFECYCLE_SCHEMA_VERSION ||
      pointer["kind"] !== "app-reset-latest" ||
      pointer["app"] !== app ||
      typeof pointer["archive_id"] !== "string" ||
      typeof pointer["manifest_sha256"] !== "string"
    ) throw new Error(`bootstrap --answers-from: corrupt reset archive pointer ${pointerPath}`);
    assertSafeSegment(pointer["archive_id"], "reset archive pointer");
    const selected = join(archiveRoot, pointer["archive_id"]);
    await assertDirectoryNoSymlink(selected, "reset archive pointer target");
    const manifest = await readFile(join(selected, "manifest.json"));
    if (sha256(manifest) !== pointer["manifest_sha256"]) {
      throw new Error(`bootstrap --answers-from: reset archive pointer checksum mismatch ${pointerPath}`);
    }
    return selected;
  }
  const candidates = (await readdir(archiveRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(`${app}-reset-`))
    .map((entry) => join(archiveRoot, entry.name))
    .sort();
  return candidates.at(-1);
}

function parseStoredAnswers(text: string, path: string): StoredOnboardingAnswers {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`bootstrap --answers-from: invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`bootstrap --answers-from: invalid onboarding answers record ${path}`);
  }
  const record = value as Partial<StoredOnboardingAnswers>;
  if (
    record.schema_version !== LIFECYCLE_SCHEMA_VERSION ||
    record.kind !== "onboarding-answers" ||
    typeof record.app !== "string" ||
    !record.answers ||
    typeof record.answers_sha256 !== "string"
  ) {
    throw new Error(`bootstrap --answers-from: invalid onboarding answers record ${path}`);
  }
  const calculated = `sha256:${sha256(stableJson(record.answers))}`;
  if (calculated !== record.answers_sha256) {
    throw new Error(`bootstrap --answers-from: onboarding answers checksum mismatch in ${basename(path)}`);
  }
  assertNonSecretOnboardingAnswers(record.answers);
  return record as StoredOnboardingAnswers;
}
