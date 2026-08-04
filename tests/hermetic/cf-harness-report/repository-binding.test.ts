import { execFileSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCampaignRepositoryBinding } from "../../campaign/repository-binding.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

describe("triggered campaign repository binding", () => {
  it("accepts exact committed policy/golden blobs and refuses working-tree drift", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-binding" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, "validation-design", "validation-policy.yaml");
      const golden = join(root, "validation-design", "golden-sets", "reviewer", "cases.json");
      await mkdir(join(root, "validation-design", "golden-sets", "reviewer"), { recursive: true });
      await writeFile(policy, "schema_version: 1\n", "utf8");
      await writeFile(golden, "[]\n", "utf8");
      git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.invalid"]);
      git(root, ["config", "user.name", "Fixture"]); git(root, ["add", "validation-design"]);
      git(root, ["commit", "-qm", "fixture"]);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(assertCampaignRepositoryBinding({
        commit, policyPath: policy, trackedInputPaths: [golden], cwd: root,
      })).resolves.toMatchObject({
        policyPath: await realpath(policy),
        trackedInputPaths: [await realpath(golden)],
      });

      await writeFile(golden, "[{\"unreviewed\":true}]\n", "utf8");
      await expect(assertCampaignRepositoryBinding({
        commit, policyPath: policy, trackedInputPaths: [golden], cwd: root,
      })).rejects.toThrow(/differs from the authorized commit/);
    } finally {
      await fixture.cleanup();
    }
  });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
