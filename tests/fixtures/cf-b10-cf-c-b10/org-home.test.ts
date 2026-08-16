// CF-B10 · CF-C-B10 · HB-014; fixtures/org-home self-test — the temp org home is accepted by the
// REAL product resolver (built by the product's own init transaction, so it
// cannot drift), and every corruption knob stages a state a product loader
// detectably refuses (B-10 failure modes; B-10a identity inputs).

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApps } from "../../../src/org/apps.js";
import { resolveAuthority } from "../../../src/org/authority.js";
import {
  ORG_REQUIRED_FILES,
  readActiveOrgPointer,
  resolveCormidiaHomes,
  validateOrgHome,
} from "../../../src/org/home.js";
import { makeTempOrgHome, type TempOrgHome } from "../org-home.js";
import { assertNonEmptyWalk } from "../walk.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function orgHomeFixture(): Promise<TempOrgHome> {
  const fixture = await makeTempOrgHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

describe("HB-002 fixtures/org-home (product resolver accepts the fixture)", () => {
  it("resolves through the real active-org pointer to the fixture homes", async () => {
    const t = await orgHomeFixture();
    const homes = await resolveCormidiaHomes(t.resolveOptions);
    expect(homes.orgHome).toBe(t.orgHome);
    expect(homes.stateHome).toBe(t.stateHome);
    expect(homes.appsFile.org.name).toBe(t.orgName);
    expect(homes.pointerPath).toBe(t.pointerPath);
  });

  it("writes a complete, validating org home with every ratified surface", async () => {
    const t = await orgHomeFixture();
    await expect(validateOrgHome(t.orgHome)).resolves.toBeUndefined();
    for (const rel of [...ORG_REQUIRED_FILES, "AUTHORITY.md"]) {
      expect(existsSync(join(t.orgHome, rel)), rel).toBe(true);
    }
    // Fixture rule: the fixture's own sweep surface is provably non-empty.
    await assertNonEmptyWalk(t.orgHome);
    await assertNonEmptyWalk(join(t.orgHome, "prompts"));
  });

  it("resolves via CORMIDIA_ORG_HOME/CORMIDIA_STATE_HOME overrides (B-10a env identity)", async () => {
    const t = await orgHomeFixture();
    const strangerHome = await mkdtemp(join(tmpdir(), "hb002-stranger-home-"));
    cleanups.push(() => rm(strangerHome, { recursive: true, force: true }));
    // No pointer under this homeDir: only the env overrides can name the org.
    const homes = await resolveCormidiaHomes({
      env: t.env,
      homeDir: strangerHome,
      pointerPath: join(strangerHome, ".cormidia", "config"),
    });
    expect(homes.orgHome).toBe(t.orgHome);
    expect(homes.stateHome).toBe(t.stateHome);
  });

  it("records both identity fields in the real pointer file", async () => {
    const t = await orgHomeFixture();
    const pointer = await readActiveOrgPointer(t.pointerPath);
    expect(pointer.orgHome).toBe(t.orgHome);
    expect(pointer.stateHome).toBe(t.stateHome);
  });

  it("missing AUTHORITY.md: org still resolves and authority fails closed to conservative (INV-015)", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.missingAuthority();
    expect(existsSync(join(t.orgHome, "AUTHORITY.md"))).toBe(false);
    // The org home remains structurally valid…
    await expect(validateOrgHome(t.orgHome)).resolves.toBeUndefined();
    // …and the product's authority resolution refuses to invent a grant.
    const authority = await resolveAuthority({ orgHome: t.orgHome });
    expect(authority.profile).toBe("conservative");
  });
});

describe("HB-002 fixtures/org-home negative controls (each knob stages a detectable violation)", () => {
  it("negative control: invalid YAML makes validateOrgHome FIRE", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.invalidYaml("apps.yaml");
    await expect(validateOrgHome(t.orgHome)).rejects.toThrow();
  });

  it("negative control: a removed ratified surface makes validateOrgHome FIRE", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.removeRequired("roles.yaml");
    await expect(validateOrgHome(t.orgHome)).rejects.toThrow(/not a complete org home/);
  });

  it("negative control: a removed prompts/ tree makes validateOrgHome FIRE", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.removeRequired("prompts");
    await expect(validateOrgHome(t.orgHome)).rejects.toThrow(/missing prompts/);
  });

  it("negative control: package/org schema skew makes the apps loader FIRE, not ignore", async () => {
    const t = await orgHomeFixture();
    await t.corrupt.schemaSkew();
    await expect(loadApps(join(t.orgHome, "apps.yaml"))).rejects.toThrow(/unknown field/);
  });

  it("negative control: a torn mid-edit write makes the apps loader FIRE and leaves the stray temp", async () => {
    const t = await orgHomeFixture();
    const { target, strayTemp } = await t.corrupt.tornMidEdit("apps.yaml");
    expect(existsSync(strayTemp)).toBe(true);
    await expect(loadApps(target)).rejects.toThrow();
  });
});
