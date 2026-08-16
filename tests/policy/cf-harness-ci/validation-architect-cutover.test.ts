// CF-HARNESS-CI — HB-P7 — #465 exact vendor pin and fail-closed authority cutover.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, FakeRepositoryPort } from "validation-architect";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const version = "0.4.5";
const artifactName = `validation-architect-${version}.tgz`;
const artifactSha = "2a2e59324272aeb5d3ba1aed9da4a42fb0682f391fa82ee9dfa1c8cbff8294eb";
const artifactIntegrity =
  "sha512-3sHA9XQ80l+05yt5lQTv6RoXNahoY1LOv0edAwPza8oCQ02kpurkFlT7hzLXwQrQHC9F841R3ZJDnHENQp1E/Q==";
const artifactReproduction = "267,873-byte core tarballs with 124 entries";
const upstreamRevision = "5949f6b1be3f3b22c47c3cf532e33d529a468291";
const traceBin = join(repoRoot, "node_modules", ".bin", "validation-trace");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface PinSurfaces {
  agents: string;
  domainSplit: string;
  hostPolicy: string;
  installGuide: string;
  packageJson: string;
  lockfile: string;
  decision: string;
  installedPackage: string;
  sha256: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isDevelopmentOnlyPin(source: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return false;
  }
  if (!isRecord(value) || !isRecord(value.devDependencies)) return false;
  const runtime = value.dependencies;
  return (
    value.devDependencies["validation-architect"] === `file:vendor/${artifactName}` &&
    (!isRecord(runtime) || !("validation-architect" in runtime))
  );
}

function pinProblems(surfaces: PinSurfaces): string[] {
  const problems: string[] = [];
  for (const phrase of [
    "active authority",
    "`model/families.yaml` / `model/backlog.yaml`",
    "regenerate projections",
    "never hand-edit generated `case-catalog.md`",
  ]) {
    if (!surfaces.agents.includes(phrase)) problems.push(`root routing drift: ${phrase}`);
  }
  if (surfaces.agents.includes("case-catalog §10.3 row")) problems.push("stale root catalog routing");
  if (!surfaces.hostPolicy.includes("validation-architect 0.4.5, unchanged")) {
    problems.push("host-policy package explanation drift");
  }
  for (const phrase of [
    "six reviewed squash PRs",
    "names the final-consumer preparation squash SHA as `product.revision`",
  ]) {
    if (!surfaces.domainSplit.includes(phrase)) problems.push(`domain-split sequencing drift: ${phrase}`);
  }
  for (const phrase of [
    "reviewed `validation-architect` 0.4.5 tarball",
    upstreamRevision,
    "selects 0.4.5's bounded legacy-manifest bridge",
  ]) {
    if (!surfaces.installGuide.includes(phrase)) problems.push(`enablement pin drift: ${phrase}`);
  }
  if (!surfaces.packageJson.includes(`"validation-architect": "file:vendor/${artifactName}"`)) {
    problems.push("package pin drift");
  }
  if (!isDevelopmentOnlyPin(surfaces.packageJson)) problems.push("package scope drift");
  if (
    !surfaces.lockfile.includes(`specifier: file:vendor/${artifactName}`) ||
    !surfaces.lockfile.includes(`tarball: file:vendor/${artifactName}`)
  ) {
    problems.push("lock source drift");
  }
  if (!surfaces.lockfile.includes(`integrity: ${artifactIntegrity}`)) problems.push("lock integrity drift");
  if (!surfaces.lockfile.includes(`tarball: file:vendor/${artifactName}}\n    version: ${version}\n`)) {
    problems.push("lock version drift");
  }
  if (!surfaces.installedPackage.includes(`"version": "${version}"`)) problems.push("installed version drift");
  if (!surfaces.decision.includes(upstreamRevision)) problems.push("upstream revision drift");
  if (
    !surfaces.decision.includes(`artifact: \`vendor/${artifactName}\``) ||
    !surfaces.decision.includes(artifactSha) ||
    !surfaces.decision.includes(artifactIntegrity)
  ) {
    problems.push("decision identity drift");
  }
  if (!surfaces.decision.includes(artifactReproduction)) {
    problems.push("decision byte-count drift");
    problems.push("decision entry-count drift");
  }
  if (surfaces.sha256 !== artifactSha) problems.push("artifact bytes drift");
  return problems;
}

async function readPinSurfaces(): Promise<PinSurfaces> {
  const artifact = await readFile(join(repoRoot, "vendor", artifactName));
  const [agents, domainSplit, hostPolicy, installGuide, packageJson, lockfile, decision, installedPackage] =
    await Promise.all([
      readFile(join(repoRoot, "AGENTS.md"), "utf8"),
      readFile(join(repoRoot, "research", "2026-08-16_validation-authority-domain-split.md"), "utf8"),
      readFile(join(repoRoot, "docs", "qualification", "host-policy.yaml"), "utf8"),
      readFile(join(repoRoot, "validation-design", "enablement", "INSTALL.md"), "utf8"),
      readFile(join(repoRoot, "package.json"), "utf8"),
      readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8"),
      readFile(join(repoRoot, "research", "2026-08-15_validation-architect-model-migration-bootstrap.md"), "utf8"),
      readFile(join(repoRoot, "node_modules", "validation-architect", "package.json"), "utf8"),
    ]);
  return {
    agents,
    domainSplit,
    hostPolicy,
    installGuide,
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
  it("binds the installed package and decision record to the reviewed 0.4.5 artifact", async () => {
    expect(pinProblems(await readPinSurfaces())).toEqual([]);
  });

  it("detects seeded dependency, integrity, revision, and artifact drift", async () => {
    const surfaces = await readPinSurfaces();
    expect(
      pinProblems({ ...surfaces, packageJson: surfaces.packageJson.replace(artifactName, "wrong.tgz") }),
    ).toContain("package pin drift");
    expect(
      pinProblems({
        ...surfaces,
        packageJson: surfaces.packageJson.replace('"devDependencies": {', '"developmentDependencies": {'),
      }),
    ).toContain("package scope drift");
    expect(pinProblems({ ...surfaces, lockfile: surfaces.lockfile.replaceAll(artifactName, "wrong.tgz") })).toContain(
      "lock source drift",
    );
    expect(
      pinProblems({ ...surfaces, lockfile: surfaces.lockfile.replace(artifactIntegrity, "sha512-wrong") }),
    ).toContain("lock integrity drift");
    expect(
      pinProblems({ ...surfaces, lockfile: surfaces.lockfile.replace("version: 0.4.5", "version: 0.0.0") }),
    ).toContain("lock version drift");
    expect(
      pinProblems({ ...surfaces, installedPackage: surfaces.installedPackage.replace(version, "0.0.0") }),
    ).toContain("installed version drift");
    expect(pinProblems({ ...surfaces, decision: surfaces.decision.replace(upstreamRevision, "wrong") })).toContain(
      "upstream revision drift",
    );
    expect(pinProblems({ ...surfaces, decision: surfaces.decision.replace(artifactSha, "wrong") })).toContain(
      "decision identity drift",
    );
    expect(pinProblems({ ...surfaces, decision: surfaces.decision.replace(artifactName, "wrong.tgz") })).toContain(
      "decision identity drift",
    );
    expect(
      pinProblems({
        ...surfaces,
        decision: surfaces.decision.replace(artifactReproduction, "1-byte core tarballs with 124 entries"),
      }),
    ).toContain("decision byte-count drift");
    expect(
      pinProblems({
        ...surfaces,
        decision: surfaces.decision.replace(artifactReproduction, "267,873-byte core tarballs with 1 entry"),
      }),
    ).toContain("decision entry-count drift");
    expect(pinProblems({ ...surfaces, sha256: "wrong" })).toContain("artifact bytes drift");
    expect(
      pinProblems({ ...surfaces, agents: surfaces.agents.replace("active authority", "retired authority") }),
    ).toContain("root routing drift: active authority");
    expect(pinProblems({ ...surfaces, agents: `${surfaces.agents}\ncase-catalog §10.3 row\n` })).toContain(
      "stale root catalog routing",
    );
    expect(pinProblems({ ...surfaces, hostPolicy: surfaces.hostPolicy.replace("0.4.5", "0.4.4") })).toContain(
      "host-policy package explanation drift",
    );
    expect(
      pinProblems({ ...surfaces, domainSplit: surfaces.domainSplit.replace("six reviewed", "five reviewed") }),
    ).toContain("domain-split sequencing drift: six reviewed squash PRs");
    expect(
      pinProblems({
        ...surfaces,
        domainSplit: surfaces.domainSplit.replace(
          "names the final-consumer preparation squash SHA as `product.revision`",
          "names the 0.4.5 preparation squash SHA as `product.revision`",
        ),
      }),
    ).toContain("domain-split sequencing drift: names the final-consumer preparation squash SHA as `product.revision`");
    expect(
      pinProblems({ ...surfaces, installGuide: surfaces.installGuide.replace("0.4.5 tarball", "0.4.4 tarball") }),
    ).toContain("enablement pin drift: reviewed `validation-architect` 0.4.5 tarball");
    expect(
      pinProblems({ ...surfaces, installGuide: surfaces.installGuide.replace(upstreamRevision, "wrong") }),
    ).toContain(`enablement pin drift: ${upstreamRevision}`);
    expect(
      pinProblems({
        ...surfaces,
        installGuide: surfaces.installGuide.replace("selects 0.4.5's bounded", "selects 0.4.4's bounded"),
      }),
    ).toContain("enablement pin drift: selects 0.4.5's bounded legacy-manifest bridge");
  });

  it("exposes the canonical compiler report through the installed public API", async () => {
    const output = await compile(new FakeRepositoryPort({ revision: "a".repeat(40), files: {} }));
    expect(output.accepted).toBe(false);
    expect(output.report.record).toMatchObject({
      schema: "validation-architect/compiler/v1",
      accepted: false,
      model_identity: null,
      versions: null,
      generated_views: [],
    });
    expect(output.report.record.source_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(output.report.record.diagnostics.length).toBeGreaterThan(0);
    expect(output.report.record.diagnostics.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(output.report.content).toBe(`${JSON.stringify(output.report.record, null, 2)}\n`);
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
