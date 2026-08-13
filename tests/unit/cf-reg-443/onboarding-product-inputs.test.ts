/**
 * CF-REG-443 · HB-139 · J-02 onboarding / CORMIDIA-C-OPLIFE
 *
 * The pre-fix emitter accepted and recovered legacy product intent but gave it
 * no consumer. These cases pin the human-visible reconciliation path while
 * proving the same bytes never enter app TASTE or assembled agent context.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAuthority } from "../../../src/org/authority.js";
import { emitAppArtifacts, parseAnswers } from "../../../src/org/bootstrap.js";
import { assembleContext } from "../../../src/org/context.js";
import { loadRoles } from "../../../src/org/roles.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import { makeTempOrgHome } from "../../fixtures/org-home.js";

const PRODUCT = "A planning tool for independent furniture makers.";
const GOOD = "Good means a maker can publish an accurate weekly production plan.";

describe("CF-REG-443 legacy product inputs", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("surfaces recovered intent for product-document reconciliation without contaminating TASTE", async () => {
    const fixture = await makeTempOrgHome({ name: "reg-443-product-inputs" });
    cleanups.push(fixture.cleanup);
    const appWorkdir = join(fixture.root, "app");
    await mkdir(appWorkdir, { recursive: true });
    const roles = await loadRoles(join(fixture.orgHome, "roles.yaml"));
    const allRoles = roles.roles.map((role) => role.name);
    const roleName = allRoles[0];
    if (roleName === undefined) throw new Error("fixture org has no roles");
    const answers = parseAnswers({ product: PRODUCT, good: GOOD, roles: [roleName] }, allRoles);
    const orgAuthority = await resolveAuthority({ orgHome: fixture.orgHome });

    await emitAppArtifacts(appWorkdir, { appName: "taste-app", answers, allRoles, orgAuthority });

    const report = await readFile(join(appWorkdir, ".cormidia", "onboarding-report.md"), "utf8");
    expect(report).toContain("## Legacy Product-Document Inputs");
    expect(report).toContain(PRODUCT);
    expect(report).toContain(GOOD);
    expect(report).toContain("not loaded into agent context");
    expect(report).toContain("never populate `.cormidia/TASTE.md`");

    const taste = await readFile(join(appWorkdir, ".cormidia", "TASTE.md"), "utf8");
    expect(taste).not.toContain(PRODUCT);
    expect(taste).not.toContain(GOOD);

    const role: RoleConfig = {
      name: roleName,
      runtime: "claude",
      model: "unit-model",
      effort: "medium",
      delegation: { allow: [] },
      triggers: [],
      outputs: [],
      maxTurnBudgetUsd: 1,
    };
    const assembled = await assembleContext({
      orgHome: fixture.orgHome,
      appWorkdir,
      app: "taste-app",
      role,
      taskText: "plan the next product increment",
    });
    expect(assembled.systemPrompt).not.toContain(PRODUCT);
    expect(assembled.systemPrompt).not.toContain(GOOD);
  });

  it("does not invent a legacy-input section when the fields were omitted", async () => {
    const fixture = await makeTempOrgHome({ name: "reg-443-empty-inputs" });
    cleanups.push(fixture.cleanup);
    const appWorkdir = join(fixture.root, "app");
    await mkdir(appWorkdir, { recursive: true });
    const roles = await loadRoles(join(fixture.orgHome, "roles.yaml"));
    const allRoles = roles.roles.map((role) => role.name);
    const roleName = allRoles[0];
    if (roleName === undefined) throw new Error("fixture org has no roles");
    const answers = parseAnswers({ roles: [roleName] }, allRoles);
    const orgAuthority = await resolveAuthority({ orgHome: fixture.orgHome });

    await emitAppArtifacts(appWorkdir, { appName: "taste-app", answers, allRoles, orgAuthority });

    const report = await readFile(join(appWorkdir, ".cormidia", "onboarding-report.md"), "utf8");
    expect(report).not.toContain("## Legacy Product-Document Inputs");
  });
});
