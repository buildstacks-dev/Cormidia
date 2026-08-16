// Traceability: CF-HARNESS-REPORT · HB-050 · host-policy, selected VA authority, and golden-blob binding.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeRepositoryPort, compile } from "validation-architect";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { assertCampaignRepositoryBinding } from "../../campaign/repository-binding.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";
import {
  compileCheckedModel,
  GENERATED_VIEW_RELATIVE_PATHS,
  HOST_POLICY_RELATIVE_PATH,
  LEGACY_ROOT_AUTHORITY_RELATIVE_PATHS,
  LEGACY_VALIDATION_POLICY_RELATIVE_PATH,
  MODEL_RELATIVE_PATHS,
} from "../../fixtures/validation-authority.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("triggered campaign repository binding", () => {
  it("refuses staged, unstaged, and untracked product paths but allows a design overlay", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-dirty-product" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "validation-design"), { recursive: true });
      await mkdir(join(root, "src"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), policy);
      await writeFile(join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH), "schema_version: 1\n", "utf8");
      await writeFile(join(root, "src/tracked.ts"), "export const tracked = 1;\n", "utf8");
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);

      await writeFile(join(root, "validation-design/authoring-note.tmp"), "overlay\n", "utf8");
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).resolves.toMatchObject({
        validationAuthority: "legacy",
      });
      await rm(join(root, "validation-design/authoring-note.tmp"));

      await writeFile(join(root, "src/untracked.ts"), "export {};\n", "utf8");
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /product paths differ.*src\/untracked.ts/,
      );
      await rm(join(root, "src/untracked.ts"));

      await writeFile(join(root, "src/tracked.ts"), "export const tracked = 2;\n", "utf8");
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /product paths differ.*src\/tracked.ts/,
      );
      await writeFile(join(root, "src/tracked.ts"), "export const tracked = 1;\n", "utf8");

      await writeFile(join(root, "src/staged.ts"), "export {};\n", "utf8");
      git(root, ["add", "src/staged.ts"]);
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /product paths differ.*src\/staged.ts/,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds the host policy, temporary legacy VA authority, and campaign inputs", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-binding" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      const legacy = join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH);
      const golden = join(root, "validation-design", "golden-sets", "reviewer", "cases.json");
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "validation-design", "golden-sets", "reviewer"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), policy);
      await writeFile(legacy, "schema_version: 1\n", "utf8");
      await writeFile(golden, "[]\n", "utf8");
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(
        assertCampaignRepositoryBinding({
          commit,
          policyPath: policy,
          trackedInputPaths: [golden],
          cwd: root,
        }),
      ).resolves.toMatchObject({
        policyPath: await realpath(policy),
        validationAuthority: "legacy",
        validationAuthorityPaths: [await realpath(legacy)],
        trackedInputPaths: [await realpath(golden)],
      });

      await writeFile(golden, '[{"unreviewed":true}]\n', "utf8");
      await expect(
        assertCampaignRepositoryBinding({
          commit,
          policyPath: policy,
          trackedInputPaths: [golden],
          cwd: root,
        }),
      ).rejects.toThrow(/differs from the authorized commit/);

      await writeFile(policy, `${await readFile(policy, "utf8")}\n# drift\n`, "utf8");
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /host policy differs from the authorized commit/,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("selects a complete compiler-clean model and never accepts the legacy policy as policy_path", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-model-binding" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "validation-design"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), policy);
      initialize(root);
      const productRevision = git(root, ["rev-parse", "HEAD"]);
      await writeCheckedModel(root, productRevision);
      git(root, ["add", "validation-design"]);
      git(root, ["commit", "-qm", "fixture: checked model"]);
      const commit = git(root, ["rev-parse", "HEAD"]);

      await expect(compileCheckedModel(root, productRevision)).resolves.toMatchObject({
        revision: productRevision,
        identity: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const generatedView = join(root, GENERATED_VIEW_RELATIVE_PATHS[0]);
      const generatedViewBytes = await readFile(generatedView, "utf8");
      await writeFile(generatedView, `${generatedViewBytes}\n# stale projection\n`, "utf8");
      await expect(compileCheckedModel(root, productRevision)).resolves.toMatchObject({ revision: productRevision });
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /generated validation view differs from the authorized commit/,
      );
      await writeFile(generatedView, generatedViewBytes, "utf8");

      const canonicalRoot = await realpath(root);
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).resolves.toMatchObject({
        validationAuthority: "model",
        validationAuthorityPaths: MODEL_RELATIVE_PATHS.map((path) => join(canonicalRoot, path)),
      });
      for (const legacyPath of LEGACY_ROOT_AUTHORITY_RELATIVE_PATHS) {
        await writeFile(join(root, legacyPath), "legacy\n", "utf8");
        await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
          /legacy root inputs cannot coexist/,
        );
        await rm(join(root, legacyPath));
      }

      await writeFile(join(root, "validation-design/model/extra.yaml"), "schema: unexpected\n", "utf8");
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /validation-design\/model contains unexpected entries: extra.yaml/,
      );
      await rm(join(root, "validation-design/model/extra.yaml"));

      const ownersPath = join(root, MODEL_RELATIVE_PATHS[1]);
      const validOwners = await readFile(ownersPath, "utf8");
      await writeFile(ownersPath, "schema: wrong\n", "utf8");
      git(root, ["add", MODEL_RELATIVE_PATHS[1]]);
      git(root, ["commit", "-qm", "fixture: committed invalid model"]);
      await writeFile(ownersPath, validOwners, "utf8");
      await expect(compileCheckedModel(root, productRevision)).rejects.toThrow(/public compiler/);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed on a partial model and never falls back to legacy or an archived model", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-partial-model" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "validation-design", "model"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), policy);
      await writeFile(join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH), "schema_version: 1\n", "utf8");
      await writeFile(join(root, MODEL_RELATIVE_PATHS[0]), "schema: validation-architect/model/project/v1\n", "utf8");
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /checked-model authority selected.*exact eight-file set/,
      );

      await rm(join(root, "validation-design", "model"), { recursive: true });
      await rm(join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH));
      const archive = join(root, "validation-design", "migration", "legacy", "model");
      await mkdir(archive, { recursive: true });
      for (const path of MODEL_RELATIVE_PATHS)
        await writeFile(join(archive, path.split("/").at(-1) ?? "missing"), "x\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-qm", "fixture: archive only"]);
      const archiveCommit = git(root, ["rev-parse", "HEAD"]);
      await expect(
        assertCampaignRepositoryBinding({ commit: archiveCommit, policyPath: policy, cwd: root }),
      ).rejects.toThrow(/zero checked-model files requires validation-design\/validation-policy.yaml/);
    } finally {
      await fixture.cleanup();
    }
  });

  it("negative control: the canonical host policy cannot be a tracked symlink", async () => {
    const fixture = await makeTempStateHome({ name: "campaign-host-symlink" });
    try {
      const root = fixture.stateHome;
      const policy = join(root, HOST_POLICY_RELATIVE_PATH);
      const target = join(root, "host-target.yaml");
      await mkdir(dirname(policy), { recursive: true });
      await mkdir(join(root, "validation-design"), { recursive: true });
      await copyFile(join(repoRoot, HOST_POLICY_RELATIVE_PATH), target);
      await symlink("../../host-target.yaml", policy);
      await writeFile(join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH), "schema_version: 1\n", "utf8");
      initialize(root);
      const commit = git(root, ["rev-parse", "HEAD"]);
      await expect(assertCampaignRepositoryBinding({ commit, policyPath: policy, cwd: root })).rejects.toThrow(
        /host policy .*symlink/,
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

async function writeCheckedModel(root: string, revision: string): Promise<void> {
  const files = modelFiles(revision);
  const first = await compile(new FakeRepositoryPort({ revision, files }));
  if (!first.accepted || first.identity === undefined) throw new Error("checked-model fixture did not compile");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  for (const [name, content] of Object.entries(first.views)) {
    await writeFile(join(root, "validation-design", name), content, "utf8");
  }
}

function modelFiles(revision: string): Record<string, string> {
  const emptyLayers = ["L2", "L3", "L4", "L5", "L6"].map((id) => ({
    id,
    title: id,
    status: "declared-empty",
    reason: "Fixture has no cases at this layer.",
  }));
  const emptyLanes = ["triggered", "release", "scheduled"].map((id) => ({
    id,
    title: id,
    kind: "evidence",
    status: "declared-empty",
    requirement: "blocking",
    triggers: ["fixture"],
    reason: "Fixture has no cases in this lane.",
  }));
  return {
    [MODEL_RELATIVE_PATHS[0]]: stringify({
      schema: "validation-architect/model/project/v1",
      product: {
        id: "seed",
        name: "Seed",
        revision,
        intended_use: "Test fixture.",
        criticality: "C0",
        criticality_reason: "Offline fixture.",
      },
      versions: {
        package: "0.4.2",
        method: "0.8.0",
        model: "validation-architect/corpus/v1",
        compiler: "validation-architect/compiler/v1",
        policy: "validation-architect/policy/v1",
        result: "validation-architect/result/v1",
        golden_set: "validation-architect/golden-set/v1",
      },
    }),
    [MODEL_RELATIVE_PATHS[1]]: stringify({
      schema: "validation-architect/model/owners/v1",
      owners: [{ id: "owner", name: "Owner", responsibility: "Fixture." }],
    }),
    [MODEL_RELATIVE_PATHS[2]]: stringify({
      schema: "validation-architect/model/sources/v1",
      sources: [{ id: "SOURCE", kind: "doc", path: HOST_POLICY_RELATIVE_PATH }],
    }),
    [MODEL_RELATIVE_PATHS[3]]: stringify({
      schema: "validation-architect/model/structures/v1",
      structures: [
        {
          id: "INV-SEED",
          kind: "invariant",
          title: "Seed invariant",
          meaning: "The fixture stays closed.",
          owner: "owner",
          source_ids: ["SOURCE"],
        },
      ],
    }),
    [MODEL_RELATIVE_PATHS[4]]: stringify({
      schema: "validation-architect/model/policy/v1",
      default: "blocking",
      inheritance: "tighten-only",
      layers: [{ id: "L1", title: "L1", status: "active" }, ...emptyLayers],
      lanes: [
        {
          id: "inner-loop",
          title: "Inner loop",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["before-push"],
          command: "pnpm test",
        },
        {
          id: "per-commit",
          title: "Per commit",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["per-commit"],
          command: "pnpm test",
        },
        ...emptyLanes,
      ],
      exceptions: [],
    }),
    [MODEL_RELATIVE_PATHS[5]]: stringify({
      schema: "validation-architect/model/controls/v1",
      controls: [
        {
          id: "NC-SEED",
          title: "Seed control",
          family_id: "CF-SEED",
          owner: "owner",
          expected_failure: "Seeded drift fails.",
        },
      ],
    }),
    [MODEL_RELATIVE_PATHS[6]]: stringify({
      schema: "validation-architect/model/families/v1",
      families: [
        {
          id: "CF-SEED",
          title: "Seed",
          meaning: "Seed family.",
          structure_ids: ["INV-SEED"],
          owner: "owner",
          source_ids: ["SOURCE"],
          lane: "per-commit",
          status: "implementable",
          layer: "L1",
          oracle: "det",
          risk: "FLOOR",
          control_ids: ["NC-SEED"],
          ticket: "HB-001",
          planned_tests: ["tests/seed.test.ts"],
        },
      ],
    }),
    [MODEL_RELATIVE_PATHS[7]]: stringify({
      schema: "validation-architect/model/backlog/v1",
      tickets: [
        {
          id: "HB-001",
          title: "Seed ticket",
          wave: "0",
          status: "landed",
          owner: "owner",
          executor: "builder",
          lane: "per-commit",
          layer: "L1",
          acceptance_criteria: ["Seed is closed."],
          family_ids: ["CF-SEED"],
        },
      ],
    }),
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
