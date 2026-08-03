// CF-B10-* (L2) — org-home corruption sweep through the REAL resolver (HB-014).
//
// Contract: validation-design/contracts/B-10-config-resolver.md §1/§3 and
// boundary-map.md B-10 failure modes: invalid YAML, package/org schema skew,
// missing AUTHORITY.md (fail closed to legacy-conservative — INV-015
// direction, never the newer default), mid-edit torn read. The fixture stages
// each state (fixtures/org-home.ts corruption knobs); the detector asserted
// here is always product code: resolveCormidiaHomes / validateOrgHome /
// resolveAuthority / assembleContext.
//
// Layer: 2 (temp org homes, real product resolution). Zero network, zero
// tokens.

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DELEGATED_OPERATOR_VERSION,
  LEGACY_CONSERVATIVE_VERSION,
  resolveAuthority,
} from "../../../src/org/authority.js";
import { assembleContext } from "../../../src/org/context.js";
import { resolveCormidiaHomes } from "../../../src/org/home.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import {
  makeTempOrgHome,
  type OrgYamlSurface,
  type TempOrgHome,
} from "../../fixtures/org-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function orgHomeFixture(): Promise<TempOrgHome> {
  const fixture = await makeTempOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

const testRole: RoleConfig = {
  name: "builder",
  runtime: "claude",
  model: "unit-model",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 1,
};

describe("CF-B10-* (L2) corruption sweep — the resolver refuses every staged state", () => {
  it("control: the pristine fixture resolves and its ratified surfaces are provably present", async () => {
    const t = await orgHomeFixture();
    await assertNonEmptyWalk(t.orgHome);
    const homes = await resolveCormidiaHomes(t.resolveOptions);
    expect(homes.orgHome).toBe(t.orgHome);
    expect(homes.stateHome).toBe(t.stateHome);
    expect(homes.appsFile.org.name).toBe(t.orgName);
  });

  it("negative control: invalid YAML on EVERY ratified surface makes the resolver FIRE", async () => {
    // Fixed-surface sweep with an explicit completeness check — a silently
    // shrunken surface list must fail here, never pass by absence.
    const surfaces: OrgYamlSurface[] = ["apps.yaml", "roles.yaml", "pipelines.yaml"];
    const refused: OrgYamlSurface[] = [];
    for (const surface of surfaces) {
      const t = await orgHomeFixture();
      await t.corrupt.invalidYaml(surface);
      await resolveCormidiaHomes(t.resolveOptions).then(
        () => undefined,
        () => refused.push(surface),
      );
    }
    expect(refused).toEqual(surfaces);
  });

  it("package/org schema skew is a typed, directional refusal naming the unknown field", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.schemaSkew();
    await expect(resolveCormidiaHomes(t.resolveOptions)).rejects.toThrow(
      /unknown field.*from_a_newer_package_schema/,
    );
  });

  it("a mid-edit torn read is refused and the stray editor temp is never adopted as recovery", async () => {
    const t = await orgHomeFixture();
    const { strayTemp } = await t.corrupt.tornMidEdit("apps.yaml");
    // A complete pre-edit copy sits right beside the target; the resolver
    // must refuse the torn bytes rather than silently recover from siblings.
    expect(existsSync(strayTemp)).toBe(true);
    await expect(resolveCormidiaHomes(t.resolveOptions)).rejects.toThrow();
    expect(existsSync(strayTemp)).toBe(true);
  });

  it("a removed ratified surface stops resolution with the org-home identity named", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.removeRequired("TASTE.md");
    await expect(resolveCormidiaHomes(t.resolveOptions)).rejects.toThrow(/not a complete org home/);

    const missingPrompts = await orgHomeFixture();
    await missingPrompts.corrupt.removeRequired("prompts");
    await expect(resolveCormidiaHomes(missingPrompts.resolveOptions)).rejects.toThrow(
      /missing prompts/,
    );
  });
});

describe("CF-B10-* (L2) missing AUTHORITY.md fails closed to legacy-conservative (INV-015 direction)", () => {
  it("the error branch yields strictly LESS capability than the success branch — never the newer default", async () => {
    const t = await orgHomeFixture();
    // Success branch first: a fresh org's ratified default is the (newer,
    // broader) delegated-operator charter.
    const before = await resolveAuthority({ orgHome: t.orgHome });
    expect(before.profile).toBe("delegated-operator");
    expect(before.version).toBe(DELEGATED_OPERATOR_VERSION);

    await t.corrupt.missingAuthority();
    // The org home itself stays resolvable…
    const homes = await resolveCormidiaHomes(t.resolveOptions);
    expect(homes.orgHome).toBe(t.orgHome);
    // …but authority fails closed to the built-in legacy-conservative
    // profile: never delegated-operator "because it was convenient".
    const after = await resolveAuthority({ orgHome: t.orgHome });
    expect(after.profile).toBe("conservative");
    expect(after.version).toBe(LEGACY_CONSERVATIVE_VERSION);
    expect(after.version).not.toBe(DELEGATED_OPERATOR_VERSION);
    expect(after.sources).toEqual([`builtin:${LEGACY_CONSERVATIVE_VERSION}`]);
    expect(after.text).toContain("Cormidia fails closed");
    expect(after.text).not.toContain("You are my delegated operator");
  });

  it("context assembly threads the fail-closed authority into the turn bundle end-to-end", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.missingAuthority();
    const appWorkdir = join(t.root, "app");
    await mkdir(appWorkdir, { recursive: true });
    const assembled = await assembleContext({
      orgHome: t.orgHome,
      appWorkdir,
      app: "sweep-app",
      role: testRole,
      taskText: "routine build task",
    });
    expect(assembled.bundle.authority?.profile).toBe("conservative");
    expect(assembled.bundle.authority?.version).toBe(LEGACY_CONSERVATIVE_VERSION);
    const authorityComponents = (assembled.bundle.components ?? []).filter(
      (component) => component.category === "authority",
    );
    expect(authorityComponents).toHaveLength(1);
    expect(authorityComponents[0]?.requirement).toBe("required");
  });
});
