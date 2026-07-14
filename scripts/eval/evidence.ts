import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SECRET_PATTERNS } from "../../src/runtime/secret-patterns.js";
import {
  hashFile,
  hashManifest,
  loadYamlFile,
  type CampaignManifest,
} from "./core.js";

const ARCHIVE_POLICY = "sanitized-evidence/v1" as const;
const ARCHIVE_KIND = "sanitized-evidence" as const;
const EXCLUDED_ROOTS = ["provider-scratch/**"] as const;
const RETAINED_DIRECTORIES = new Set([
  "artifact",
  "cleanup",
  "errors",
  "grader",
  "results",
  "soak",
  "state",
  "world",
]);
const WORLD_EXCLUDED_SEGMENTS = new Set([".eval-harness", ".git", "node_modules"]);

export interface ArchiveManifest {
  schema_version: 2;
  archive_kind: typeof ARCHIVE_KIND;
  policy_version: typeof ARCHIVE_POLICY;
  campaign_id: string;
  campaign_sha256: string;
  archived_at: string;
  excluded_roots: string[];
  files: Record<string, string>;
}

interface ArchiveReceipt {
  schema_version: 2;
  archive_kind: typeof ARCHIVE_KIND;
  policy_version: typeof ARCHIVE_POLICY;
  campaign_id: string;
  campaign_sha256: string;
  destination: string;
  archive_manifest_sha256: string;
  archived_at: string;
}

export function archiveCampaignEvidence(options: {
  campaign: CampaignManifest;
  campaignRoot: string;
  outRoot: string;
  now?: Date;
}): { destination: string; manifest: ArchiveManifest } {
  const campaignRoot = resolve(options.campaignRoot);
  if (!existsSync(campaignRoot)) throw new Error("campaign_evidence_not_found");
  const suffix = hashManifest(options.campaign).slice(7, 15);
  const destination = resolve(
    options.outRoot,
    `${options.campaign.campaign_id}-${suffix}-evidence-v2`,
  );
  if (inside(campaignRoot, destination) || inside(destination, campaignRoot)) {
    throw new Error("archive_destination_must_be_external");
  }
  if (existsSync(destination)) throw new Error("archive_destination_exists");

  // Preflight before creating a final destination: unknown evidence classes,
  // links, special files, binary files, and secret-bearing selected evidence
  // all fail closed. Provider scratch is excluded structurally and is never
  // inspected or copied.
  const before = selectedEvidenceInventory(campaignRoot);
  const staging = `${destination}.tmp-${String(process.pid)}`;
  if (existsSync(staging)) throw new Error("archive_staging_exists");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const [rel] of before) {
      const source = join(campaignRoot, rel);
      const target = join(staging, rel);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }

    // Refuse a moving source tree rather than producing a receipt for a
    // mixture of pre- and post-mutation evidence.
    const after = selectedEvidenceInventory(campaignRoot);
    if (!sameInventory(before, after)) throw new Error("archive_source_changed_during_copy");
    const copied = genericInventory(staging);
    if (!sameInventory(before, copied)) throw new Error("archive_copy_verification_failed");

    const manifest: ArchiveManifest = {
      schema_version: 2,
      archive_kind: ARCHIVE_KIND,
      policy_version: ARCHIVE_POLICY,
      campaign_id: options.campaign.campaign_id,
      campaign_sha256: hashManifest(options.campaign),
      archived_at: (options.now ?? new Date()).toISOString(),
      excluded_roots: [...EXCLUDED_ROOTS],
      files: Object.fromEntries(before),
    };
    writePrivateJson(join(staging, "archive-manifest.json"), manifest);
    renameSync(staging, destination);

    const receipt: ArchiveReceipt = {
      schema_version: 2,
      archive_kind: ARCHIVE_KIND,
      policy_version: ARCHIVE_POLICY,
      campaign_id: options.campaign.campaign_id,
      campaign_sha256: hashManifest(options.campaign),
      destination,
      archive_manifest_sha256: `sha256:${hashFile(join(destination, "archive-manifest.json"))}`,
      archived_at: manifest.archived_at,
    };
    writePrivateJson(
      join(campaignRoot, `archive-receipt-v2-${suffix}.json`),
      receipt,
    );
    return { destination, manifest };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupCampaignPlan(
  campaignRoot: string,
  campaignId: string,
): { removable: string[]; preserved: string[]; archive_receipts: string[] } {
  const root = resolve(campaignRoot);
  const removable = [join(root, "world"), join(root, "provider-scratch")].filter(existsSync);
  for (const path of removable) if (!inside(root, path)) throw new Error("cleanup_path_escape");
  const archiveReceipts = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^archive-receipt-v2-[a-f0-9]{8}\.json$/.test(name))
        .map((name) => join(root, name))
        .filter((path) => validArchiveReceipt(path, campaignId, root))
    : [];
  return {
    removable,
    preserved: [
      "campaign.yaml",
      "campaign.lock.json",
      "github-evidence-*.json",
      "github-idempotence-*.json",
      "readiness-*.json",
      "results/",
      "grader/",
      "artifact/",
      "errors/",
      "cleanup/",
      "soak/",
      "state/",
      "report*.html",
      "archive-receipt-v2-*.json",
      `archive identity for ${campaignId}`,
    ],
    archive_receipts: archiveReceipts,
  };
}

export function executeCleanup(
  plan: { removable: string[]; archive_receipts?: string[] },
  campaignRoot: string,
): string[] {
  const root = resolve(campaignRoot);
  if (plan.removable.length > 0 && (plan.archive_receipts?.length ?? 0) === 0) {
    throw new Error("cleanup_requires_verified_archive");
  }
  for (const path of plan.removable) {
    if (!inside(root, path)) throw new Error("cleanup_path_escape");
    rmSync(path, { recursive: true, force: false });
  }
  return [...plan.removable];
}

function selectedEvidenceInventory(root: string): Array<[string, string]> {
  const entries = readdirSync(root, { withFileTypes: true });
  const selected: string[] = [];
  for (const entry of entries) {
    const name = entry.name;
    const absolute = join(root, name);
    if (entry.isSymbolicLink()) throw new Error(`archive_symlink_forbidden: ${name}`);
    if (name === "provider-scratch" || /^archive-receipt(?:-v2)?-/.test(name)) continue;
    if (entry.isDirectory()) {
      if (!RETAINED_DIRECTORIES.has(name)) {
        throw new Error(`archive_unknown_evidence_class: ${name}`);
      }
      visitSelected(absolute, name, selected);
      continue;
    }
    if (!entry.isFile() || !statSync(absolute).isFile()) {
      throw new Error(`archive_special_file_forbidden: ${name}`);
    }
    if (!retainedTopLevelFile(name)) {
      throw new Error(`archive_unknown_evidence_class: ${name}`);
    }
    selected.push(name);
  }
  selected.sort();
  return selected.map((rel) => {
    const path = join(root, rel);
    preflightTextEvidence(path, rel);
    return [rel, `sha256:${hashFile(path)}`];
  });
}

function visitSelected(directory: string, relDirectory: string, selected: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const rel = join(relDirectory, entry.name);
    if (
      relDirectory === "world" ||
      relDirectory.startsWith(`world${sep}`)
    ) {
      const segments = rel.split(sep);
      if (segments.some((segment) => WORLD_EXCLUDED_SEGMENTS.has(segment))) continue;
    }
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`archive_symlink_forbidden: ${rel}`);
    if (entry.isDirectory()) visitSelected(absolute, rel, selected);
    else if (entry.isFile() && lstatSync(absolute).isFile()) selected.push(rel);
    else throw new Error(`archive_special_file_forbidden: ${rel}`);
  }
}

function retainedTopLevelFile(name: string): boolean {
  return name === "campaign.yaml" ||
    name === "campaign.lock.json" ||
    /^github-evidence-[a-f0-9]{8}\.json$/.test(name) ||
    /^github-idempotence-[a-f0-9]{8}\.json$/.test(name) ||
    /^readiness-[a-f0-9]{8}-(?:passed|failed)\.json$/.test(name) ||
    /^report[^/]*\.html$/.test(name);
}

function preflightTextEvidence(path: string, rel: string): void {
  const bytes = readFileSync(path);
  if (bytes.includes(0)) throw new Error(`archive_binary_file_forbidden: ${rel}`);
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0) {
    throw new Error(`archive_non_utf8_file_forbidden: ${rel}`);
  }
  for (const secret of SECRET_PATTERNS) {
    if (secret.pattern.test(text)) {
      throw new Error(`archive_secret_pattern_forbidden:${secret.name}:${rel}`);
    }
  }
}

function genericInventory(root: string): Array<[string, string]> {
  const files: string[] = [];
  visit(root, "");
  files.sort();
  return files.map((rel) => [rel, `sha256:${hashFile(join(root, rel))}`]);

  function visit(directory: string, relDirectory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = relDirectory === "" ? entry.name : join(relDirectory, entry.name);
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`archive_symlink_forbidden: ${rel}`);
      if (entry.isDirectory()) visit(path, rel);
      else if (entry.isFile() && statSync(path).isFile()) files.push(rel);
      else throw new Error(`archive_special_file_forbidden: ${rel}`);
    }
  }
}

function validArchiveReceipt(path: string, campaignId: string, campaignRoot: string): boolean {
  try {
    const receipt = JSON.parse(readFileSync(path, "utf8")) as Partial<ArchiveReceipt>;
    if (
      receipt.schema_version !== 2 ||
      receipt.archive_kind !== ARCHIVE_KIND ||
      receipt.policy_version !== ARCHIVE_POLICY ||
      receipt.campaign_id !== campaignId ||
      typeof receipt.campaign_sha256 !== "string" ||
      typeof receipt.destination !== "string" ||
      !isAbsolute(receipt.destination) ||
      typeof receipt.archive_manifest_sha256 !== "string"
    ) return false;
    const manifestPath = join(receipt.destination, "archive-manifest.json");
    if (
      !existsSync(manifestPath) ||
      `sha256:${hashFile(manifestPath)}` !== receipt.archive_manifest_sha256
    ) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<ArchiveManifest>;
    if (
      manifest.schema_version !== 2 ||
      manifest.archive_kind !== ARCHIVE_KIND ||
      manifest.policy_version !== ARCHIVE_POLICY ||
      manifest.campaign_id !== campaignId ||
      manifest.campaign_sha256 !== receipt.campaign_sha256 ||
      !Array.isArray(manifest.excluded_roots) ||
      !manifest.excluded_roots.includes("provider-scratch/**") ||
      manifest.files === null ||
      typeof manifest.files !== "object" ||
      Array.isArray(manifest.files)
    ) return false;
    const campaign = loadYamlFile(join(campaignRoot, "campaign.yaml")) as CampaignManifest;
    if (hashManifest(campaign) !== receipt.campaign_sha256) return false;
    const archiveFiles = genericInventory(receipt.destination)
      .filter(([rel]) => rel !== "archive-manifest.json");
    const manifestFiles = Object.entries(manifest.files as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));
    if (manifestFiles.some(([rel]) => unsafeManifestPath(rel))) return false;
    if (!sameInventory(manifestFiles, archiveFiles)) return false;
    return sameInventory(selectedEvidenceInventory(campaignRoot), manifestFiles);
  } catch {
    return false;
  }
}

function unsafeManifestPath(path: string): boolean {
  if (path === "" || isAbsolute(path)) return true;
  const normalized = path.split(/[\\/]+/);
  return normalized.includes("..") || normalized[0] === "provider-scratch";
}

function sameInventory(
  left: Array<[string, string]>,
  right: Array<[string, string]>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every(([path, hash], index) =>
    right[index]?.[0] === path && right[index]?.[1] === hash);
}

function writePrivateJson(path: string, value: unknown): void {
  let fd: number;
  fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
