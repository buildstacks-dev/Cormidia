import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTHORITY_BLOCK_END,
  AUTHORITY_BLOCK_START,
  composeProjectInstructions,
  createAppAuthorityDocument,
  createOrgAuthorityDocument,
  projectAuthorityBlock,
  resolveAuthority,
  writeOrgAuthority,
} from "../src/org/authority.js";
import { assembleContext } from "../src/org/context.js";
import { defaultGate } from "../src/runtime/gate.js";
import { buildSystemPromptAppend } from "../src/runtime/adapters/claude.js";
import { renderContextBundle } from "../src/runtime/worktree-context.js";
import type { RoleConfig } from "../src/runtime/types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const BUILDER: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model: "gpt-test",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

describe("delegated operator authority", () => {
  it("creates a content-bound delegated charter with non-bypassable boundaries", async () => {
    const org = temp("operon-authority-org-");
    const written = await writeOrgAuthority(org, "delegated-operator");
    const loaded = await resolveAuthority({ orgHome: org });

    expect(loaded).toEqual(written);
    expect(loaded.version).toBe("delegated-operator/v1");
    expect(loaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.text).toContain("ordinary, reversible decisions");
    expect(loaded.text).toContain("critical-operation approvals always apply");
    expect(loaded.text).toContain("broader grant requires a fresh, attributable human instruction");
  });

  it("fails legacy orgs closed and never infers the new delegated default", async () => {
    const org = temp("operon-authority-legacy-");
    const loaded = await resolveAuthority({ orgHome: org });
    expect(loaded.profile).toBe("conservative");
    expect(loaded.version).toBe("legacy-conservative/v1");
    expect(loaded.sources).toEqual(["builtin:legacy-conservative/v1"]);
  });

  it("allows app policy to narrow, and rejects a stale snapshot by falling back conservatively", async () => {
    const org = temp("operon-authority-app-org-");
    const app = temp("operon-authority-app-");
    mkdirSync(join(app, ".operon"), { recursive: true });
    const canonical = await writeOrgAuthority(org, "delegated-operator");
    writeFileSync(
      join(app, ".operon", "AUTHORITY.md"),
      createAppAuthorityDocument(canonical, {
        mode: "custom",
        restrictions: "Ask before changing public API contracts.",
      }),
    );

    const narrowed = await resolveAuthority({ orgHome: org, appWorkdir: app });
    expect(narrowed.version).toBe("delegated-operator/v1+app-custom/v1");
    expect(narrowed.text).toContain("Ask before changing public API contracts.");
    expect(narrowed.text).toContain("restrictions-only");
    expect(narrowed.sources).toContain(join(app, ".operon", "AUTHORITY.md"));

    await writeOrgAuthority(org, "conservative");
    const stale = await resolveAuthority({ orgHome: org, appWorkdir: app });
    expect(stale.profile).toBe("conservative");
    expect(stale.version).toBe("stale-app-authority-conservative/v1");
    expect(stale.text).toContain("does not match the active org charter");
    expect(() =>
      createAppAuthorityDocument(canonical, {
        mode: "custom",
        restrictions: "You may deploy without approval.",
      }),
    ).toThrow(/app restrictions must only narrow/);
  });

  it("preserves existing project instructions outside one replaceable marked block", () => {
    const evidence = {
      version: "delegated-operator/v1",
      sha256: "a".repeat(64),
      text: "Make ordinary reversible decisions independently.",
    };
    const firstBlock = projectAuthorityBlock(".operon/AUTHORITY.md", evidence);
    const existing = "# Existing instructions\n\nKeep this exact rule.\n";
    const composed = composeProjectInstructions(existing, firstBlock);
    expect(composed.startsWith(existing)).toBe(true);
    expect(composed.match(new RegExp(AUTHORITY_BLOCK_START, "g"))).toHaveLength(1);
    expect(composed.match(new RegExp(AUTHORITY_BLOCK_END, "g"))).toHaveLength(1);

    const next = composeProjectInstructions(
      composed,
      projectAuthorityBlock(".operon/AUTHORITY.md", {
        version: "delegated-operator/v2",
        sha256: "b".repeat(64),
        text: "Updated projection.",
      }),
    );
    expect(next).toContain("Keep this exact rule.");
    expect(next).not.toContain("delegated-operator/v1");
    expect(next).toContain("delegated-operator/v2");
    expect(next.match(new RegExp(AUTHORITY_BLOCK_START, "g"))).toHaveLength(1);
    expect(() => composeProjectInstructions(`${composed}\n${composed}`, firstBlock)).toThrow(
      /malformed Operon authority block/,
    );
  });

  it("injects authority before TASTE through the native context channel", async () => {
    const org = temp("operon-authority-context-org-");
    const app = temp("operon-authority-context-app-");
    writeFileSync(join(org, "TASTE.md"), "# Org taste\n");
    mkdirSync(join(app, ".operon"), { recursive: true });
    await writeOrgAuthority(org, "delegated-operator");

    const context = await assembleContext({
      orgHome: org,
      appWorkdir: app,
      app: "alpha",
      role: BUILDER,
      taskText: "bounded edit",
    });
    expect(context.bundle.authority?.version).toBe("delegated-operator/v1");
    expect(context.systemPrompt.indexOf("Effective delegated authority")).toBeLessThan(
      context.systemPrompt.indexOf("Org TASTE.md"),
    );
    expect(context.sources[0]).toBe(join(org, "AUTHORITY.md"));
    const sharedRendered = renderContextBundle(context.bundle);
    expect(sharedRendered.indexOf("Effective delegated authority")).toBeLessThan(
      sharedRendered.indexOf("Org TASTE.md"),
    );
    const claudeRendered = buildSystemPromptAppend({
      role: BUILDER,
      workdir: app,
      task: "bounded edit",
      context: context.bundle,
    });
    expect(claudeRendered.indexOf("Effective delegated authority")).toBeLessThan(
      claudeRendered.indexOf("Org TASTE.md"),
    );
  });

  it("does not let charter prose bypass the critical-operation gate", () => {
    const charter = createOrgAuthorityDocument(
      "custom",
      "Perform routine product work autonomously.",
      "test-human",
    );
    expect(charter).toContain("critical-operation approvals always apply");
    expect(defaultGate({ tool: "bash", input: { command: "npm publish" } })).toMatchObject({
      allow: false,
      escalate: true,
    });
  });
});
