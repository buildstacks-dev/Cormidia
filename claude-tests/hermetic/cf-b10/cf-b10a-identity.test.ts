// CF-B10-* (L2) — B-10a active-org identity sweep (HB-014).
//
// Contract: validation-design/contracts/B-10-config-resolver.md §2 — the
// (org home, state home, org id) triple resolves with explicit overrides >
// active pointer, no command infers an org home from cwd, and "correct
// config from the wrong org" is an identity failure that stops, never a
// resolution that proceeds. boundary-map.md B-10a failure modes: stale
// pointer, override disagreement, symlinked org home, pointer to a
// deleted/moved org, state home from a different org.
//
// Two ratified clauses are currently NOT enforced by the product; each
// carries an `it.fails` tripwire below (green while the defect exists, red
// the moment the product starts enforcing the clause — then promote the test
// by dropping `.fails`).
//
// Layer: 2 (temp org homes + the real pointer file). Zero network, zero
// tokens; the operator's real ~/.operon is never touched (fixture homeDir).

import { mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NoActiveOrgError,
  resolveOperonHomes,
  writeActiveOrgPointer,
} from "../../../src/org/home.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function orgHomeFixture(name: string): Promise<TempOrgHome> {
  const fixture = await makeTempOrgHome({ name });
  cleanups.push(fixture.cleanup);
  return fixture;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("CF-B10-* B-10a (L2) identity resolution — coherent triple or stop", () => {
  it("control: the active pointer resolves the fixture's coherent (org, state, name) triple", async () => {
    const a = await orgHomeFixture("org-a");
    const homes = await resolveOperonHomes(a.resolveOptions);
    expect(homes.orgHome).toBe(a.orgHome);
    expect(homes.stateHome).toBe(a.stateHome);
    expect(homes.appsFile.org.name).toBe("org-a");
  });

  it("precedence is explicit override > env > pointer (contract §2), never a blend", async () => {
    const a = await orgHomeFixture("org-a");
    const b = await orgHomeFixture("org-b");
    // env beats the pointer…
    const viaEnv = await resolveOperonHomes({
      env: { OPERON_ORG_HOME: b.orgHome },
      homeDir: a.homeDir,
      pointerPath: a.pointerPath,
    });
    expect(viaEnv.orgHome).toBe(b.orgHome);
    // …and the explicit option beats env.
    const viaOption = await resolveOperonHomes({
      orgHome: a.orgHome,
      env: { OPERON_ORG_HOME: b.orgHome },
      homeDir: a.homeDir,
      pointerPath: a.pointerPath,
    });
    expect(viaOption.orgHome).toBe(a.orgHome);
  });

  it("no command infers an org home from cwd: standing inside a valid org still stops typed", async () => {
    const a = await orgHomeFixture("org-a");
    const emptyHome = await tempDir("b10a-empty-home-");
    const previousCwd = process.cwd();
    try {
      process.chdir(a.orgHome); // a fully valid org home as cwd
      const attempt = resolveOperonHomes({
        env: {},
        homeDir: emptyHome,
        pointerPath: join(emptyHome, ".operon", "config"),
      });
      await expect(attempt).rejects.toThrow(NoActiveOrgError);
      await expect(attempt).rejects.toMatchObject({ code: "no_active_org" });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("negative control: a stale pointer (org moved away) makes the resolver FIRE — even with another valid org in reach", async () => {
    const a = await orgHomeFixture("org-a");
    const b = await orgHomeFixture("org-b");
    await rename(a.orgHome, join(a.root, "org-moved-away"));
    // OPERON_HOME names a perfectly valid different org. Resolution must
    // still stop on the stale pointer identity — silently proceeding with
    // org B here would be exactly "correct config from the wrong org".
    await expect(
      resolveOperonHomes({
        env: { OPERON_HOME: b.orgHome },
        homeDir: a.homeDir,
        pointerPath: a.pointerPath,
      }),
    ).rejects.toThrow(/not a complete org home/);
  });

  it("a pointer to a deleted org stops with the identity named, not a fallback", async () => {
    const a = await orgHomeFixture("org-a");
    await rm(a.orgHome, { recursive: true, force: true });
    await expect(resolveOperonHomes(a.resolveOptions)).rejects.toThrow(/not a complete org home/);
  });

  it("override disagreement: resolving org B never adopts org A's pointer-recorded state home", async () => {
    const a = await orgHomeFixture("org-a");
    const b = await orgHomeFixture("org-b");
    await assertNonEmptyWalk(b.orgHome);
    // Pointer (under A's homeDir) names org A + state A; env selects org B.
    const homes = await resolveOperonHomes({
      env: { OPERON_ORG_HOME: b.orgHome },
      homeDir: a.homeDir,
      pointerPath: a.pointerPath,
    });
    expect(homes.orgHome).toBe(b.orgHome);
    expect(homes.stateHome).not.toBe(a.stateHome);
    // The pairing rule: a state home recorded for a DIFFERENT org home is
    // ignored and org B derives its own (~/.operon/<org-name>).
    expect(homes.stateHome).toBe(join(a.homeDir, ".operon", "org-b"));
  });

  // PRODUCT DEFECT TRIPWIRE (ratified clause not enforced).
  // contracts/B-10-config-resolver.md §2: "a pairing mismatch (… symlinked
  // org home) is a typed stop". Today resolveOperonHomes (src/org/home.ts)
  // follows the symlink and resolves: the same org becomes addressable under
  // two identities while the pointer records the alias. This test asserts the
  // RATIFIED behavior and is marked `.fails`: it stays green while the defect
  // exists and turns red when the resolver starts refusing — drop `.fails`
  // then. Do NOT "fix" this by weakening the clause.
  it.fails("TRIPWIRE (defect): a symlinked org home must be a typed identity stop", async () => {
    const a = await orgHomeFixture("org-a");
    const linkRoot = await tempDir("b10a-link-");
    const linkPath = join(linkRoot, "org-alias");
    await symlink(a.orgHome, linkPath);
    await writeActiveOrgPointer(a.pointerPath, linkPath, a.stateHome);
    await expect(resolveOperonHomes(a.resolveOptions)).rejects.toThrow();
  });

  // PRODUCT DEFECT TRIPWIRE (ratified clause not enforced).
  // contracts/B-10-config-resolver.md §2: "a pairing mismatch (state home
  // from another org; …) is a typed stop — 'correct config from the wrong
  // org' is an identity failure". Today an explicit OPERON_STATE_HOME naming
  // ANOTHER org's state home resolves quietly (src/org/home.ts computes the
  // state home with no coherence validation against the resolved org
  // identity; nothing in the state home records which org it belongs to).
  // Green while the defect exists; red once the resolver validates the pair —
  // drop `.fails` then.
  it.fails("TRIPWIRE (defect): a state home from a different org must be a typed identity stop", async () => {
    const a = await orgHomeFixture("org-a");
    const b = await orgHomeFixture("org-b");
    await expect(
      resolveOperonHomes({
        env: { OPERON_ORG_HOME: b.orgHome, OPERON_STATE_HOME: a.stateHome },
        homeDir: b.homeDir,
        pointerPath: b.pointerPath,
      }),
    ).rejects.toThrow();
  });
});
