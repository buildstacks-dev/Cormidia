import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  assessReleaseQualification,
  assertSanitizedEvidence,
  canonicalJson,
  createReleaseAttestation,
  createReleaseManifest,
  createReleaseTagMessage,
  evaluateDeterministicAdmission,
  evaluateL4Evidence,
  evaluateTriggeredCampaignEvidence,
  packageManifestFromTarball,
  parseReleaseManifest,
  parseReleaseTagMessage,
  releaseRepositorySnapshot,
  sha256,
  validateReleaseApproval,
  validateReleaseAttestation,
  validateReleaseCommitLineage,
  validateReleaseQualificationReport,
  validateReleaseRepositoryState,
  validateReleaseToolchain,
  validateQualificationEvidenceBundle,
  verifyReleasePacket,
  type EvaluatorDebtDispositionV1,
  type EvidenceChangeDispositionV1,
  type DeterministicEvidenceV1,
  type L4ReleaseEvidenceV1,
  type ReleaseActionV1,
  type ReleaseLaneResultV1,
  type ReleaseCampaignEvidenceV1,
  type ReleaseManifestBodyV1,
  type ReleaseManifestV1,
  type ReleaseTagEnvelopeV1,
} from "../org/release-evidence.js";

const execFile = promisify(execFileCallback);

export async function cmdRelease(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  if (verb === "package-manifest") return packageManifest(rest);
  if (verb === "snapshot") return snapshot(rest);
  if (verb === "prepare") return prepare(rest);
  if (verb === "assess") return assess(rest);
  if (verb === "attest") return attest(rest);
  if (verb === "tag-message") return tagMessage(rest);
  if (verb === "verify") return verify(rest);
  throw new Error(
    `release: expected package-manifest, snapshot, prepare, assess, attest, tag-message, or verify; got ${verb ?? "nothing"}`,
  );
}

async function packageManifest(args: string[]): Promise<number> {
  const flags = parse(args, ["tarball", "output"]);
  const manifest = await packageManifestFromTarball(flags.values.tarball!);
  await writeImmutableJson(flags.values.output!, manifest);
  print(flags.json, { output: flags.values.output, package: manifest });
  return 0;
}

async function snapshot(args: string[]): Promise<number> {
  const flags = parse(args, ["repo", "output"]);
  const repo = flags.values.repo!;
  await assertCleanTrackedHead(repo);
  const head = await git(repo, ["rev-parse", "HEAD"]);
  const value = await releaseRepositorySnapshot(repo, head);
  await writeImmutableJson(flags.values.output!, value);
  print(flags.json, {
    output: flags.values.output,
    candidate_commit: head,
    golden_references: value.golden_references.length,
  });
  return 0;
}

async function prepare(args: string[]): Promise<number> {
  const flags = parse(args, ["repo", "input", "tarball", "output"]);
  const repo = flags.values.repo!;
  await assertCleanTrackedHead(repo);
  const head = await git(repo, ["rev-parse", "HEAD"]);
  const value = await readJson(flags.values.input!);
  const actualPackage = await packageManifestFromTarball(flags.values.tarball!);
  const body = value as ReleaseManifestBodyV1;
  if (body.candidate_commit !== head) throw new Error("release prepare input candidate_commit is not repository HEAD");
  if (canonicalJson(body.package) !== canonicalJson(actualPackage))
    throw new Error("release prepare input package differs from supplied tarball");
  await validateReleaseRepositoryState(repo, body);
  await validateReleaseToolchain(repo, body);
  const manifest = createReleaseManifest(body);
  await writeImmutableJson(flags.values.output!, manifest);
  print(flags.json, {
    output: flags.values.output,
    qualification_id: manifest.qualification_id,
    candidate_commit: manifest.candidate_commit,
  });
  return 0;
}

async function assess(args: string[]): Promise<number> {
  const flags = parse(
    args,
    ["manifest", "deterministic-evidence", "l4-evidence", "campaign-evidence", "generated-at", "output"],
    ["debt-dispositions", "evidence-change-dispositions"],
  );
  const manifest = parseReleaseManifest(await readFile(flags.values.manifest!, "utf8"));
  const deterministic = evaluateDeterministicAdmission(
    manifest,
    (await readJson(flags.values["deterministic-evidence"]!)) as DeterministicEvidenceV1,
  );
  const l4 = evaluateL4Evidence(manifest, normalizeL4Evidence(manifest, await readJson(flags.values["l4-evidence"]!)));
  const triggered = evaluateTriggeredCampaignEvidence(
    manifest,
    (await readJson(flags.values["campaign-evidence"]!)) as ReleaseCampaignEvidenceV1,
  );
  const laneResults: ReleaseLaneResultV1[] = [deterministic, ...triggered, l4];
  const debts =
    flags.values["debt-dispositions"] === undefined
      ? []
      : await readArray<EvaluatorDebtDispositionV1>(flags.values["debt-dispositions"], "debt dispositions");
  const evidenceChanges =
    flags.values["evidence-change-dispositions"] === undefined
      ? []
      : await readArray<EvidenceChangeDispositionV1>(
          flags.values["evidence-change-dispositions"],
          "evidence change dispositions",
        );
  const report = assessReleaseQualification({
    manifest,
    laneResults,
    debtDispositions: debts,
    evidenceChangeDispositions: evidenceChanges,
    generatedAt: flags.values["generated-at"]!,
  });
  await writeImmutableJson(flags.values.output!, report);
  print(flags.json, { output: flags.values.output, ...report.outcome });
  return report.outcome.qualification === "qualified" ? 0 : report.outcome.qualification === "not_qualified" ? 1 : 2;
}

async function attest(args: string[]): Promise<number> {
  const flags = parse(args, [
    "repo",
    "packet",
    "release-commit",
    "tag",
    "tarball",
    "release-action",
    "created-at",
    "output",
  ]);
  const repo = flags.values.repo!;
  await assertCleanTrackedHead(repo);
  const head = await git(repo, ["rev-parse", "HEAD"]);
  if (head !== flags.values["release-commit"]) throw new Error("release attest release-commit is not repository HEAD");
  const packet = flags.values.packet!;
  const manifest = parseReleaseManifest(await readFile(join(packet, "release-manifest.json"), "utf8"));
  await validateReleaseRepositoryState(repo, manifest);
  const reportValue = await readJson(join(packet, "qualification-report.json"));
  validateReleaseQualificationReport(reportValue, manifest);
  validateQualificationEvidenceBundle({
    manifest,
    report: reportValue,
    deterministic: (await readJson(join(packet, "deterministic-results.json"))) as DeterministicEvidenceV1,
    l4: (await readJson(join(packet, "l4-results.json"))) as L4ReleaseEvidenceV1,
    campaigns: (await readJson(join(packet, "campaign-index.json"))) as ReleaseCampaignEvidenceV1,
  });
  const currentPackage = await packageManifestFromTarball(flags.values.tarball!);
  if (canonicalJson(currentPackage) !== canonicalJson(manifest.package))
    throw new Error("release attest package bytes differ from prepared manifest");
  await git(repo, ["merge-base", "--is-ancestor", manifest.candidate_commit, head]);
  const changed = (await git(repo, ["diff", "--name-only", "-z", `${manifest.candidate_commit}..${head}`], false))
    .split("\0")
    .filter(Boolean);
  const packetFiles = await collectPacketFiles(packet);
  const action = await readJson(flags.values["release-action"]!);
  const attestation = createReleaseAttestation({
    manifest,
    report: reportValue,
    releaseCommit: head,
    tag: flags.values.tag!,
    changedPaths: changed,
    packetFiles,
    releaseAction: action as ReleaseActionV1,
    createdAt: flags.values["created-at"]!,
  });
  await writeImmutableJson(flags.values.output!, attestation);
  print(flags.json, {
    output: flags.values.output,
    attestation_sha256: sha256(canonicalJson(attestation)),
    release_action_sha256: attestation.release_action_sha256,
  });
  return 0;
}

async function tagMessage(args: string[]): Promise<number> {
  const flags = parse(args, ["attestation", "approval", "output"]);
  const attestation = await readJson(flags.values.attestation!);
  const approval = await readJson(flags.values.approval!);
  validateReleaseAttestation(attestation);
  validateReleaseApproval(approval);
  await writeImmutableText(flags.values.output!, createReleaseTagMessage(attestation, approval));
  print(flags.json, {
    output: flags.values.output,
    tag: attestation.tag,
    attestation_sha256: sha256(canonicalJson(attestation)),
  });
  return 0;
}

async function verify(args: string[]): Promise<number> {
  const flags = parse(args, ["repo", "packet", "tag", "tarball"], ["tag-message"]);
  const currentCommit = await git(flags.values.repo!, ["rev-parse", "HEAD"]);
  const currentPackage = await packageManifestFromTarball(flags.values.tarball!);
  const external: ReleaseTagEnvelopeV1 | undefined =
    flags.values["tag-message"] === undefined
      ? undefined
      : parseReleaseTagMessage(await readFile(flags.values["tag-message"], "utf8"));
  const result = await verifyReleasePacket({
    packetDir: flags.values.packet!,
    currentCommit,
    currentTag: flags.values.tag!,
    currentPackage,
    ...(external === undefined ? {} : { attestation: external.attestation, approval: external.approval }),
  });
  await git(flags.values.repo!, ["merge-base", "--is-ancestor", result.manifest.candidate_commit, currentCommit]);
  const changed = (
    await git(
      flags.values.repo!,
      ["diff", "--name-only", "-z", `${result.manifest.candidate_commit}..${currentCommit}`],
      false,
    )
  )
    .split("\0")
    .filter(Boolean);
  validateReleaseCommitLineage(result.manifest, result.attestation, changed);
  await validateReleaseRepositoryState(flags.values.repo!, result.manifest);
  print(flags.json, {
    qualification_id: result.manifest.qualification_id,
    package: `${result.manifest.package.name}@${result.manifest.package.version}`,
    tag: result.attestation.tag,
    qualification: result.report.outcome.qualification,
    approved_by: result.approval.approved_by,
  });
  return 0;
}

async function collectPacketFiles(packetDir: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const entries = await readdir(packetDir, { withFileTypes: true });
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error(`release packet contains non-file entry ${entry.name}`);
    if (entry.name === "release-attestation.json" || entry.name === "release-approval.json")
      throw new Error("release attest requires attestation and approval outside the committed packet");
    const path = join(packetDir, entry.name);
    const bytes = await readFile(path);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    assertSanitizedEvidence(value, entry.name);
    files.push({ path: entry.name, size: bytes.length, sha256: sha256(bytes) });
  }
  return files;
}

async function assertCleanTrackedHead(repo: string): Promise<void> {
  const status = await git(repo, ["status", "--porcelain=v1", "--untracked-files=no"], false);
  if (status.length > 0) throw new Error("release operation requires a clean tracked repository state");
}

async function git(repo: string, args: string[], trim = true): Promise<string> {
  try {
    const result = await execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return trim ? result.stdout.trim() : result.stdout;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr)
        : "";
    throw new Error(
      `release git ${args[0] ?? "command"} failed${stderr.trim().length > 0 ? `: ${stderr.trim()}` : ""}`,
    );
  }
}

function parse(
  args: string[],
  required: string[],
  optional: string[] = [],
): { values: Record<string, string | undefined>; json: boolean } {
  const allowed = new Set([...required, ...optional]);
  const scalarValues = new Set(["tag", "generated-at", "created-at", "release-commit"]);
  const values: Record<string, string | undefined> = {};
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`release: unexpected positional argument ${arg}`);
    const key = arg.slice(2);
    if (!allowed.has(key)) throw new Error(`release: unknown argument ${arg}`);
    if (values[key] !== undefined) throw new Error(`release: duplicate argument ${arg}`);
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`release: ${arg} requires a value`);
    if (!scalarValues.has(key) && !isAbsolute(value)) throw new Error(`release: ${arg} must be an absolute path`);
    values[key] = scalarValues.has(key) ? value : resolve(value);
  }
  for (const key of required) if (values[key] === undefined) throw new Error(`release: --${key} is required`);
  return { values, json };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readArray<T>(path: string, name: string): Promise<T[]> {
  const value = await readJson(path);
  if (!Array.isArray(value)) throw new Error(`${name} must be a JSON array`);
  return value as T[];
}

function normalizeL4Evidence(manifest: ReleaseManifestV1, value: unknown): L4ReleaseEvidenceV1 {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "qualification_id" in value)
    return value as L4ReleaseEvidenceV1;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>)["observations"])
  )
    throw new Error("L4 evidence must be an RQ-1 evidence object or eval-results.json");
  const raw = value as Record<string, unknown>;
  if (typeof raw["producer_digest"] !== "string" || !/^[a-f0-9]{64}$/.test(raw["producer_digest"])) {
    throw new Error("eval-results.json lacks its execution-time producer digest");
  }
  const observations = (raw["observations"] as Array<Record<string, unknown>>).map((row) => ({
    pairing_id: row["tuple_id"],
    case_id: row["case_id"],
    attempt_id: row["attempt_id"],
    output_sha256: row["output_sha256"],
    grading_digest: row["grading_key"],
    grade_reused_from: row["grade_reused_from"],
    automatic_score_used: row["automatic_score_used"],
    outcome: row["outcome"],
    evidence_ref: row["evidence_ref"],
  })) as L4ReleaseEvidenceV1["observations"];
  const obligation = manifest.obligations.find((item) => item.lane === "L4");
  if (obligation === undefined) throw new Error("release manifest lacks L4 obligation");
  return {
    schema_version: 1,
    qualification_id: manifest.qualification_id,
    subject_digest: obligation.subject_digest,
    producer_digest: raw["producer_digest"],
    observations,
  };
}

async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  await writeImmutableText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeImmutableText(path: string, contents: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await link(temporary, target);
  } catch (error) {
    if (isExists(error)) throw new Error(`release evidence is immutable and already exists: ${target}`);
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function isExists(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST"
  );
}

function print(json: boolean, value: Record<string, unknown>): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else
    for (const [key, item] of Object.entries(value))
      console.log(`${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
}
