// Traceability: CF-HARNESS-RELEASE · HB-117 · validation-policy.yaml release_qualification exact-tag/publish separation.

// CF-HARNESS-RELEASE — the tag workflow, package lifecycle refusal, and
// provider-free verifier remain one fail-closed surface. The seeded mutations
// prove this source detector fires if any one layer is removed.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdRelease } from "../../../src/cli/release.js";
import { loadApps } from "../../../src/org/apps.js";

describe("RQ-1 release enforcement surfaces", () => {
  it("pins exact-tag verification before exact-tarball publication", async () => {
    const surfaces = await readSurfaces();
    expect(() => assertReleaseSurfaces(surfaces)).not.toThrow();
  });

  it("negative control: detects removed verifier, prepublish refusal, and widened trigger", async () => {
    const surfaces = await readSurfaces();
    expect(() =>
      assertReleaseSurfaces({
        ...surfaces,
        workflow: surfaces.workflow.replace("run: pnpm release:verify", "run: echo skipped"),
      }),
    ).toThrow(/release verifier/);
    expect(() =>
      assertReleaseSurfaces({
        ...surfaces,
        packageJson: {
          ...surfaces.packageJson,
          scripts: { ...surfaces.packageJson.scripts, prepublishOnly: "echo bypass" },
        },
      }),
    ).toThrow(/prepublishOnly/);
    expect(() =>
      assertReleaseSurfaces({ ...surfaces, workflow: surfaces.workflow.replace('tags: ["v*"]', "branches: [main]") }),
    ).toThrow(/exact tag trigger/);
    expect(() =>
      assertReleaseSurfaces({
        ...surfaces,
        workflow: surfaces.workflow.replace("checks: read", "checks: read\n  id-token: write"),
      }),
    ).toThrow(/OIDC permission/);
    expect(() =>
      assertReleaseSurfaces({
        ...surfaces,
        workflow: surfaces.workflow.replace(
          "CORMIDIA_RELEASE_ACTOR: ${{ github.actor }}",
          "CORMIDIA_RELEASE_ACTOR: forged",
        ),
      }),
    ).toThrow(/CORMIDIA_RELEASE_ACTOR|authenticated actor/);
    expect(() =>
      assertReleaseSurfaces({
        ...surfaces,
        config: surfaces.config.replace("approvers: [bikramgupta]", "approvers: [another-writer]"),
      }),
    ).toThrow(/release authority/);
  });

  it("negative control: provider-free verifier contains no release effect", async () => {
    const surfaces = await readSurfaces();
    expect(() => assertVerifierHasNoEffect(`${surfaces.verifier}\nexecFile("npm", ["publish"]);`)).toThrow(
      /publication effect/,
    );
    expect(() => assertVerifierHasNoEffect(`${surfaces.verifier}\nexecFile("git", ["push"]);`)).toThrow(
      /tag push effect/,
    );
    expect(() => assertVerifierHasNoEffect(surfaces.verifier)).not.toThrow();
  });

  it("negative control: app config refuses missing, duplicate, or non-tag release authority", async () => {
    const surfaces = await readSurfaces();
    const parsed = await loadApps(join(process.cwd(), ".cormidia", "config.yaml"));
    expect(parsed.apps.find((app) => app.name === "Cormidia")?.release?.approvers).toEqual(["bikramgupta"]);

    const root = await mkdtemp(join(tmpdir(), "rq1-release-authority-"));
    try {
      for (const [name, config, pattern] of [
        ["empty", surfaces.config.replace("approvers: [bikramgupta]", "approvers: []"), /non-empty list/],
        [
          "duplicate",
          surfaces.config.replace("approvers: [bikramgupta]", "approvers: [bikramgupta, bikramgupta]"),
          /duplicate/,
        ],
        [
          "command",
          surfaces.config.replace(
            "trigger: tag\n      approvers: [bikramgupta]",
            "trigger: command\n      command: gh workflow run release.yml\n      approvers: [bikramgupta]",
          ),
          /only for a tag-triggered release/,
        ],
      ] as const) {
        const path = join(root, `${name}.yaml`);
        await writeFile(path, config, "utf8");
        await expect(loadApps(path)).rejects.toThrow(pattern);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts pnpm's argument separator and rejects absent package-smoke input", () => {
    const script = join(process.cwd(), "scripts", "smoke-package-install.mjs");
    const forwarded = spawnSync(process.execPath, [script, "--", "/definitely-missing-cormidia-package.tgz"], {
      encoding: "utf8",
    });
    expect(forwarded.status).not.toBe(0);
    expect(forwarded.stderr).not.toContain("requires one absolute tarball path");

    const missing = spawnSync(process.execPath, [script, "--"], { encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("requires one absolute tarball path");
  });

  it("treats an attest commit as an exact oid rather than a filesystem path", async () => {
    const absolute = join(process.cwd(), "definitely-missing-rq1-input");
    let message = "";
    try {
      await cmdRelease([
        "attest",
        "--repo",
        process.cwd(),
        "--packet",
        absolute,
        "--release-commit",
        "a".repeat(40),
        "--tag",
        "v0.1.2",
        "--tarball",
        absolute,
        "--release-action",
        absolute,
        "--created-at",
        "2026-08-05T00:00:00.000Z",
        "--output",
        `${absolute}.json`,
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("--release-commit must be an absolute path");
    expect(message).toMatch(/release attest release-commit is not repository HEAD|clean tracked repository/);
  });
});

interface Surfaces {
  workflow: string;
  verifier: string;
  config: string;
  packageJson: { scripts?: Record<string, unknown> };
}

async function readSurfaces(): Promise<Surfaces> {
  const root = process.cwd();
  return {
    workflow: await readFile(join(root, ".github", "workflows", "release.yml"), "utf8"),
    verifier: await readFile(join(root, "scripts", "release-verify.mjs"), "utf8"),
    config: await readFile(join(root, ".cormidia", "config.yaml"), "utf8"),
    packageJson: JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Surfaces["packageJson"],
  };
}

function assertReleaseSurfaces(surfaces: Surfaces): void {
  if (
    !/push:\n\s+tags: \["v\*"\]/.test(surfaces.workflow) ||
    /workflow_dispatch:|branches:\s*\[main\]/.test(surfaces.workflow)
  )
    throw new Error("release workflow lacks exact tag trigger");
  for (const required of [
    "fetch-depth: 0",
    "checks: read",
    "check-runs?per_page=100",
    "row.head_sha === process.env.GITHUB_SHA",
    "pnpm typecheck",
    "pnpm build",
    "pnpm test",
    "git diff --check",
    "pnpm smoke:onboarding",
    "npm pack --dry-run --ignore-scripts",
    "pnpm smoke:package",
    "gitleaks",
    "CORMIDIA_RELEASE_ACTOR: ${{ github.actor }}",
    "CORMIDIA_RELEASE_REPOSITORY: ${{ github.repository }}",
    "run: pnpm release:verify",
    "actions/upload-artifact@v4",
    "actions/download-artifact@v4",
    "sha256sum -c",
    'npm publish "${TARBALL}"',
  ]) {
    if (!surfaces.workflow.includes(required))
      throw new Error(
        `release workflow lacks ${required === "run: pnpm release:verify" ? "release verifier" : required}`,
      );
  }
  if (!surfaces.workflow.includes("CORMIDIA_RELEASE_ACTOR: ${{ github.actor }}"))
    throw new Error("release workflow lacks authenticated actor binding");
  if (!surfaces.config.includes("approvers: [bikramgupta]"))
    throw new Error("release authority is not pinned in app config");
  const verify = surfaces.workflow.indexOf("run: pnpm release:verify");
  const publish = surfaces.workflow.indexOf("npm publish");
  if (verify < 0 || publish < 0 || verify >= publish) throw new Error("release verifier must precede publication");
  const publishJob = surfaces.workflow.indexOf("\n  publish:");
  const oidc = surfaces.workflow.indexOf("id-token: write");
  if (publishJob < 0 || oidc < publishJob || surfaces.workflow.slice(0, publishJob).includes("id-token: write"))
    throw new Error("OIDC permission must be isolated to the post-verification publish job");
  if (surfaces.packageJson.scripts?.["release:verify"] !== "node scripts/release-verify.mjs")
    throw new Error("release:verify script is not pinned");
  if (surfaces.packageJson.scripts?.["prepublishOnly"] !== "pnpm release:verify")
    throw new Error("prepublishOnly does not refuse without RQ-1 verification");
  assertVerifierHasNoEffect(surfaces.verifier);
}

function assertVerifierHasNoEffect(source: string): void {
  if (/execFile\(["']npm["'],\s*\[["']publish["']/.test(source))
    throw new Error("release verifier contains a publication effect");
  if (/execFile\(["']git["'],\s*\[["'](?:tag|push)["']/.test(source))
    throw new Error("release verifier contains a tag push effect");
}
