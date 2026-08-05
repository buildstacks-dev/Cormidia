#!/usr/bin/env node

// Offline RQ-1 release verifier used by both the tag workflow and
// prepublishOnly. It never creates a tag, publishes, or invokes a provider.

import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  packageManifestFromTarball,
  parseReleaseTagMessage,
  validateReleaseApprovalAuthority,
  validateReleaseCommitLineage,
  validateReleaseRepositoryState,
  verifyReleasePacket,
} from "../dist/org/release-evidence.js";
import { loadApps } from "../dist/org/apps.js";

const execFile = promisify(execFileCallback);

async function main() {
  const repo = process.cwd();
  const tag = required(process.env.CORMIDIA_RELEASE_TAG ?? process.env.GITHUB_REF_NAME, "CORMIDIA_RELEASE_TAG or GITHUB_REF_NAME");
  const tarball = absolute(required(process.env.CORMIDIA_RELEASE_TARBALL, "CORMIDIA_RELEASE_TARBALL"));
  const head = await git(repo, ["rev-parse", "HEAD"]);
  const tagCommit = await git(repo, ["rev-list", "-n", "1", `refs/tags/${tag}`]);
  if (tagCommit !== head) throw new Error(`release tag ${tag} does not target current HEAD`);
  const tagMessage = process.env.CORMIDIA_RELEASE_TAG_MESSAGE === undefined
    ? await git(repo, ["for-each-ref", `refs/tags/${tag}`, "--format=%(contents)"], false)
    : await readFile(absolute(process.env.CORMIDIA_RELEASE_TAG_MESSAGE), "utf8");
  const envelope = parseReleaseTagMessage(tagMessage);
  const packet = process.env.CORMIDIA_RELEASE_PACKET === undefined
    ? join(repo, "release-evidence", envelope.attestation.package_version, envelope.attestation.qualification_id)
    : absolute(process.env.CORMIDIA_RELEASE_PACKET);
  const currentPackage = await packageManifestFromTarball(tarball);
  const result = await verifyReleasePacket({
    packetDir: packet,
    currentCommit: head,
    currentTag: tag,
    currentPackage,
    attestation: envelope.attestation,
    approval: envelope.approval,
  });
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("release publication verification requires the GitHub Actions tag-push identity");
  }
  const authenticatedActor = required(process.env.CORMIDIA_RELEASE_ACTOR, "CORMIDIA_RELEASE_ACTOR");
  const authenticatedRepository = required(process.env.CORMIDIA_RELEASE_REPOSITORY, "CORMIDIA_RELEASE_REPOSITORY");
  const apps = await loadApps(join(repo, ".cormidia", "config.yaml"));
  const app = apps.apps.find((item) => item.repo === authenticatedRepository);
  if (app === undefined) throw new Error("authenticated release repository is not registered in .cormidia/config.yaml");
  validateReleaseApprovalAuthority({
    approval: result.approval,
    authenticatedActor,
    authenticatedRepository,
    manifestRepository: result.manifest.repository,
    configuredApprovers: app.release?.approvers ?? [],
  });
  await git(repo, ["merge-base", "--is-ancestor", result.manifest.candidate_commit, head]);
  const changed = (await git(repo, ["diff", "--name-only", "-z", `${result.manifest.candidate_commit}..${head}`], false)).split("\0").filter(Boolean);
  validateReleaseCommitLineage(result.manifest, result.attestation, changed);
  await validateReleaseRepositoryState(repo, result.manifest);
  process.stdout.write(`${JSON.stringify({
    contract_id: "RQ-1",
    qualification_id: result.manifest.qualification_id,
    package: `${result.manifest.package.name}@${result.manifest.package.version}`,
    tag,
    qualification: result.report.outcome.qualification,
    approved_by: result.approval.approved_by,
  }, null, 2)}\n`);
}

async function git(repo, args, trim = true) {
  try {
    const result = await execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return trim ? result.stdout.trim() : result.stdout;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`release verification git ${args[0] ?? "command"} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`release verification requires ${name}`);
  return value;
}

function absolute(value) {
  if (!isAbsolute(value)) throw new Error(`release verification path must be absolute: ${value}`);
  return resolve(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
