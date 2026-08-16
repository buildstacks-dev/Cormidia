// CF-REG-278 — HB-139 — #465 authority-transition regression detector.
// Cormidia-owned qualification facts come only from
// docs/qualification/host-policy.yaml. Validation Architect authority is a
// separate, fail-closed legacy-or-exact-model selection.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  auditHostPolicyPins,
  HOST_POLICY_PINS,
  HOST_POLICY_RELATIVE_PATH,
  loadQualificationPolicy,
  type QualificationPolicy,
} from "./qualification-policy-loader.js";
import { auditCoreChecksWorkflow, auditVitestConfigs, PolicyLoadError } from "./policy-loader.js";
import { LEGACY_VALIDATION_POLICY_RELATIVE_PATH, MODEL_RELATIVE_PATHS } from "../../fixtures/validation-authority.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hostPolicyPath = join(repoRoot, HOST_POLICY_RELATIVE_PATH);
const workflowPath = join(repoRoot, ".github", "workflows", "core-checks.yml");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(options: { legacy?: boolean; modelCount?: number; host?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "qualification-policy-pin-"));
  temporaryRoots.push(root);
  const host = join(root, HOST_POLICY_RELATIVE_PATH);
  mkdirSync(dirname(host), { recursive: true });
  writeFileSync(host, options.host ?? readFileSync(hostPolicyPath, "utf8"));
  if (options.legacy !== false) {
    const legacy = join(root, LEGACY_VALIDATION_POLICY_RELATIVE_PATH);
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, "schema_version: 1\n");
  }
  for (const path of MODEL_RELATIVE_PATHS.slice(0, options.modelCount ?? 0)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, "schema: fixture\n");
  }
  return root;
}

function symlinkedDesignFixture(kind: "legacy" | "model"): string {
  const root = fixture({ legacy: false });
  const target = mkdtempSync(join(tmpdir(), "qualification-policy-design-target-"));
  temporaryRoots.push(target);
  if (kind === "legacy") {
    writeFileSync(join(target, "validation-policy.yaml"), "schema_version: 1\n");
  } else {
    const sentinel = join(target, "model", MODEL_RELATIVE_PATHS[0].split("/").at(-1) ?? "structures.yaml");
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, "schema: fixture\n");
  }
  symlinkSync(target, join(root, "validation-design"), "dir");
  return root;
}

describe("Cormidia qualification host policy", () => {
  it("loads the closed host schema and preserves every ratified host pin", () => {
    const loaded = loadQualificationPolicy(repoRoot);
    expect(loaded.policyPath).toBe(hostPolicyPath);
    expect(loaded.hostPolicy.schema).toBe("cormidia/qualification-host-policy/v1");
    expect(loaded.hostPolicy.release_qualification.required_l3_case_ids).toEqual(HOST_POLICY_PINS.required_l3_case_ids);
    expect(loaded.hostPolicy.outcome_acceptance.axis_score.thresholds).toBe("none");
    expect(loaded.hostPolicy.active_revision_catalog.registered_structure_ids).toEqual(
      HOST_POLICY_PINS.registered_structure_ids,
    );
    expect(auditHostPolicyPins(loaded)).toEqual([]);
  });

  it("negative control: a changed host fact fires the ratified pin audit", () => {
    const loaded = loadQualificationPolicy(repoRoot);
    const drifted: QualificationPolicy = {
      ...loaded,
      hostPolicy: {
        ...loaded.hostPolicy,
        release_qualification: {
          ...loaded.hostPolicy.release_qualification,
          required_l3_case_ids: loaded.hostPolicy.release_qualification.required_l3_case_ids.slice(1),
        },
      },
    };
    expect(auditHostPolicyPins(drifted)).toContainEqual(expect.stringContaining("required_l3_case_ids"));

    const scopeDrift: QualificationPolicy = structuredClone(loaded);
    scopeDrift.hostPolicy.release_qualification.campaign_spend.launchd_proof.max_provider_turns = 24;
    expect(auditHostPolicyPins(scopeDrift)).toContainEqual(expect.stringContaining("campaign_spend.launchd_proof"));

    const ruleDrift: QualificationPolicy = {
      ...loaded,
      hostPolicy: {
        ...loaded.hostPolicy,
        outcome_acceptance: {
          ...loaded.hostPolicy.outcome_acceptance,
          axis_score: {
            ...loaded.hostPolicy.outcome_acceptance.axis_score,
            rules: ["changed", ...loaded.hostPolicy.outcome_acceptance.axis_score.rules.slice(1)],
          },
        },
      },
    };
    expect(auditHostPolicyPins(ruleDrift)).toContainEqual(expect.stringContaining("axis_score.rules"));
  });

  it("negative control: malformed, open, or missing host-policy fields fail closed", () => {
    expect(() => loadQualificationPolicy(fixture({ host: "release_qualification: [\n" }))).toThrow(PolicyLoadError);
    const withUnknown = `${readFileSync(hostPolicyPath, "utf8")}\nunknown_root: forbidden\n`;
    expect(() => loadQualificationPolicy(fixture({ host: withUnknown }))).toThrow(/closed schema/);
    const missing = readFileSync(hostPolicyPath, "utf8").replace("product: cormidia\n", "");
    expect(() => loadQualificationPolicy(fixture({ host: missing }))).toThrow(/missing: product/);
  });
});

describe("transition-aware Validation Architect authority", () => {
  it("uses the temporary root legacy bridge only when zero model files exist", () => {
    expect(loadQualificationPolicy(fixture()).validationAuthority).toEqual({
      kind: "legacy",
      paths: [LEGACY_VALIDATION_POLICY_RELATIVE_PATH],
    });
  });

  it.each(["legacy", "model"] as const)(
    "negative control: a symlinked validation-design ancestor cannot supply %s authority",
    (kind) => {
      expect(() => loadQualificationPolicy(symlinkedDesignFixture(kind))).toThrow(
        /validation-design is not a regular non-symlink directory/,
      );
    },
  );

  it("ignores non-sentinel model-root content while zero exact model files exist", () => {
    const root = fixture();
    const modelRoot = join(root, "validation-design/model");
    mkdirSync(modelRoot, { recursive: true });
    writeFileSync(join(modelRoot, "README.md"), "authoring notes\n");
    writeFileSync(join(modelRoot, "extra.yaml"), "not-an-authority-sentinel: true\n");
    expect(loadQualificationPolicy(root).validationAuthority.kind).toBe("legacy");
  });

  it("selects the exact ordered eight-file model whenever all eight exist", () => {
    expect(
      loadQualificationPolicy(fixture({ legacy: false, modelCount: MODEL_RELATIVE_PATHS.length })).validationAuthority,
    ).toEqual({ kind: "model", paths: MODEL_RELATIVE_PATHS });
  });

  it("negative control: complete model and root legacy authority cannot coexist", () => {
    expect(() => loadQualificationPolicy(fixture({ modelCount: MODEL_RELATIVE_PATHS.length }))).toThrow(
      /cannot coexist/,
    );
  });

  it("negative control: a partial model fails without legacy fallback", () => {
    expect(() => loadQualificationPolicy(fixture({ modelCount: 1 }))).toThrow(/exact eight-file set/);
  });

  it("negative control: a sentinel plus an unexpected model entry fails closed", () => {
    const root = fixture({ modelCount: 1 });
    writeFileSync(join(root, "validation-design/model/extra.yaml"), "schema: unexpected\n");
    expect(() => loadQualificationPolicy(root)).toThrow(/contains unexpected entries: extra.yaml/);
  });

  it("negative control: an archive lookalike never substitutes for root authority", () => {
    const root = fixture({ legacy: false });
    const archived = join(root, "validation-design/migration/legacy/validation-policy.yaml");
    mkdirSync(dirname(archived), { recursive: true });
    writeFileSync(archived, "schema_version: 1\n");
    expect(() => loadQualificationPolicy(root)).toThrow(/zero checked-model files requires/);
  });
});

describe("mechanical CI and lane pins remain independent of authority mode", () => {
  it("keeps the checked core workflow and Vitest lane separation green", async () => {
    expect(auditCoreChecksWorkflow(readFileSync(workflowPath, "utf8"))).toEqual([]);
    const defaultConfig = await import(pathToFileURL(join(repoRoot, "vitest.config.ts")).href);
    const liveConfig = await import(pathToFileURL(join(repoRoot, "tests/live/vitest.config.ts")).href);
    expect(auditVitestConfigs(defaultConfig.default, liveConfig.default)).toEqual([]);
  });

  it("negative controls fire for a dropped core test and permissive Vitest config", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace("run: pnpm test", "run: pnpm build");
    expect(auditCoreChecksWorkflow(workflow)).toContainEqual(expect.stringContaining("pnpm test"));
    expect(
      auditVitestConfigs(
        { test: { include: [], exclude: [], passWithNoTests: true } },
        { test: { include: ["tests/**"] } },
      ),
    ).not.toEqual([]);
  });

  it("serializing a host copy never requires or emits legacy VA host fields", () => {
    const host = loadQualificationPolicy(repoRoot).hostPolicy;
    const rendered = stringify(host);
    expect(rendered).toContain("release_qualification:");
    expect(rendered).not.toContain("design_status:");
    expect(rendered).not.toContain("proposed_register:");
  });
});
