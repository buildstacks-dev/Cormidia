// CF-HARNESS-CI — HB-P7 — #465 exact vendor pin and fail-closed authority cutover.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, FakeRepositoryPort } from "validation-architect";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const version = "0.4.6";
const artifactName = `validation-architect-${version}.tgz`;
const supersededArtifactName = "validation-architect-0.4.5.tgz";
const artifactSha = "1e396fdb7fe2e6ea2e479628e344c6283a5ae7f4cb95a86dfba8601a7cfd66c5";
const artifactIntegrity =
  "sha512-6wRhOH8+80Knr1H7FTYYjAZcpGpG4ZiveCXSv6ddk1eaab11Rd5tiFr0l3CSR1TcTw/lSVEjXtV2pRVOYpcFHA==";
const artifactReproduction = "268,051-byte core tarballs with 124 entries";
const upstreamRevision = "52a7b26b5b4de934612640c3d47ba7c738596ece";
const currentDependencyHeading = "### Current corrective 0.4.6 cutover dependency";
const sequenceIntro = "The formerly planned two-PR bootstrap is seven reviewed squash PRs, in order:";
const preparationStages = [
  "dependency preparation (#466)",
  "transition consumers (#468)",
  "(#469)",
  "(#470)",
  "narrow final-consumer preparation (#471 at `7d68ded4813c665ce10379539f741f062dba3572`)",
  "exact 0.4.6 family-output-fidelity and current-policy reconciliation preparation after upstream [#52](https://github.com/cormidia/validation-architect/pull/52) at `52a7b26b5b4de934612640c3d47ba7c738596ece`",
  "`validation-design/`-only authority cutover",
];
const productRevisionPin =
  "The final model names the exact 0.4.6 Cormidia preparation squash SHA—not #471—as `product.revision`.";
const rollbackOrder = "newest-first: authority cutover, 0.4.6 Cormidia preparation, #471, #470, #469, #468, #466.";
const traceBin = join(repoRoot, "node_modules", ".bin", "validation-trace");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type PinSurfaces = Awaited<ReturnType<typeof readPinSurfaces>>;
type TextSurface = Exclude<keyof PinSurfaces, "supersededArtifactPresent">;

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

const compact = (source: string): string => source.replace(/\s+/g, " ").trim();

function replaceSurface(surfaces: PinSurfaces, key: TextSurface, from: string, to: string): PinSurfaces {
  return { ...surfaces, [key]: surfaces[key].replace(from, to) };
}

function hasOrderedStages(source: string): boolean {
  const normalized = compact(source);
  const start = normalized.indexOf(sequenceIntro);
  const end = normalized.indexOf("Full cutover staging proved", start);
  if (start < 0 || end < 0) return false;
  let cursor = start + sequenceIntro.length;
  return preparationStages.every((stage) => {
    const index = normalized.indexOf(stage, cursor);
    if (index < 0 || index >= end) return false;
    cursor = index + stage.length;
    return true;
  });
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
  if (!surfaces.hostPolicy.includes("validation-architect 0.4.6, unchanged")) {
    problems.push("host-policy package explanation drift");
  }
  const domainSplit = compact(surfaces.domainSplit);
  if (!domainSplit.includes(sequenceIntro)) problems.push("domain-split stage-count drift");
  if (!hasOrderedStages(surfaces.domainSplit)) problems.push("domain-split stage-order drift");
  if (!domainSplit.includes(productRevisionPin)) problems.push("domain-split product revision drift");
  if (!domainSplit.includes(rollbackOrder)) problems.push("domain-split rollback order drift");
  for (const phrase of [
    "reviewed `validation-architect` 0.4.6 tarball",
    upstreamRevision,
    "selects 0.4.6's bounded legacy-manifest bridge",
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
  if (surfaces.supersededArtifactPresent) problems.push("superseded artifact retained");
  if (!surfaces.decision.includes(currentDependencyHeading)) problems.push("decision section drift");
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

async function readPinSurfaces() {
  const artifact = await readFile(join(repoRoot, "vendor", artifactName));
  const vendorNames = await readdir(join(repoRoot, "vendor"));
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
    supersededArtifactPresent: vendorNames.includes(supersededArtifactName),
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
  it("binds the installed package and decision record to the reviewed 0.4.6 artifact", async () => {
    expect(pinProblems(await readPinSurfaces())).toEqual([]);
  });

  it("detects seeded dependency, integrity, revision, and artifact drift", async () => {
    const surfaces = await readPinSurfaces();
    const compactDomainSplit = compact(surfaces.domainSplit);
    const mutationBase = { ...surfaces, domainSplit: compactDomainSplit };
    // biome-ignore format: compact red-seed table keeps this existing detector within its size ratchet.
    const replacements: [string, TextSurface, string, string][] = [
      ["package pin drift", "packageJson", artifactName, "wrong.tgz"],
      ["package scope drift", "packageJson", '"devDependencies": {', '"developmentDependencies": {'],
      ["lock source drift", "lockfile", artifactName, "wrong.tgz"],
      ["lock integrity drift", "lockfile", artifactIntegrity, "sha512-wrong"],
      ["lock version drift", "lockfile", "version: 0.4.6", "version: 0.0.0"],
      ["installed version drift", "installedPackage", version, "0.0.0"],
      ["decision section drift", "decision", currentDependencyHeading, "wrong"],
      ["upstream revision drift", "decision", upstreamRevision, "wrong"],
      ["decision identity drift", "decision", artifactSha, "wrong"],
      ["decision identity drift", "decision", artifactName, "wrong.tgz"],
      ["decision byte-count drift", "decision", artifactReproduction, "1-byte core tarballs with 124 entries"],
      ["decision entry-count drift", "decision", artifactReproduction, "268,051-byte core tarballs with 1 entry"],
      ["artifact bytes drift", "sha256", artifactSha, "wrong"],
      ["root routing drift: active authority", "agents", "active authority", "retired authority"],
      ["stale root catalog routing", "agents", surfaces.agents, `${surfaces.agents}\ncase-catalog §10.3 row\n`],
      ["host-policy package explanation drift", "hostPolicy", "0.4.6", "0.4.5"],
      ["domain-split stage-count drift", "domainSplit", "seven reviewed", "six reviewed"],
      ["domain-split product revision drift", "domainSplit", productRevisionPin, "The final model names #471 as `product.revision`."],
      ["domain-split rollback order drift", "domainSplit", rollbackOrder, rollbackOrder.replace("#470, ", "")],
      ["domain-split rollback order drift", "domainSplit", rollbackOrder, rollbackOrder.replace("#471, #470", "#470, #471")],
      ["domain-split rollback order drift", "domainSplit", rollbackOrder, rollbackOrder.replace("authority cutover, 0.4.6 Cormidia preparation", "0.4.6 Cormidia preparation, authority cutover")],
      ["enablement pin drift: reviewed `validation-architect` 0.4.6 tarball", "installGuide", "0.4.6 tarball", "0.4.5 tarball"],
      [`enablement pin drift: ${upstreamRevision}`, "installGuide", upstreamRevision, "wrong"],
      ["enablement pin drift: selects 0.4.6's bounded legacy-manifest bridge", "installGuide", "selects 0.4.6's bounded", "selects 0.4.5's bounded"],
    ];
    for (const [problem, key, from, to] of replacements) {
      expect(pinProblems(replaceSurface(mutationBase, key, from, to)), problem).toContain(problem);
    }
    expect(pinProblems({ ...surfaces, supersededArtifactPresent: true })).toContain("superseded artifact retained");
    for (const stage of preparationStages) {
      expect(pinProblems({ ...surfaces, domainSplit: compactDomainSplit.replace(stage, "") })).toContain(
        "domain-split stage-order drift",
      );
    }
    const [firstStage, secondStage] = preparationStages;
    if (firstStage === undefined || secondStage === undefined) throw new Error("sequence detector needs two stages");
    const swapped = compactDomainSplit
      .replace(firstStage, "__FIRST__")
      .replace(secondStage, firstStage)
      .replace("__FIRST__", secondStage);
    expect(pinProblems({ ...surfaces, domainSplit: swapped })).toContain("domain-split stage-order drift");
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
