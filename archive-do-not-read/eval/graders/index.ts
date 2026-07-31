import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { calibrateGrader } from "../../scripts/eval/core.js";
import { grade as gradeContinuation } from "./continuation.js";
import { grade as gradeLearning } from "./learning-closure.js";
import { grade as gradeScheduler } from "./scheduler-soak.js";
import { grade as gradeStandard } from "./standard-slug-options.js";
import { grade as gradeRouteCorpus } from "./route-corpus.js";
import { grade as gradePlanQuality } from "./plan-quality.js";
import { grade as gradeContextDelta } from "./context-delta.js";
import { grade as gradeApprovalSemantics } from "./approval-semantics.js";
import { grade as gradeStandingRoles } from "./standing-roles.js";
import { grade as gradeAdapterCalibration } from "./adapter-calibration.js";

export interface GraderCalibrationResult { grader_id: string; reference_passed: true; rejected_mutants: string[] }

export async function calibrateCommittedGraders(evalRoot: string): Promise<GraderCalibrationResult[]> {
  return [
    await calibratePatch(evalRoot, "sparse", "sparse-lifecycle/v1", gradeSparse),
    await calibratePatch(evalRoot, "library", "quick-ignore-config/v1", gradeLibrary),
    await calibratePatch(evalRoot, "service", "deep-auth/v1", gradeService),
    await calibrateStandalonePatch(evalRoot, "library", "standard-slug-options/v1", "standard-slug-options", gradeStandard),
    calibrateEvidence(evalRoot, "continuation/v1", "continuation", gradeContinuation),
    calibrateEvidence(evalRoot, "learning-closure/v1", "learning-closure", gradeLearning),
    calibrateEvidence(evalRoot, "scheduler-soak/v1", "scheduler-soak", gradeScheduler),
    calibrateEvidence(evalRoot, "route-corpus/v1", "route-corpus", gradeRouteCorpus),
    calibrateEvidence(evalRoot, "plan-quality/v1", "plan-quality", gradePlanQuality),
    calibrateEvidence(evalRoot, "context-delta/v1", "context-delta", gradeContextDelta),
    calibrateEvidence(evalRoot, "approval-semantics/v1", "approval-semantics", gradeApprovalSemantics),
    calibrateEvidence(evalRoot, "standing-roles/v1", "standing-roles", gradeStandingRoles),
    calibrateEvidence(evalRoot, "adapter-calibration/v1", "adapter-calibration", gradeAdapterCalibration),
  ];
}

function calibrateEvidence(evalRoot: string, graderId: string, name: string, grade: (root: string) => boolean): GraderCalibrationResult {
  const root = join(evalRoot, "graders", name);
  const mutantsRoot = join(root, "mutants");
  const mutants = readDirectories(mutantsRoot).map((id) => ({ id, subject: join(mutantsRoot, id) }));
  return calibrateGrader({ graderId, reference: join(root, "reference"), mutants, grade });
}

async function calibrateStandalonePatch(evalRoot: string, app: string, graderId: string, name: string, grade: (root: string) => boolean | Promise<boolean>): Promise<GraderCalibrationResult> {
  const dir = join(evalRoot, "graders", name); const seed = join(evalRoot, "apps", app, "seed");
  const reference = materialize(seed, join(dir, "reference.patch"));
  const mutants = readdirSync(join(dir, "mutants"), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".patch")).map((entry) => ({ id: entry.name, subject: materialize(seed, join(dir, "mutants", entry.name)) }));
  try {
    const referencePassed = await grade(reference); const mutantGrades = await Promise.all(mutants.map(async (mutant) => ({ ...mutant, passed: await grade(mutant.subject) })));
    return calibrateGrader({ graderId, reference: referencePassed, mutants: mutantGrades.map((mutant) => ({ id: mutant.id, subject: mutant.passed })), grade: (passed) => passed });
  } finally { rmSync(reference, { recursive: true, force: true }); for (const mutant of mutants) rmSync(mutant.subject, { recursive: true, force: true }); }
}

async function calibratePatch(evalRoot: string, app: string, graderId: string, grade: (root: string) => boolean | Promise<boolean>): Promise<GraderCalibrationResult> {
  const manifest = parse(readFileSync(join(evalRoot, "apps", app, "manifest.yaml"), "utf8")) as { reference_patch: string; mutants: string[] };
  const seed = join(evalRoot, "apps", app, "seed");
  const graderDir = join(evalRoot, "apps", app);
  const reference = materialize(seed, resolve(graderDir, manifest.reference_patch));
  const mutants = manifest.mutants.map((path, index) => ({ id: `mutant-${index + 1}`, subject: materialize(seed, resolve(graderDir, path)) }));
  try {
    const referencePassed = await grade(reference);
    const mutantGrades = await Promise.all(mutants.map(async (mutant) => ({ ...mutant, passed: await grade(mutant.subject) })));
    return calibrateGrader({ graderId, reference: referencePassed, mutants: mutantGrades.map((mutant) => ({ id: mutant.id, subject: mutant.passed })), grade: (passed) => passed });
  } finally {
    rmSync(reference, { recursive: true, force: true });
    for (const mutant of mutants) rmSync(mutant.subject, { recursive: true, force: true });
  }
}

function materialize(seed: string, patch: string): string {
  const root = mkdtempSync(join(tmpdir(), "operon-grader-"));
  cpSync(seed, root, { recursive: true });
  execFileSync("git", ["apply", "--unsafe-paths", patch], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}
export function gradeSparse(root: string): boolean {
  const value = parse(readFileSync(join(root, ".operon/config.yaml"), "utf8")) as Record<string, unknown>;
  return value.schema_version === 1 && value.status === "onboarding" && value.checkout_branch === "human/topic";
}
export function gradeLibrary(root: string): boolean {
  const lines = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/).filter(Boolean);
  return lines.includes(".pnpm-store/") && !lines.some((line) => line.includes("*"));
}
export async function gradeService(root: string): Promise<boolean> {
  const moduleUrl = `${pathToFileURL(join(root, "src/auth.js")).href}?calibration=${encodeURIComponent(root)}`;
  const imported = await import(moduleUrl) as { normalizeApiKey(value: string): string };
  const first = imported.normalizeApiKey(" Eval-Secret "); const second = imported.normalizeApiKey(" Eval-Secret ");
  return first === second && /^[a-f0-9]{64}$/.test(first) && !first.includes("Eval-Secret");
}

function readDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
