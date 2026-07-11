// Tests the content-addressed SystemFingerprint in
// src/org/learning/fingerprint.ts: identical configurations share one id,
// any surface edit changes it, absent inputs read null (never fabricated),
// and the store is write-once by construction. Temp dirs only.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeSystemFingerprint,
  fingerprintPath,
  readFingerprint,
  storeFingerprint,
  type ComputeFingerprintOptions,
} from "../../src/org/learning/fingerprint.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ENV = { node: "v26.1.0", platform: "darwin" };

function orgSurfaces(root: string): void {
  writeFileSync(join(root, "TASTE.md"), "# Taste\n");
  writeFileSync(join(root, "roles.yaml"), "roles: {}\n");
  writeFileSync(join(root, "pipelines.yaml"), "pipelines: {}\n");
  // Prompts nest per pipeline in real org homes — the hash must see them.
  mkdirSync(join(root, "prompts", "build"), { recursive: true });
  writeFileSync(join(root, "prompts", "build", "implement.md"), "implement\n");
  mkdirSync(join(root, "prompts", "review"), { recursive: true });
  writeFileSync(join(root, "prompts", "review", "verify.md"), "verify\n");
}

function options(orgHome: string, overrides: Partial<ComputeFingerprintOptions> = {}): ComputeFingerprintOptions {
  return {
    packageRoot: orgHome, // no package.json — version reads null
    orgHome,
    app: { name: "alpha", budgetUsdMonth: 200 },
    roles: {
      builder: { runtime: "codex", model: "gpt-5.5", effort: "high", maxTurnBudgetUsd: 15 },
      reviewer: { runtime: "claude", model: "claude-fable-5", effort: "high", maxTurnBudgetUsd: 15 },
    },
    env: ENV,
    ...overrides,
  };
}

describe("computeSystemFingerprint", () => {
  it("is content-addressed: identical configurations share one id", async () => {
    const home = makeOrgHome({});
    try {
      orgSurfaces(home.root);
      const first = await computeSystemFingerprint(options(home.root));
      const second = await computeSystemFingerprint(options(home.root));
      expect(first.fingerprint_id).toMatch(/^sys_[0-9a-f]{12}$/);
      expect(second).toEqual(first);
    } finally {
      home.cleanup();
    }
  });

  it("changes id when any org surface, model, or prompt changes", async () => {
    const home = makeOrgHome({});
    try {
      orgSurfaces(home.root);
      const base = await computeSystemFingerprint(options(home.root));

      writeFileSync(join(home.root, "prompts", "build", "implement.md"), "implement v2\n");
      const promptEdit = await computeSystemFingerprint(options(home.root));
      expect(promptEdit.fingerprint_id).not.toBe(base.fingerprint_id);
      expect(promptEdit.org.prompts_hash).not.toBe(base.org.prompts_hash);
      expect(promptEdit.org.taste_hash).toBe(base.org.taste_hash);

      const modelSwap = await computeSystemFingerprint(
        options(home.root, {
          roles: {
            builder: { runtime: "codex", model: "gpt-6", effort: "high", maxTurnBudgetUsd: 15 },
            reviewer: { runtime: "claude", model: "claude-fable-5", effort: "high", maxTurnBudgetUsd: 15 },
          },
        }),
      );
      expect(modelSwap.fingerprint_id).not.toBe(promptEdit.fingerprint_id);
    } finally {
      home.cleanup();
    }
  });

  it("reads null for absent inputs instead of fabricating them", async () => {
    const home = makeOrgHome({});
    try {
      // No org surfaces, no git, no app workdir, no package.json.
      const fingerprint = await computeSystemFingerprint(
        options(home.root, { app: { name: "alpha" } }),
      );
      expect(fingerprint.operon).toEqual({ version: null, commit: null });
      expect(fingerprint.org.taste_hash).toBeNull();
      expect(fingerprint.org.prompts_hash).toBeNull();
      expect(fingerprint.app).toEqual({ name: "alpha", commit: null, config_hash: null });
      expect(fingerprint.budget_caps.app_usd_month).toBeNull();
      expect(fingerprint.gates_hash).toBeNull();
      expect(fingerprint.bundle_versions).toEqual({});
      expect(fingerprint.bundle_lineage).toBe("stable");
    } finally {
      home.cleanup();
    }
  });

  it("captures the app workdir's git head and config hash when they exist", async () => {
    const home = makeOrgHome({});
    try {
      orgSurfaces(home.root);
      const workdir = join(home.root, "app-checkout");
      mkdirSync(join(workdir, ".operon"), { recursive: true });
      writeFileSync(join(workdir, ".operon", "config.yaml"), "commands:\n  test: npm test\n");
      execSync(
        "git init -q && git -c user.email=t@t -c user.name=t add -A && " +
          "git -c user.email=t@t -c user.name=t commit -qm seed",
        { cwd: workdir },
      );

      const fingerprint = await computeSystemFingerprint(
        options(home.root, { app: { name: "alpha", workdir, budgetUsdMonth: 200 } }),
      );
      expect(fingerprint.app.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(fingerprint.app.config_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      home.cleanup();
    }
  });
});

describe("storeFingerprint", () => {
  it("stores content-addressed and reads back", async () => {
    const home = makeOrgHome({});
    try {
      orgSurfaces(home.root);
      const fingerprint = await computeSystemFingerprint(options(home.root));
      const id = await storeFingerprint(home.root, fingerprint);
      expect(id).toBe(fingerprint.fingerprint_id);
      expect(await readFingerprint(home.root, id)).toEqual(fingerprint);
      // Re-store is a no-op by construction.
      await storeFingerprint(home.root, fingerprint);
      expect(fingerprintPath(home.root, id)).toContain("learning/fingerprints/");
    } finally {
      home.cleanup();
    }
  });
});
