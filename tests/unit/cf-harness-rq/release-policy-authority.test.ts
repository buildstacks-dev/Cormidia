// Traceability: CF-HARNESS-RQ · HB-113 · #465 validation-authority transition.

import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { stringify as stringifyYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  QUALIFICATION_HOST_POLICY_PATH,
  parseQualificationHostPolicy,
} from "../../../src/org/qualification-host-policy.js";
import { parsePublicModelCompilerSuccess } from "../../../src/org/release-candidate-validation.js";
import {
  execPinnedReleasePnpm,
  RELEASE_CANDIDATE_INSTALL_ARGS,
  releaseExecutionEnvironment,
  releaseNodeVersion,
  releasePackageStore,
} from "../../../src/org/release-package-manager.js";
import {
  LEGACY_VALIDATION_POLICY_PATH,
  loadReleasePolicyAuthority,
  VALIDATION_MODEL_PATHS,
} from "../../../src/org/release-policy-authority.js";
import { loadReleasePolicyAuthorityFromGit } from "../../../src/org/release-policy-git.js";
import { LEGACY_RELEASE_POLICY_FIXTURE } from "../../fixtures/legacy-release-policy.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("release policy authority transition", () => {
  it("pins the offline installed pnpm to the source installation store and refuses corrupt metadata", async () => {
    const repo = await mkdtemp(join(tmpdir(), "release-package-manager-"));
    roots.push(repo);
    const store = join(repo, "store");
    const bin = join(repo, "bin");
    await mkdir(join(repo, "node_modules"), { recursive: true });
    await mkdir(store);
    await mkdir(bin);
    await writeFile(join(repo, "package.json"), '{"packageManager":"pnpm@11.10.0"}\n', "utf8");
    await writeFile(
      join(repo, "node_modules", ".modules.yaml"),
      stringifyYaml({ packageManager: "pnpm@11.10.0", storeDir: store }),
      "utf8",
    );
    expect(await releasePackageStore(repo)).toBe(await realpath(store));
    expect(RELEASE_CANDIDATE_INSTALL_ARGS).toEqual([
      "install",
      "--offline",
      "--frozen-lockfile",
      "--trust-lockfile",
      "--ignore-scripts",
      "--verify-store-integrity",
    ]);

    const pnpm = join(bin, "pnpm");
    await writeFile(
      pnpm,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'11.10.0\\n\'; exit 0; fi\nprintf \'%s|%s|%s\\n\' "$*" "$COREPACK_ENABLE_NETWORK" "$PNPM_CONFIG_STORE_DIR"\n',
      "utf8",
    );
    await chmod(pnpm, 0o755);
    const result = await execPinnedReleasePnpm(repo, ["exec", "probe"], {
      ...releaseExecutionEnvironment(),
      PATH: bin,
      COREPACK_ENABLE_NETWORK: "1",
      PNPM_CONFIG_STORE_DIR: store,
    });
    expect(result.stdout.trim()).toBe(`exec probe|0|${store}`);

    const unsafeMarker = join(repo, "unsafe-command-ran");
    await writeFile(
      pnpm,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'11.9.0\\n\'; exit 0; fi\nprintf \'unsafe command executed\\n\' > "$PNPM_TEST_MARKER"\n',
      "utf8",
    );
    await expect(
      execPinnedReleasePnpm(repo, ["install"], {
        ...releaseExecutionEnvironment(),
        PATH: bin,
        PNPM_TEST_MARKER: unsafeMarker,
      }),
    ).rejects.toThrow(/does not match exact packageManager pin/);
    await expect(readFile(unsafeMarker, "utf8")).rejects.toThrow();
    const node = join(bin, "node");
    await writeFile(node, "#!/bin/sh\nprintf 'v99.8.7\\n'\n", "utf8");
    await chmod(node, 0o755);
    await expect(
      releaseNodeVersion(repo, { ...releaseExecutionEnvironment(), PATH: `${bin}:${process.env.PATH ?? ""}` }),
    ).resolves.toBe("99.8.7");

    await writeFile(
      join(repo, "node_modules", ".modules.yaml"),
      stringifyYaml({ packageManager: "pnpm@11.10.0", storeDir: "relative-store" }),
      "utf8",
    );
    await expect(releasePackageStore(repo)).rejects.toThrow(/storeDir must be absolute/);
    await rm(join(repo, "node_modules", ".modules.yaml"));
    await expect(releasePackageStore(repo)).rejects.toThrow(/metadata is missing or unreadable/);
  });

  it("accepts only the exact public-compiler identity and product-revision result", () => {
    const revision = "a".repeat(40);
    const stdout = `accepted: model ${"b".repeat(64)} at revision ${revision}\n`;
    expect(parsePublicModelCompilerSuccess(stdout, "", revision)).toEqual({
      identity: "b".repeat(64),
      revision,
    });
    expect(() => parsePublicModelCompilerSuccess(stdout, "warning", revision)).toThrow(/wrote stderr/);
    expect(() => parsePublicModelCompilerSuccess("accepted", "", revision)).toThrow(/output is malformed/);
    expect(() => parsePublicModelCompilerSuccess(stdout, "", "c".repeat(40))).toThrow(/different product revision/);
  });

  it("strictly parses the checked host policy and rejects extension or duplicate identity", async () => {
    const host = await repositoryFile(QUALIFICATION_HOST_POLICY_PATH);
    expect(parseQualificationHostPolicy(host).release_qualification.contract_id).toBe("RQ-1");
    expect(() => parseQualificationHostPolicy(`${host}\nunexpected: true\n`)).toThrow(/closed schema/);
    expect(() =>
      parseQualificationHostPolicy(host.replace("    - CF-J16-A\n", "    - CF-J16-A\n    - CF-J16-A\n")),
    ).toThrow(/must be unique/);
    expect(() =>
      parseQualificationHostPolicy(host.replace("scope: changed adapter only", "scope: all adapters")),
    ).toThrow(/supported v1 scope/);
    expect(() =>
      parseQualificationHostPolicy(host.replace("scope: sandbox GitHub repo only", "scope: changed adapter only")),
    ).toThrow(/supported v1 scope/);
    expect(() =>
      parseQualificationHostPolicy(
        host.replace(
          "scope: all adapters + GitHub + launchd + unattended profile",
          "scope: all adapters + GitHub + unattended profile",
        ),
      ),
    ).toThrow(/supported v1 scope/);
    expect(() =>
      parseQualificationHostPolicy(
        host.replace(
          "on_ceiling_exhaustion: completeness=incomplete; verdict never pass",
          "on_ceiling_exhaustion: completeness=complete; verdict pass",
        ),
      ),
    ).toThrow(/supported v1 refusal behavior/);
    expect(() =>
      parseQualificationHostPolicy(
        host.replace(
          "while a threshold is unratified, every threshold-dependent axis verdict is inconclusive, never pass or fail",
          "while a threshold is unratified, every threshold-dependent axis verdict is pass",
        ),
      ),
    ).toThrow(/exact seven ratified rules/);
  });

  it("preserves the legacy authority only when no model file exists and binds candidate plus both sources", async () => {
    const host = Buffer.from(await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    const legacy = Buffer.from(LEGACY_RELEASE_POLICY_FIXTURE);
    const reads: string[] = [];
    const files = new Map<string, Buffer>([
      [QUALIFICATION_HOST_POLICY_PATH, host],
      [LEGACY_VALIDATION_POLICY_PATH, legacy],
    ]);
    const load = (candidateCommit: string) =>
      loadReleasePolicyAuthority({
        candidateCommit,
        productRevision: candidateCommit,
        modelPaths: [],
        legacyPresent: true,
        validateModel: async () => {
          throw new Error("legacy authority must not invoke the model compiler");
        },
        read: async (path) => {
          reads.push(path);
          return files.get(path) ?? null;
        },
      });
    const first = await load("a".repeat(40));
    const second = await load("b".repeat(40));
    expect(first.kind).toBe("legacy");
    expect(first.source_digests.map((row) => row.path)).toEqual([
      QUALIFICATION_HOST_POLICY_PATH,
      LEGACY_VALIDATION_POLICY_PATH,
    ]);
    expect(first.bundle_digest).not.toBe(second.bundle_digest);
    expect(reads).toContain(LEGACY_VALIDATION_POLICY_PATH);

    const ignoredNonSentinel = await loadReleasePolicyAuthority({
      candidateCommit: "c".repeat(40),
      productRevision: "c".repeat(40),
      modelPaths: ["validation-design/model/README.md"],
      legacyPresent: true,
      validateModel: async () => {
        throw new Error("a non-sentinel must not select model authority");
      },
      read: async (path) => files.get(path) ?? null,
    });
    expect(ignoredNonSentinel.kind).toBe("legacy");
    files.set(
      LEGACY_VALIDATION_POLICY_PATH,
      Buffer.from(legacy.toString("utf8").replace("status: ACTIVE", "status: BLOCKED")),
    );
    await expect(load("d".repeat(40))).rejects.toThrow(/does not admit CF-B01-L3/);
  });

  it("fails closed on a partial model without reading the legacy authority", async () => {
    const host = Buffer.from(await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    const reads: string[] = [];
    const files = new Map<string, Buffer>([
      [QUALIFICATION_HOST_POLICY_PATH, host],
      [VALIDATION_MODEL_PATHS[0], Buffer.from("schema: validation-architect/model/project/v1\n")],
    ]);
    await expect(
      loadReleasePolicyAuthority({
        candidateCommit: "a".repeat(40),
        productRevision: "a".repeat(40),
        modelPaths: [VALIDATION_MODEL_PATHS[0]],
        legacyPresent: true,
        validateModel: async () => {
          throw new Error("partial authority must not invoke the model compiler");
        },
        read: async (path) => {
          reads.push(path);
          return files.get(path) ?? null;
        },
      }),
    ).rejects.toThrow(/partial \(1\/8\).*fallback is forbidden/);
    expect(reads).not.toContain(LEGACY_VALIDATION_POLICY_PATH);
  });

  it("uses exact Git sentinels: non-authority model-root content stays legacy, then one sentinel fails closed", async () => {
    const repo = await mkdtemp(join(tmpdir(), "release-policy-sentinels-"));
    roots.push(repo);
    await git(repo, ["init", "-q"]);
    await git(repo, ["config", "user.email", "fixture@example.test"]);
    await git(repo, ["config", "user.name", "Fixture"]);
    await trackedWrite(repo, QUALIFICATION_HOST_POLICY_PATH, await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    await trackedWrite(repo, LEGACY_VALIDATION_POLICY_PATH, LEGACY_RELEASE_POLICY_FIXTURE);
    await trackedWrite(repo, "validation-design/model/README.md", "non-authority guidance\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "legacy with model guidance"]);
    const legacyCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(
      loadReleasePolicyAuthorityFromGit(repo, legacyCommit, async () => {
        throw new Error("non-sentinel content must not invoke the model compiler");
      }),
    ).resolves.toMatchObject({ kind: "legacy" });

    await trackedWrite(repo, VALIDATION_MODEL_PATHS[0], "schema: validation-architect/model/project/v1\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "seed one exact model sentinel"]);
    const partialCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(
      loadReleasePolicyAuthorityFromGit(repo, partialCommit, async () => {
        throw new Error("partial authority must not invoke the model compiler");
      }),
    ).rejects.toThrow(/not the exact eight-file set.*README\.md.*fallback is forbidden/);
  });

  it("rejects a symlinked model sentinel before compiler admission can read different bytes", async () => {
    const repo = await mkdtemp(join(tmpdir(), "release-policy-symlink-"));
    roots.push(repo);
    await git(repo, ["init", "-q"]);
    await git(repo, ["config", "user.email", "fixture@example.test"]);
    await git(repo, ["config", "user.name", "Fixture"]);
    await trackedWrite(repo, QUALIFICATION_HOST_POLICY_PATH, await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    await trackedWrite(repo, LEGACY_VALIDATION_POLICY_PATH, LEGACY_RELEASE_POLICY_FIXTURE);
    await trackedWrite(repo, "validation-design/model/target.yaml", "schema: followed-by-the-compiler\n");
    await symlink("target.yaml", join(repo, VALIDATION_MODEL_PATHS[0]));
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "symlinked model sentinel"]);
    const candidate = await git(repo, ["rev-parse", "HEAD"]);
    await expect(
      loadReleasePolicyAuthorityFromGit(repo, candidate, async () => {
        throw new Error("a non-regular authority sentinel must not invoke the compiler");
      }),
    ).rejects.toThrow(/project\.yaml must be a regular tracked file/);
  });

  it("selects only the exact full model and refuses dual, extra, stale, or unproven authority", async () => {
    const revision = "a".repeat(40);
    const host = Buffer.from(await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    const files = modelFiles(revision, host, true);
    const reads: string[] = [];
    const input = {
      candidateCommit: revision,
      productRevision: revision,
      modelPaths: VALIDATION_MODEL_PATHS,
      legacyPresent: false,
      validateModel: async () => undefined,
      read: async (path: string) => {
        reads.push(path);
        return files.get(path) ?? null;
      },
    };
    const selected = await loadReleasePolicyAuthority(input);
    expect(selected.kind).toBe("model");
    expect(selected.source_digests.map((row) => row.path)).toEqual([
      QUALIFICATION_HOST_POLICY_PATH,
      ...VALIDATION_MODEL_PATHS,
    ]);
    expect(reads).not.toContain(LEGACY_VALIDATION_POLICY_PATH);
    files.set(LEGACY_VALIDATION_POLICY_PATH, Buffer.from("forbidden legacy authority"));
    await expect(loadReleasePolicyAuthority({ ...input, legacyPresent: true })).rejects.toThrow(
      /dual authority is forbidden/,
    );
    files.delete(LEGACY_VALIDATION_POLICY_PATH);
    await expect(
      loadReleasePolicyAuthority({
        ...input,
        modelPaths: [...VALIDATION_MODEL_PATHS, "validation-design/model/extra.yaml"],
      }),
    ).rejects.toThrow(/unexpected: validation-design\/model\/extra.yaml.*fallback is forbidden/);
    await expect(loadReleasePolicyAuthority({ ...input, productRevision: "b".repeat(40) })).rejects.toThrow(
      /product revision is stale/,
    );
    const widenedReleaseLane = modelFiles(revision, host, true);
    const widenedFamilies = widenedReleaseLane.get(VALIDATION_MODEL_PATHS[6]);
    if (widenedFamilies === undefined) throw new Error("model fixture is missing families.yaml");
    const widenedText = widenedFamilies.toString("utf8");
    const widenedSeed = widenedText.replace(
      "lane: per-commit\n    status: implementable\n    layer: L2",
      "lane: live-triggered\n    status: implementable\n    layer: L3",
    );
    if (widenedSeed === widenedText) throw new Error("model fixture could not seed a widened release lane");
    widenedReleaseLane.set(VALIDATION_MODEL_PATHS[6], Buffer.from(widenedSeed));
    await expect(
      loadReleasePolicyAuthority({ ...input, read: async (path) => widenedReleaseLane.get(path) ?? null }),
    ).rejects.toThrow(/release-qualification lane has non-denominator family CF-J14-S/);
    const missingFinding = modelFiles(revision, host, false);
    const familiesPath = VALIDATION_MODEL_PATHS[6];
    const unrelated = missingFinding.get(familiesPath);
    if (unrelated === undefined) throw new Error("model fixture is missing families.yaml");
    missingFinding.set(
      familiesPath,
      Buffer.from(unrelated.toString("utf8").replace("Release family CF-B02-L3.", "Mentions F-PT-012 elsewhere.")),
    );
    await expect(
      loadReleasePolicyAuthority({
        candidateCommit: revision,
        productRevision: revision,
        modelPaths: VALIDATION_MODEL_PATHS,
        legacyPresent: false,
        validateModel: async () => undefined,
        read: async (path) => missingFinding.get(path) ?? null,
      }),
    ).rejects.toThrow(/does not preserve F-PT-012 on its exact CF-J14-S skipped-test family/);
  });

  it("matches upstream product revision: host policy advances it and validation-design-only refresh does not", async () => {
    const repo = await mkdtemp(join(tmpdir(), "release-policy-revision-"));
    roots.push(repo);
    await git(repo, ["init", "-q"]);
    await git(repo, ["config", "user.email", "fixture@example.test"]);
    await git(repo, ["config", "user.name", "Fixture"]);
    const host = Buffer.from(await repositoryFile(QUALIFICATION_HOST_POLICY_PATH));
    await trackedWrite(repo, "src/product.ts", "export const product = true;\n");
    await trackedWrite(repo, QUALIFICATION_HOST_POLICY_PATH, host);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "product base"]);
    const productRevision = await git(repo, ["rev-parse", "HEAD"]);

    for (const [path, bytes] of modelFiles(productRevision, host, true)) await trackedWrite(repo, path, bytes);
    await generateModelViews(repo);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "model authority"]);
    const modelCommit = await git(repo, ["rev-parse", "HEAD"]);
    const validateModel = (expectedRevision: string) => validateModelWithCli(repo, expectedRevision);
    await expect(loadReleasePolicyAuthorityFromGit(repo, modelCommit, validateModel)).resolves.toMatchObject({
      kind: "model",
    });
    const generatedView = "validation-design/case-catalog.md";
    const generatedBytes = await readFile(join(repo, generatedView), "utf8");
    await rm(join(repo, generatedView));
    await trackedWrite(repo, "validation-design/view-target.md", generatedBytes);
    await symlink("view-target.md", join(repo, generatedView));
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", "seed symlinked generated view"]);
    const symlinkedViewCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(loadReleasePolicyAuthorityFromGit(repo, symlinkedViewCommit, validateModel)).rejects.toThrow(
      /case-catalog\.md must be a regular tracked file/,
    );
    await rm(join(repo, generatedView));
    await rm(join(repo, "validation-design/view-target.md"));
    await trackedWrite(repo, generatedView, generatedBytes);
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", "restore regular generated view"]);
    for (const retired of ["validation-design/case-catalog.yaml", "validation-design/case-catalog-generator.awk"]) {
      await trackedWrite(repo, retired, "retired root authority input\n");
      await git(repo, ["add", retired]);
      await git(repo, ["commit", "-qm", `seed ${retired}`]);
      const dualCommit = await git(repo, ["rev-parse", "HEAD"]);
      await expect(loadReleasePolicyAuthorityFromGit(repo, dualCommit, validateModel)).rejects.toThrow(
        /checked-model dual authority is forbidden/,
      );
      await rm(join(repo, retired));
      await git(repo, ["add", "-A"]);
      await git(repo, ["commit", "-qm", `remove ${retired}`]);
    }

    await trackedWrite(repo, QUALIFICATION_HOST_POLICY_PATH, `${host.toString("utf8")}\n# host-only revision\n`);
    await git(repo, ["add", QUALIFICATION_HOST_POLICY_PATH]);
    await git(repo, ["commit", "-qm", "host policy clarification"]);
    const hostCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(loadReleasePolicyAuthorityFromGit(repo, hostCommit, validateModel)).rejects.toThrow(
      /product revision is stale/,
    );

    const refreshed = modelFiles(hostCommit, Buffer.from(`${host.toString("utf8")}\n# host-only revision\n`), true);
    const project = refreshed.get(VALIDATION_MODEL_PATHS[0]);
    if (project === undefined) throw new Error("refreshed model fixture is missing project.yaml");
    await trackedWrite(repo, VALIDATION_MODEL_PATHS[0], project);
    await generateModelViews(repo);
    await git(repo, ["add", "validation-design"]);
    await git(repo, ["commit", "-qm", "refresh model product revision"]);
    const refreshCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(loadReleasePolicyAuthorityFromGit(repo, refreshCommit, validateModel)).resolves.toMatchObject({
      kind: "model",
    });

    const familiesPath = VALIDATION_MODEL_PATHS[6];
    const validFamilies = await readFile(join(repo, familiesPath), "utf8");
    await trackedWrite(repo, familiesPath, validFamilies.replace("owner: OWNER-RQ", "owner: OWNER-MISSING"));
    await git(repo, ["add", familiesPath]);
    await git(repo, ["commit", "-qm", "seed invalid model cross-link"]);
    const invalidModelCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(loadReleasePolicyAuthorityFromGit(repo, invalidModelCommit, validateModel)).rejects.toThrow(
      /missing owner OWNER-MISSING/,
    );
    await trackedWrite(repo, familiesPath, validFamilies);
    await git(repo, ["add", familiesPath]);
    await git(repo, ["commit", "-qm", "restore valid model"]);

    await trackedWrite(repo, "src/product.ts", "export const product = false;\n");
    await git(repo, ["add", "src/product.ts"]);
    await git(repo, ["commit", "-qm", "product change"]);
    const productCommit = await git(repo, ["rev-parse", "HEAD"]);
    await expect(loadReleasePolicyAuthorityFromGit(repo, productCommit, validateModel)).rejects.toThrow(
      /product revision is stale/,
    );
  });
});

function modelFiles(productRevision: string, host: Buffer, citeFinding: boolean): Map<string, Buffer> {
  const policy = parseQualificationHostPolicy(host.toString("utf8"));
  const ids = policy.release_qualification.required_l3_case_ids;
  const releaseFamilies = ids.map((id) => ({
    id,
    title: `RQ-1 release family ${id}`,
    meaning: `Release family ${id}.`,
    structure_ids: ["CON-RQ1"],
    owner: "OWNER-RQ",
    source_ids: ["SOURCE-HOST"],
    lane: "live-triggered",
    status: "implementable",
    layer: "L3",
    oracle: "contract",
    risk: "E2",
    control_ids: [`NC-${id}`],
    ticket: "HB-RQ",
    planned_tests: ["tests/live/release.test.ts"],
    exclusions: ["Requires separate human authorization before provider spend"],
  }));
  const findingFamily = {
    id: "CF-J14-S",
    title: "Reset-order blocker",
    meaning: citeFinding ? "Preserves the exact execute-order clause BLOCKED:F-PT-012." : "Reset-order family.",
    structure_ids: ["CON-RQ1"],
    owner: "OWNER-RQ",
    source_ids: ["SOURCE-HOST"],
    lane: "per-commit",
    status: "implementable",
    layer: "L2",
    oracle: "state+diff",
    risk: "E1",
    control_ids: ["NC-CF-J14-S"],
    ticket: "HB-FINDING",
    planned_tests: ["tests/hermetic/cf-inv-010-cf-j14-a-cf-j14-i-cf-j14-r-cf-j14-rc-cf-j14-s/cf-j14-s.test.ts"],
    exclusions: citeFinding ? ["The F-PT-012 remainder is preserved."] : ["No blocker preserved."],
  };
  const families = [...releaseFamilies, findingFamily];
  const documents: unknown[] = [
    {
      schema: "validation-architect/model/project/v1",
      product: {
        id: "cormidia",
        name: "Cormidia release fixture",
        revision: productRevision,
        intended_use: "Offline public-compiler release-authority validation",
        criticality: "C1",
        criticality_reason: "Disposable fixture with no external effect",
      },
      versions: {
        package: "0.4.6",
        method: "0.8.0",
        model: "validation-architect/corpus/v1",
        compiler: "validation-architect/compiler/v1",
        policy: "validation-architect/policy/v1",
        result: "validation-architect/result/v1",
        golden_set: "validation-architect/golden-set/v1",
      },
    },
    {
      schema: "validation-architect/model/owners/v1",
      owners: [{ id: "OWNER-RQ", name: "Release owner", responsibility: "Own RQ-1 evidence" }],
    },
    {
      schema: "validation-architect/model/sources/v1",
      sources: [{ id: "SOURCE-HOST", kind: "doc", path: QUALIFICATION_HOST_POLICY_PATH, locator: "RQ-1" }],
    },
    {
      schema: "validation-architect/model/structures/v1",
      structures: [
        {
          id: "CON-RQ1",
          kind: "contract",
          title: "Release qualification",
          meaning: "RQ-1 binds the exact release evidence subject",
          owner: "OWNER-RQ",
          source_ids: ["SOURCE-HOST"],
          acceptance_criteria: [
            "Bind the exact candidate commit",
            "Bind every selected validation-authority byte",
            "Refuse incomplete or stale release evidence",
          ],
          changed_paths: ["src/**"],
        },
      ],
    },
    {
      schema: "validation-architect/model/policy/v1",
      default: "blocking",
      inheritance: "tighten-only",
      layers: [
        { id: "L1", title: "Invariant", status: "declared-empty", reason: "Focused L3 fixture" },
        { id: "L2", title: "Hermetic", status: "active" },
        { id: "L3", title: "Live sandbox", status: "active" },
        { id: "L4", title: "Evaluation", status: "declared-empty", reason: "Focused L3 fixture" },
        { id: "L5", title: "Operations", status: "declared-empty", reason: "C1 fixture" },
        { id: "L6", title: "Outcome", status: "declared-empty", reason: "Focused L3 fixture" },
      ],
      lanes: [
        {
          id: "inner-loop",
          title: "Local checks",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["before-push"],
          command: "pnpm test",
        },
        {
          id: "per-commit",
          title: "Commit checks",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["per-commit"],
          command: "pnpm test",
        },
        {
          id: "live-triggered",
          title: "Live RQ-1",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["release-qualification"],
          command: "pnpm test:live",
          authorization: "per-run-human",
        },
        {
          id: "triggered",
          title: "Triggered evidence",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "Focused live fixture",
        },
        {
          id: "release",
          title: "Release evidence",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "Live families own this focused fixture",
        },
        {
          id: "scheduled",
          title: "Scheduled evidence",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "No scheduled obligation",
        },
      ],
      exceptions: [],
    },
    {
      schema: "validation-architect/model/controls/v1",
      controls: families.map(({ id }) => ({
        id: `NC-${id}`,
        title: `Seeded failure for ${id}`,
        family_id: id,
        owner: "OWNER-RQ",
        expected_failure: `The ${id} detector fails when its release obligation is bypassed`,
      })),
    },
    { schema: "validation-architect/model/families/v1", families },
    {
      schema: "validation-architect/model/backlog/v1",
      tickets: [
        {
          id: "HB-RQ",
          title: "Run RQ-1 live qualification",
          wave: "0",
          status: "pending",
          owner: "OWNER-RQ",
          executor: "standing coding agent",
          lane: "live-triggered",
          layer: "L3",
          acceptance_criteria: ["Every exact RQ-1 live family has current evidence"],
          family_ids: ids,
        },
        {
          id: "HB-FINDING",
          title: "Preserve the admitted test-skip blocker",
          wave: "0",
          status: "landed",
          owner: "OWNER-RQ",
          executor: "standing coding agent",
          lane: "per-commit",
          layer: "L2",
          acceptance_criteria: ["CF-J14-S preserves the exact F-PT-012 blocked test"],
          family_ids: ["CF-J14-S"],
        },
      ],
    },
  ];
  const files = new Map<string, Buffer>([[QUALIFICATION_HOST_POLICY_PATH, host]]);
  for (const [index, path] of VALIDATION_MODEL_PATHS.entries()) {
    const document = documents[index];
    if (document === undefined) throw new Error(`missing model fixture document for ${path}`);
    files.set(path, Buffer.from(stringifyYaml(document)));
  }
  return files;
}

async function repositoryFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

async function trackedWrite(repo: string, path: string, content: string | Uint8Array): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function git(repo: string, args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd: repo, encoding: "utf8" });
  return result.stdout.trim();
}

async function validateModelWithCli(repo: string, expectedRevision: string): Promise<void> {
  const executable = join(process.cwd(), "node_modules", ".bin", "validation-architect");
  const result = await execFile(executable, ["compile", repo], { encoding: "utf8" });
  if (result.stderr.trim() !== "") throw new Error(`model compiler wrote stderr: ${result.stderr.trim()}`);
  expect(result.stdout.trim()).toMatch(new RegExp(`^accepted: model [a-f0-9]{64} at revision ${expectedRevision}$`));
}

async function generateModelViews(repo: string): Promise<void> {
  const executable = join(process.cwd(), "node_modules", ".bin", "validation-architect");
  await execFile(executable, ["compile", repo, "--write"], { encoding: "utf8" });
}
