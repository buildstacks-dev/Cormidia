// CF-REG-443 — HB-139 — legacy product/taste input stays visible but never enters agent context.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAuthority } from "../../../src/org/authority.js";
import { emitAppArtifacts, parseAnswers } from "../../../src/org/bootstrap.js";
import { assembleContext } from "../../../src/org/context.js";
import { loadRoles } from "../../../src/org/roles.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import { makeTempOrgHome } from "../../fixtures/org-home.js";

const builderRole: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "unit-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

const PLACEHOLDER = "does not add it to the agent's turn";
const CRAFT = "Keep the checkout free of speculative helpers.";

describe("optional taste placeholders are not injected", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function assemble(orgHome: string, appWorkdir: string) {
    return assembleContext({
      orgHome,
      appWorkdir,
      app: "taste-app",
      role: builderRole,
      taskText: "implement the ticket",
    });
  }

  it("skips packaged comment-only role taste and empty app taste", async () => {
    const fixture = await makeTempOrgHome({ name: "taste-skip" });
    cleanups.push(fixture.cleanup);
    const appWorkdir = join(fixture.root, "app");
    await mkdir(join(appWorkdir, ".cormidia"), { recursive: true });
    await writeFile(join(appWorkdir, ".cormidia", "TASTE.md"), "\n", "utf8");

    const assembled = await assemble(fixture.orgHome, appWorkdir);
    expect(assembled.systemPrompt).toContain("Org TASTE.md");
    expect(assembled.systemPrompt).not.toContain("## Role taste/builder.md");
    expect(assembled.systemPrompt).not.toContain("## App .cormidia/TASTE.md");
    expect(assembled.systemPrompt).not.toContain(PLACEHOLDER);
  });

  it("injects remaining craft and strips the HTML comment", async () => {
    const fixture = await makeTempOrgHome({ name: "taste-craft" });
    cleanups.push(fixture.cleanup);
    const appWorkdir = join(fixture.root, "app");
    await mkdir(appWorkdir, { recursive: true });
    await writeFile(join(fixture.orgHome, "taste", "builder.md"), `<!-- ${PLACEHOLDER} -->\n\n${CRAFT}\n`, "utf8");

    const assembled = await assemble(fixture.orgHome, appWorkdir);
    expect(assembled.systemPrompt).toContain("## Role taste/builder.md");
    expect(assembled.systemPrompt).toContain(CRAFT);
    expect(assembled.systemPrompt).not.toContain(PLACEHOLDER);
  });

  it("bootstrap-emitted app taste is a skipped placeholder, even when answers name the product", async () => {
    const fixture = await makeTempOrgHome({ name: "taste-charter" });
    cleanups.push(fixture.cleanup);
    const appWorkdir = join(fixture.root, "app");
    await mkdir(appWorkdir, { recursive: true });
    const allRoles = (await loadRoles(join(fixture.orgHome, "roles.yaml"))).roles.map((role) => role.name);
    const roleName = allRoles[0];
    if (roleName === undefined) throw new Error("fixture org has no roles");
    const product = "UNIQUE_PRODUCT_SENTENCE_MUST_NOT_LOAD";
    const good = "UNIQUE_GOOD_SENTENCE_MUST_NOT_LOAD";
    const answers = parseAnswers({ product, good, roles: [roleName] }, allRoles);
    const orgAuthority = await resolveAuthority({ orgHome: fixture.orgHome });
    await emitAppArtifacts(appWorkdir, { appName: "taste-app", answers, allRoles, orgAuthority });

    const raw = await readFile(join(appWorkdir, ".cormidia", "TASTE.md"), "utf8");
    expect(raw.replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("");
    expect(raw).toContain(PLACEHOLDER);
    expect(raw).not.toContain(product);
    expect(raw).not.toContain(good);

    const assembled = await assemble(fixture.orgHome, appWorkdir);
    expect(assembled.systemPrompt).not.toContain("## App .cormidia/TASTE.md");
    expect(assembled.systemPrompt).not.toContain(product);
    expect(assembled.systemPrompt).not.toContain(good);
  });
});

describe("bootstrap answers product/good are optional", () => {
  it("omitted product and good default to empty and are not required", () => {
    const answers = parseAnswers({ roles: ["builder"] }, ["builder"]);
    expect(answers.product).toBe("");
    expect(answers.good).toBe("");
    expect(answers.roles).toEqual(["builder"]);
  });

  it("negative control: a non-string product field still refuses", () => {
    expect(() => parseAnswers({ product: 1, roles: ["builder"] }, ["builder"])).toThrow(/product must be a string/);
  });
});
