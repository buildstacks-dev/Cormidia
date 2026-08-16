// CF-HARNESS-CI — HB-P7 — #465 exact vendor pin and fail-closed authority cutover.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const version = "0.4.2";
const artifactName = `validation-architect-${version}.tgz`;
const artifactSha = "7629b84fbd061dba78a420239eedd3a651718bf4d2b3f2a244fd2382f4b8c56d";
const artifactIntegrity =
  "sha512-4KiIU2Ol3N7ERvQqbTqg3yGxxUATwf6sDKyeoiGZ92l+wF2ni5l41qSjxMwDHch4gYZwzImJjXfWMi8LYJ9UKw==";
const upstreamRevision = "40a275038b81d624166ffcfa963453237173c8cd";
const traceBin = join(repoRoot, "node_modules", ".bin", "validation-trace");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface PinSurfaces {
  packageJson: string;
  lockfile: string;
  decision: string;
  installedPackage: string;
  sha256: string;
}

function pinProblems(surfaces: PinSurfaces): string[] {
  const problems: string[] = [];
  if (!surfaces.packageJson.includes(`"validation-architect": "file:vendor/${artifactName}"`)) {
    problems.push("package pin drift");
  }
  if (!surfaces.lockfile.includes(`tarball: file:vendor/${artifactName}`)) problems.push("lock source drift");
  if (!surfaces.lockfile.includes(`integrity: ${artifactIntegrity}`)) problems.push("lock integrity drift");
  if (!surfaces.installedPackage.includes(`"version": "${version}"`)) problems.push("installed version drift");
  if (!surfaces.decision.includes(upstreamRevision)) problems.push("upstream revision drift");
  if (!surfaces.decision.includes(artifactSha) || !surfaces.decision.includes(artifactIntegrity)) {
    problems.push("decision identity drift");
  }
  if (surfaces.sha256 !== artifactSha) problems.push("artifact bytes drift");
  return problems;
}

async function readPinSurfaces(): Promise<PinSurfaces> {
  const artifact = await readFile(join(repoRoot, "vendor", artifactName));
  const [packageJson, lockfile, decision, installedPackage] = await Promise.all([
    readFile(join(repoRoot, "package.json"), "utf8"),
    readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8"),
    readFile(join(repoRoot, "research", "2026-08-15_validation-architect-model-migration-bootstrap.md"), "utf8"),
    readFile(join(repoRoot, "node_modules", "validation-architect", "package.json"), "utf8"),
  ]);
  return {
    packageJson,
    lockfile,
    decision,
    installedPackage,
    sha256: createHash("sha256").update(artifact).digest("hex"),
  };
}

async function legacyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-va-cutover-"));
  roots.push(root);
  await mkdir(join(root, "validation-design"), { recursive: true });
  await mkdir(join(root, "tests", "cf-seed"), { recursive: true });
  await writeFile(
    join(root, "validation-design", "case-catalog.yaml"),
    [
      "schema: validation-architect/case-catalog/v1",
      "product: preparation-fixture",
      "families:",
      "  - {id: CF-SEED, section: Seed, status: implementable, layers: '1', oracle: det, risk: FLOOR, ticket: HB-999, wave: seed}",
      "tickets:",
      "  - {id: HB-999, wave: seed, status: landed, families: [CF-SEED]}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(root, "tests", "cf-seed", "seed.test.ts"), "// CF-SEED — HB-999\nit('seed', () => {});\n");
  return root;
}

function invokeTrace(root: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    traceBin,
    [root, "--manifest", join(root, "validation-design", "case-catalog.yaml"), "--tests", "tests"],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return { exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("CF-HARNESS-CI — #465 checked-model preparation", () => {
  it("binds the installed package and decision record to the reviewed 0.4.2 artifact", async () => {
    expect(pinProblems(await readPinSurfaces())).toEqual([]);
  });

  it("detects seeded dependency, integrity, revision, and artifact drift", async () => {
    const surfaces = await readPinSurfaces();
    expect(
      pinProblems({ ...surfaces, packageJson: surfaces.packageJson.replace(artifactName, "wrong.tgz") }),
    ).toContain("package pin drift");
    expect(
      pinProblems({ ...surfaces, lockfile: surfaces.lockfile.replace(artifactIntegrity, "sha512-wrong") }),
    ).toContain("lock integrity drift");
    expect(pinProblems({ ...surfaces, decision: surfaces.decision.replace(upstreamRevision, "wrong") })).toContain(
      "upstream revision drift",
    );
    expect(pinProblems({ ...surfaces, sha256: "wrong" })).toContain("artifact bytes drift");
  });

  it("keeps legacy closure green until any checked-model file appears, then fails closed", async () => {
    const root = await legacyFixture();
    const legacy = invokeTrace(root);
    expect(legacy.exitCode, `${legacy.stdout}\n${legacy.stderr}`).toBe(0);
    expect(legacy.stdout).toContain("Trace report — preparation-fixture");
    expect(legacy.stderr).toContain("legacy manifest bridge active");

    await mkdir(join(root, "validation-design", "model"), { recursive: true });
    await writeFile(
      join(root, "validation-design", "model", "project.yaml"),
      "schema: validation-architect/model/project/v1\n",
    );
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-q", "-m", "partial"], {
      cwd: root,
    });

    const partial = invokeTrace(root);
    expect(partial.exitCode).toBe(1);
    expect(partial.stderr).toContain("checked-model authority selected");
    expect(partial.stderr).toContain("invalid_input");
    expect(partial.stdout).not.toContain("Trace report — preparation-fixture");
  });
});
