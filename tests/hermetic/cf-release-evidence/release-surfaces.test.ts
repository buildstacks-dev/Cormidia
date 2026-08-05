// CF-HARNESS-RELEASE — the tag workflow, package lifecycle refusal, and
// provider-free verifier remain one fail-closed surface. The seeded mutations
// prove this source detector fires if any one layer is removed.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cmdRelease } from "../../../src/cli/release.js";

describe("RQ-1 release enforcement surfaces", () => {
  it("pins exact-tag verification before exact-tarball publication", async () => {
    const surfaces = await readSurfaces();
    expect(() => assertReleaseSurfaces(surfaces)).not.toThrow();
  });

  it("negative control: detects removed verifier, prepublish refusal, and widened trigger", async () => {
    const surfaces = await readSurfaces();
    expect(() => assertReleaseSurfaces({ ...surfaces, workflow: surfaces.workflow.replace("run: pnpm release:verify", "run: echo skipped") })).toThrow(/release verifier/);
    expect(() => assertReleaseSurfaces({ ...surfaces, packageJson: { ...surfaces.packageJson, scripts: { ...surfaces.packageJson.scripts, prepublishOnly: "echo bypass" } } })).toThrow(/prepublishOnly/);
    expect(() => assertReleaseSurfaces({ ...surfaces, workflow: surfaces.workflow.replace('tags: ["v*"]', "branches: [main]") })).toThrow(/exact tag trigger/);
    expect(() => assertReleaseSurfaces({ ...surfaces, workflow: surfaces.workflow.replace("checks: read", "checks: read\n  id-token: write") })).toThrow(/OIDC permission/);
  });

  it("negative control: provider-free verifier contains no release effect", async () => {
    const surfaces = await readSurfaces();
    expect(() => assertVerifierHasNoEffect(`${surfaces.verifier}\nexecFile("npm", ["publish"]);`)).toThrow(/publication effect/);
    expect(() => assertVerifierHasNoEffect(`${surfaces.verifier}\nexecFile("git", ["push"]);`)).toThrow(/tag push effect/);
    expect(() => assertVerifierHasNoEffect(surfaces.verifier)).not.toThrow();
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
        "attest", "--repo", process.cwd(), "--packet", absolute,
        "--release-commit", "a".repeat(40), "--tag", "v0.1.2",
        "--tarball", absolute, "--release-action", absolute,
        "--created-at", "2026-08-05T00:00:00.000Z", "--output", `${absolute}.json`,
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
  packageJson: { scripts?: Record<string, unknown> };
}

async function readSurfaces(): Promise<Surfaces> {
  const root = process.cwd();
  return {
    workflow: await readFile(join(root, ".github", "workflows", "release.yml"), "utf8"),
    verifier: await readFile(join(root, "scripts", "release-verify.mjs"), "utf8"),
    packageJson: JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Surfaces["packageJson"],
  };
}

function assertReleaseSurfaces(surfaces: Surfaces): void {
  if (!/push:\n\s+tags: \["v\*"\]/.test(surfaces.workflow) || /workflow_dispatch:|branches:\s*\[main\]/.test(surfaces.workflow)) throw new Error("release workflow lacks exact tag trigger");
  for (const required of ["fetch-depth: 0", "checks: read", "check-runs?per_page=100", "row.head_sha === process.env.GITHUB_SHA", "pnpm typecheck", "pnpm build", "pnpm test", "git diff --check", "pnpm smoke:onboarding", "npm pack --dry-run --ignore-scripts", "pnpm smoke:package", "gitleaks", "run: pnpm release:verify", "actions/upload-artifact@v4", "actions/download-artifact@v4", "sha256sum -c", "npm publish \"${TARBALL}\""]) {
    if (!surfaces.workflow.includes(required)) throw new Error(`release workflow lacks ${required === "run: pnpm release:verify" ? "release verifier" : required}`);
  }
  const verify = surfaces.workflow.indexOf("run: pnpm release:verify");
  const publish = surfaces.workflow.indexOf("npm publish");
  if (verify < 0 || publish < 0 || verify >= publish) throw new Error("release verifier must precede publication");
  const publishJob = surfaces.workflow.indexOf("\n  publish:");
  const oidc = surfaces.workflow.indexOf("id-token: write");
  if (publishJob < 0 || oidc < publishJob || surfaces.workflow.slice(0, publishJob).includes("id-token: write")) throw new Error("OIDC permission must be isolated to the post-verification publish job");
  if (surfaces.packageJson.scripts?.["release:verify"] !== "node scripts/release-verify.mjs") throw new Error("release:verify script is not pinned");
  if (surfaces.packageJson.scripts?.["prepublishOnly"] !== "pnpm release:verify") throw new Error("prepublishOnly does not refuse without RQ-1 verification");
  assertVerifierHasNoEffect(surfaces.verifier);
}

function assertVerifierHasNoEffect(source: string): void {
  if (/execFile\(["']npm["'],\s*\[["']publish["']/.test(source)) throw new Error("release verifier contains a publication effect");
  if (/execFile\(["']git["'],\s*\[["'](?:tag|push)["']/.test(source)) throw new Error("release verifier contains a tag push effect");
}
