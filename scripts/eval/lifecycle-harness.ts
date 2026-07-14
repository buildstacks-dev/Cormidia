import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { hashFile, hashTree, sha256 } from "./core.js";

export interface LifecycleWorld {
  root: string;
  org: string;
  state: string;
  app: string;
  managed: string;
  remote: string;
  archives: string;
}
export interface MechanicalRecord { id: string; status: "completed" | "refused"; terminal_records: 1; provider_settlements: 0; reason?: string }
export interface LifecycleReplayResult {
  refusal_blockers: string[];
  archive_sha256: string;
  recovered_answers: Record<string, unknown>;
  branch_refusal: string;
  source_before: string;
  source_after: string;
  source_git_before: SourceGitSnapshot;
  source_git_after: SourceGitSnapshot;
  second_app_unchanged: boolean;
  provider_constructions: 0;
  provider_settlements: 0;
  mechanical_steps: MechanicalRecord[];
  readiness: { status: "ready"; app_status: "live"; authority_sha256: string; config_sha256: string; managed_head: string };
  idempotent_rerun: true;
}
export interface SourceGitSnapshot { branch: string; head: string; status: string; tracked_sha256: string; untracked_sha256: string }

export function createLifecycleWorld(root: string): LifecycleWorld {
  const world = { root, org: join(root, "org"), state: join(root, "state"), app: join(root, "apps", "sparse"), managed: join(root, "managed", "sparse"), remote: join(root, "remote"), archives: join(root, "archives") };
  for (const path of Object.values(world)) mkdirSync(path, { recursive: true });
  writeYaml(join(world.org, "org.yaml"), { schema_version: 0, name: "Operon-Eval-Lifecycle" });
  writeYaml(join(world.org, "apps.yaml"), { schema_version: 1, apps: [{ name: "sparse", status: "onboarding" }, { name: "second", status: "live" }] });
  writeFileSync(join(world.org, "AUTHORITY.md"), "# Eval authority\n", "utf8");
  writeFileSync(join(world.org, "second-app.sentinel"), "untouched\n", "utf8");
  writeJson(join(world.state, "approvals", "pending", "eval-only.json"), { id: "eval-only", app: "sparse", status: "pending" });
  writeJson(join(world.state, "runs", "sparse", "stale", "envelope.json"), { run_id: "stale", status: "running", heartbeat_at: "2026-07-01T00:00:00.000Z" });
  writeJson(join(world.state, "apps", "sparse", "answers.json"), { name: "sparse", repo: "eval/sparse", authority: { mode: "inherit" }, setup_command: "npm test" });
  writeFileSync(join(world.app, "tracked.txt"), "tracked input\n", "utf8");
  execFileSync("git", ["init", "--initial-branch=human/topic"], { cwd: world.app, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "add", "tracked.txt"], { cwd: world.app });
  execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "eval human checkout"], { cwd: world.app, stdio: "ignore" });
  writeFileSync(join(world.app, "untracked.txt"), "untracked input\n", "utf8");
  writeFileSync(join(world.remote, "reachable-refs.json"), "[]\n", "utf8");
  return world;
}

export function runLifecycleReplay(world: LifecycleWorld, providerFactory: () => never): LifecycleReplayResult {
  void providerFactory; // The deterministic lane carries a tripwire but never constructs it.
  const records: MechanicalRecord[] = [];
  const sourceBefore = hashTree(world.app);
  const sourceGitBefore = sourceGitSnapshot(world.app);
  const secondBefore = hashFile(join(world.org, "second-app.sentinel"));
  const blockers = resetPreview(world);
  records.push(record("reset-preview-refusal", "refused", blockers.join(",")));
  if (!blockers.includes("pending_approval:eval-only") || !blockers.includes("stale_run:stale")) throw new Error("lifecycle_refusal_missing_blocker");
  rmSync(join(world.state, "approvals", "pending", "eval-only.json"));
  writeJson(join(world.state, "approvals", "decided", "eval-only.json"), { id: "eval-only", app: "sparse", status: "archived_eval_fixture" });
  const stalePath = join(world.state, "runs", "sparse", "stale", "envelope.json");
  writeJson(stalePath, { run_id: "stale", status: "cancelled", reason: "stale_reconciled" });
  records.push(record("resolve-blockers", "completed"));
  if (resetPreview(world).length !== 0) throw new Error("lifecycle_reset_still_blocked");
  const archive = executeReset(world);
  records.push(record("reset-execute", "completed"));
  const answers = recoverAnswers(archive.path);
  records.push(record("answers-recover", "completed"));
  upgradeOrg(world, "inherit");
  records.push(record("org-upgrade", "completed"));
  const onboardingCommit = bootstrapWithoutMutatingSource(world, answers);
  records.push(record("bootstrap", "completed"));
  const branchRefusal = verifyReachability(world, onboardingCommit);
  if (branchRefusal !== "unreachable_onboarding_commit") throw new Error("lifecycle_branch_mismatch_not_refused");
  records.push(record("verify-unreachable", "refused", branchRefusal));
  writeJson(join(world.remote, "reachable-refs.json"), [onboardingCommit]);
  synchronizeManaged(world, onboardingCommit);
  records.push(record("managed-sync", "completed"));
  const verified = verifyApp(world, onboardingCommit);
  records.push(record("app-verify", "completed"));
  promote(world, false);
  promote(world, true);
  records.push(record("app-promote", "completed"));
  const readiness = readinessEvidence(world, onboardingCommit, verified);
  records.push(record("projection-readiness", "completed"));
  // Safe commands are deliberately repeated. No archive, ref, or registry
  // side effect may duplicate.
  if (resetPreview(world).length !== 0) throw new Error("lifecycle_idempotent_preview_failed");
  synchronizeManaged(world, onboardingCommit);
  promote(world, true);
  verifyApp(world, onboardingCommit);
  const sourceAfter = hashTree(world.app);
  const sourceGitAfter = sourceGitSnapshot(world.app);
  const secondAfter = hashFile(join(world.org, "second-app.sentinel"));
  return { refusal_blockers: blockers, archive_sha256: archive.sha256, recovered_answers: answers, branch_refusal: branchRefusal, source_before: sourceBefore, source_after: sourceAfter, source_git_before: sourceGitBefore, source_git_after: sourceGitAfter, second_app_unchanged: secondBefore === secondAfter, provider_constructions: 0, provider_settlements: 0, mechanical_steps: records, readiness, idempotent_rerun: true };
}

export function recoverAnswers(archivePath: string): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(archivePath, "manifest.json"), "utf8")) as { answers_sha256: string };
  const path = join(archivePath, "answers.json");
  if (`sha256:${hashFile(path)}` !== manifest.answers_sha256) throw new Error("archive_checksum_mismatch");
  const answers = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const rendered = JSON.stringify(answers).toLowerCase();
  if (/token|password|secret|api[_-]?key/.test(rendered)) throw new Error("secret_like_onboarding_answer_forbidden");
  return answers;
}

function resetPreview(world: LifecycleWorld): string[] {
  const blockers: string[] = [];
  const pending = join(world.state, "approvals", "pending");
  for (const name of existsSync(pending) ? readdirSync(pending).sort() : []) blockers.push(`pending_approval:${basename(name, ".json")}`);
  const runs = join(world.state, "runs", "sparse");
  for (const name of existsSync(runs) ? readdirSync(runs).sort() : []) {
    const envelope = JSON.parse(readFileSync(join(runs, name, "envelope.json"), "utf8")) as { status?: string; run_id?: string };
    if (envelope.status === "running") blockers.push(`stale_run:${envelope.run_id ?? name}`);
  }
  return blockers;
}
function executeReset(world: LifecycleWorld): { path: string; sha256: string } {
  const answersPath = join(world.state, "apps", "sparse", "answers.json");
  const archive = join(world.archives, "sparse-reset-v1");
  if (!existsSync(archive)) {
    mkdirSync(archive, { recursive: true });
    cpSync(answersPath, join(archive, "answers.json"));
    writeJson(join(archive, "manifest.json"), { schema_version: 1, app: "sparse", answers_sha256: `sha256:${hashFile(join(archive, "answers.json"))}` });
  }
  rmSync(join(world.state, "apps", "sparse"), { recursive: true, force: true });
  rmSync(join(world.state, "runs", "sparse"), { recursive: true, force: true });
  return { path: archive, sha256: hashTree(archive) };
}
function upgradeOrg(world: LifecycleWorld, authorityChoice: string): void { writeYaml(join(world.org, "org.yaml"), { schema_version: 1, name: "Operon-Eval-Lifecycle", authority_choice: authorityChoice }); }
function bootstrapWithoutMutatingSource(world: LifecycleWorld, answers: Record<string, unknown>): string {
  const commit = sha256(`${hashTree(world.app)}\0${JSON.stringify(answers)}`);
  writeYaml(join(world.org, "sparse.generated.yaml"), { schema_version: 1, status: "onboarding", checkout_branch: "human/topic", onboarding_commit: commit });
  return commit;
}
function verifyReachability(world: LifecycleWorld, commit: string): string {
  const refs = JSON.parse(readFileSync(join(world.remote, "reachable-refs.json"), "utf8")) as string[];
  return refs.includes(commit) ? "reachable" : "unreachable_onboarding_commit";
}
function synchronizeManaged(world: LifecycleWorld, commit: string): void { writeFileAtomic(join(world.managed, "HEAD"), `${commit}\n`); }
function verifyApp(world: LifecycleWorld, commit: string): { authority_sha256: string; config_sha256: string } {
  if (verifyReachability(world, commit) !== "reachable") throw new Error("unreachable_onboarding_commit");
  if (readFileSync(join(world.managed, "HEAD"), "utf8").trim() !== commit) throw new Error("managed_clone_head_mismatch");
  const config = parse(readFileSync(join(world.org, "sparse.generated.yaml"), "utf8")) as { schema_version?: number };
  if (config.schema_version !== 1) throw new Error("generated_config_invalid");
  return { authority_sha256: `sha256:${hashFile(join(world.org, "AUTHORITY.md"))}`, config_sha256: `sha256:${hashFile(join(world.org, "sparse.generated.yaml"))}` };
}
function promote(world: LifecycleWorld, execute: boolean): void {
  if (!execute) return;
  const path = join(world.org, "sparse.generated.yaml");
  const config = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (config.status === "live") return;
  writeFileAtomic(path, stringify({ ...config, status: "live" }, { lineWidth: 0 }));
}
function readinessEvidence(world: LifecycleWorld, commit: string, hashes: { authority_sha256: string; config_sha256: string }): LifecycleReplayResult["readiness"] {
  const status = (parse(readFileSync(join(world.org, "sparse.generated.yaml"), "utf8")) as { status?: string }).status;
  if (status !== "live") throw new Error("promotion_not_committed");
  return { status: "ready", app_status: "live", authority_sha256: hashes.authority_sha256, config_sha256: `sha256:${hashFile(join(world.org, "sparse.generated.yaml"))}`, managed_head: commit };
}
function record(id: string, status: MechanicalRecord["status"], reason?: string): MechanicalRecord { return { id, status, terminal_records: 1, provider_settlements: 0, ...(reason ? { reason } : {}) }; }
function writeJson(path: string, value: unknown): void { writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`); }
function writeYaml(path: string, value: unknown): void { writeFileAtomic(path, stringify(value, { lineWidth: 0 })); }
function writeFileAtomic(path: string, value: string): void { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.tmp`; writeFileSync(temp, value, "utf8"); renameSync(temp, path); }
function sourceGitSnapshot(root: string): SourceGitSnapshot { return { branch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(), head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), status: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }), tracked_sha256: `sha256:${hashFile(join(root, "tracked.txt"))}`, untracked_sha256: `sha256:${hashFile(join(root, "untracked.txt"))}` }; }
