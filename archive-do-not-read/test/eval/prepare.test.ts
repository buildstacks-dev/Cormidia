import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertPreparedCandidate, candidateIdentity, currentCandidateSnapshot, hashWorkingFiles, type CandidateSnapshot } from "../../scripts/eval/candidate-hash.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("J-MAN-01 candidate hashing includes tracked deletions deterministically instead of crashing", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-prepare-")); roots.push(root);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  writeFileSync(join(root, "deleted.txt"), "old\n"); writeFileSync(join(root, "kept.txt"), "kept\n");
  execFileSync("git", ["add", "-A"], { cwd: root }); execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@invalid", "commit", "-m", "seed"], { cwd: root });
  unlinkSync(join(root, "deleted.txt"));
  const first = hashWorkingFiles(root); const second = hashWorkingFiles(root);
  expect(first).toMatch(/^[a-f0-9]{64}$/); expect(second).toBe(first);
  writeFileSync(join(root, "deleted.txt"), "replacement\n");
  expect(hashWorkingFiles(root)).not.toBe(first);
});

it("J-MAN-02 prepared execution fails closed when package or suite bytes drift", () => {
  const root = mkdtempSync(join(tmpdir(), "operon-eval-candidate-drift-")); roots.push(root);
  for (const dir of ["dist", "eval", "scripts/eval", "test", "prompts", "taste"]) mkdirSync(join(root, dir), { recursive: true });
  for (const [path, content] of [
    ["package.json", '{"name":"candidate-fixture","version":"1.0.0","files":["dist/**/*.js"],"packageManager":"pnpm@11.10.0","dependencies":{}}\n'],
    ["dist/cli.js", "export {};\n"],
    ["roles.yaml", "roles: []\n"],
    ["pipelines.yaml", "pipelines: []\n"],
    ["TASTE.md", "# Test\n"],
    ["eval/case.yaml", "schema_version: 1\n"],
    ["scripts/eval/run.ts", "export {};\n"],
    ["test/run.test.ts", "export {};\n"],
    ["prompts/pass.md", "test\n"],
    ["taste/builder.md", "test\n"],
  ] as const) writeFileSync(join(root, path), content);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Eval", "-c", "user.email=eval@invalid", "commit", "-m", "seed"], { cwd: root });
  const expected = currentCandidateSnapshot(root);
  const campaign = { candidate: { commit: expected.commit, package_sha256: expected.package_sha256, suite_sha256: expected.suite_sha256, ...(expected.release_package_sha256 !== undefined ? { release_package_sha256: expected.release_package_sha256 } : {}), ...(expected.executable_suite_sha256 !== undefined ? { executable_suite_sha256: expected.executable_suite_sha256 } : {}) }, org_fingerprint: expected.org_fingerprint, system_fingerprint: expected.system_fingerprint };
  expect(assertPreparedCandidate(root, campaign)).toEqual(expected);
  writeFileSync(join(root, "test/run.test.ts"), "export const drift = true;\n");
  expect(() => assertPreparedCandidate(root, campaign)).toThrow(/prepared_candidate_drift:.*package_sha256.*suite_sha256.*executable_suite_sha256/);
  writeFileSync(join(root, "test/run.test.ts"), "export {};\n");
  writeFileSync(join(root, "dist/cli.js"), "export const shippedDrift = true;\n");
  expect(() => assertPreparedCandidate(root, campaign)).toThrow(/prepared_candidate_drift:.*package_sha256.*release_package_sha256/);
});

it("J-MAN-02 preparation identity changes when any execution-pinned candidate dimension changes", () => {
  const digest = (character: string) => `sha256:${character.repeat(64)}`;
  const snapshot: CandidateSnapshot = {
    commit: "candidate+dirty",
    package_sha256: digest("a"),
    suite_sha256: digest("b"),
    org_fingerprint: digest("c"),
    system_fingerprint: digest("d"),
    release_package_sha256: digest("e"),
    executable_suite_sha256: digest("f"),
  };
  const identity = candidateIdentity(snapshot);

  expect(identity).toMatch(/^[a-f0-9]{12}$/);
  expect(candidateIdentity({ ...snapshot })).toBe(identity);
  for (const [field, value] of [
    ["commit", "other+dirty"],
    ["package_sha256", digest("e")],
    ["suite_sha256", digest("f")],
    ["org_fingerprint", digest("0")],
    ["system_fingerprint", digest("1")],
    ["release_package_sha256", digest("2")],
    ["executable_suite_sha256", digest("3")],
  ] as const) {
    expect(candidateIdentity({ ...snapshot, [field]: value })).not.toBe(identity);
  }
});
