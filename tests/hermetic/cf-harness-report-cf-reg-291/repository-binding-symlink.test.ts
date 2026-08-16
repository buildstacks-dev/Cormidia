// Traceability: CF-HARNESS-REPORT · HB-050 · triggered campaign authority path binding.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertCampaignRepositoryBinding } from "../../campaign/repository-binding.js";
import {
  HOST_POLICY_RELATIVE_PATH,
  LEGACY_VALIDATION_POLICY_RELATIVE_PATH,
} from "../../fixtures/validation-authority.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("triggered campaign authority lexical paths", () => {
  it("refuses a committed host-policy ancestor symlink", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-host-ancestor-symlink" });
    try {
      const root = fixture.stateHome;
      const target = join(root, "policy-target", "qualification", "host-policy.yaml");
      await mkdir(dirname(target), { recursive: true });
      await mkdir(join(root, "validation-design"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), target);
      await symlink("policy-target", join(root, "docs"));
      await writeFile(join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH), "schema_version: 1\n", "utf8");
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(
        assertCampaignRepositoryBinding({ commit, policyPath: join(root, HOST_POLICY_RELATIVE_PATH), cwd: root }),
      ).rejects.toThrow(/host policy path contains a symlink/);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses a committed legacy-authority ancestor symlink", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-legacy-ancestor-symlink" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "legacy-target"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), policy);
      await writeFile(join(root, "legacy-target", "validation-policy.yaml"), "schema_version: 1\n", "utf8");
      await symlink("legacy-target", join(root, "validation-design"));
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /validation-design is not a regular non-symlink directory/,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

function initialize(root: string): void {
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
