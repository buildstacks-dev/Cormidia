import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { requireHumanThreatModel, THREAT_SURFACES } from "../../ops/threat-model-gate.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("HB-072/HB-073 human threat-model gate", () => {
  it("keeps the checked-in scaffold blocked", async () => {
    await expect(
      requireHumanThreatModel(join(process.cwd(), "validation-design", "threat-model-status.yaml")),
    ).rejects.toThrow(/BLOCKED.*human-authored/);
  });

  it("negative control: digest drift after human review closes the gate", async () => {
    const fixture = await reviewedFixture();
    await expect(requireHumanThreatModel(fixture.status)).resolves.toMatchObject({
      abuse_case_ids: ["CF-OPS-ABUSE-FIXTURE"],
    });
    await writeFile(fixture.artifact, "changed after review\n", "utf8");
    await expect(requireHumanThreatModel(fixture.status)).rejects.toThrow(/digest does not match/);
  });
});

async function reviewedFixture(): Promise<{ status: string; artifact: string }> {
  const root = await mkdtemp(join(tmpdir(), "threat-gate-"));
  roots.push(root);
  const artifact = join(root, "threat-model.md");
  const status = join(root, "status.yaml");
  await writeFile(artifact, "# Human-authored fixture only\n", "utf8");
  const digest = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  await writeFile(
    status,
    stringify({
      schema_version: 1,
      status: "human_authored_reviewed",
      human_authored: true,
      human_reviewed: true,
      artifact: "threat-model.md",
      artifact_sha256: digest,
      author: "fixture-author",
      authored_at: "2026-07-01T00:00:00.000Z",
      reviewer: "fixture-reviewer",
      reviewed_at: "2026-07-02T00:00:00.000Z",
      covered_surfaces: [...THREAT_SURFACES],
      abuse_case_ids: ["CF-OPS-ABUSE-FIXTURE"],
      release_gating_acknowledged: true,
      note: "test fixture",
    }),
    "utf8",
  );
  return { status, artifact };
}
