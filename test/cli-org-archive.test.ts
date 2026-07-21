// ENH-001: retiring an org used to be hand-moving directories nobody could
// enumerate. `operon org list` makes every org discoverable and
// `operon org archive` retires one under the same rules as `app reset`:
// preview by default, --execute plus an exact --confirm token, and nothing
// removed that was not first archived and verified.
//
// Offline only: temp directories, an explicit pointer path, no network, no
// installed org, no provider.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdOrg } from "../src/cli/org.js";
import { readActiveOrgPointer } from "../src/org/home.js";
import {
  listOrgs,
  orgBacklinkPath,
  planOrgArchive,
  readOrgArchiveManifest,
} from "../src/org/org-archive.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  homeDir: string;
  pointerPath: string;
  orgHome(name: string): string;
  stateHome(name: string): string;
}

async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "operon-org-archive-"));
  roots.push(root);
  const homeDir = join(root, "home");
  mkdirSync(homeDir, { recursive: true });
  return {
    root,
    homeDir,
    pointerPath: join(homeDir, ".operon", "config"),
    orgHome: (name) => join(root, "orgs", name),
    stateHome: (name) => join(homeDir, ".operon", name),
  };
}

async function makeOrg(fx: Fixture, name: string): Promise<void> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runOrg(fx, ["init", fx.orgHome(name), "--name", name]);
  } finally {
    log.mockRestore();
  }
}

describe("operon org list", () => {
  it("enumerates every org with its home, footprint, and activity, marking the active one", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");

    const orgs = await listOrgs({ pointerPath: fx.pointerPath });
    expect(orgs.map((org) => org.name)).toEqual(["alpha", "beta"]);
    const alpha = orgs.find((org) => org.name === "alpha")!;
    const beta = orgs.find((org) => org.name === "beta")!;
    // `beta` was selected last, so it holds the pointer.
    expect(beta.active).toBe(true);
    expect(alpha.active).toBe(false);
    // The backlink keeps a non-active org's home discoverable — the exact
    // thing that was impossible once the pointer moved on.
    expect(alpha.orgHome).toBe(fx.orgHome("alpha"));
    expect(alpha.orphan).toBe(false);
    expect(alpha.appCount).toBe(0);
    expect(alpha.footprintBytes).toBeGreaterThan(0);
    expect(alpha.fileCount).toBeGreaterThan(0);

    const text = await captureOrg(fx, ["list"]);
    expect(text).toContain("* beta");
    expect(text).toContain("  alpha");
    expect(text).toContain(fx.stateHome("alpha"));
  });

  it("reports a state home with no recorded org home as an orphan", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    // Exactly the run-3 condition: `~/.operon/operon` held state with no
    // corresponding org home and no command would surface it.
    const orphanState = fx.stateHome("orphaned");
    mkdirSync(join(orphanState, "runs"), { recursive: true });
    writeFileSync(join(orphanState, "runs", "leftover.json"), "{}\n", "utf8");

    const orgs = await listOrgs({ pointerPath: fx.pointerPath });
    const orphan = orgs.find((org) => org.name === "orphaned")!;
    expect(orphan).toMatchObject({ orphan: true, orgHome: null, appCount: null, active: false });
    expect(orphan.footprintBytes).toBeGreaterThan(0);

    const text = await captureOrg(fx, ["list"]);
    expect(text).toContain("orphan: no org home recorded");
  });
});

describe("operon org archive", () => {
  it("previews without touching anything and names what it will leave intact", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const stateHome = fx.stateHome("alpha");
    const pointerBefore = readFileSync(fx.pointerPath, "utf8");

    const text = await captureOrg(fx, ["archive", "alpha"]);
    expect(text).toContain("Org archive plan: alpha");
    expect(text).toContain(`state home:  ${stateHome}`);
    expect(text).toContain(`org home:    ${fx.orgHome("alpha")}`);
    expect(text).toContain(`left intact: ${fx.orgHome("alpha")}`);
    expect(text).toContain("left intact: GitHub repositories, branches, and open tickets");
    expect(text).toContain("operon org archive alpha --execute --confirm alpha");

    expect(existsSync(stateHome)).toBe(true);
    expect(existsSync(fx.orgHome("alpha"))).toBe(true);
    expect(readFileSync(fx.pointerPath, "utf8")).toBe(pointerBefore);
    expect(existsSync(join(fx.homeDir, ".operon", "archives"))).toBe(false);
  });

  it("requires an exact confirmation token before it will execute", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const stateHome = fx.stateHome("alpha");

    await expect(runOrg(fx, ["archive", "alpha", "--execute"])).rejects.toThrow(
      "org archive: --execute requires --confirm alpha",
    );
    await expect(runOrg(fx, ["archive", "alpha", "--execute", "--confirm", "Alpha"])).rejects.toThrow(
      "org archive: --execute requires --confirm alpha",
    );
    await expect(runOrg(fx, ["archive", "alpha", "--execute", "--confirm", "beta"])).rejects.toThrow(
      "org archive: --execute requires --confirm alpha",
    );
    expect(existsSync(stateHome)).toBe(true);
  });

  it("archives, verifies every byte, then removes only the state home", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const stateHome = fx.stateHome("alpha");
    mkdirSync(join(stateHome, "runs", "app", "run-1"), { recursive: true });
    writeFileSync(join(stateHome, "runs", "app", "run-1", "envelope.json"), '{"run":1}\n', "utf8");

    const text = await captureOrg(fx, ["archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(text).toContain("Org archived: alpha");
    expect(text).toContain("manifest sha256:");

    expect(existsSync(stateHome)).toBe(false);
    // The org home is a human checkout; it is reported, never removed.
    expect(existsSync(join(fx.orgHome("alpha"), "roles.yaml"))).toBe(true);
    // beta was active, so the pointer is untouched.
    expect((await readActiveOrgPointer(fx.pointerPath)).stateHome).toBe(fx.stateHome("beta"));

    const archiveRoot = join(fx.homeDir, ".operon", "archives");
    const archives = readFileSync(join(archiveRoot, "alpha-org-latest.json"), "utf8");
    const latest = JSON.parse(archives) as { archive_path: string; manifest_sha256: string };
    const manifest = await readOrgArchiveManifest(latest.archive_path);
    expect(manifest).toMatchObject({ kind: "org-archive", org: "alpha", state_home: stateHome });
    const files = manifest["files"] as Array<{ path: string }>;
    expect(files.some((file) => file.path === join("state", "runs", "app", "run-1", "envelope.json")))
      .toBe(true);
    // The ratified org configuration is snapshotted for reference.
    expect(files.some((file) => file.path === join("org", "roles.yaml"))).toBe(true);
    expect(
      readFileSync(join(latest.archive_path, "state", "runs", "app", "run-1", "envelope.json"), "utf8"),
    ).toBe('{"run":1}\n');
  });

  it("clears the active pointer when the archived org was the active one", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    expect(existsSync(fx.pointerPath)).toBe(true);

    await captureOrg(fx, ["archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(existsSync(fx.stateHome("alpha"))).toBe(false);
    expect(existsSync(fx.pointerPath)).toBe(false);
  });

  it("refuses while a lock, an undecided approval, or an interrupted transaction exists", async () => {
    // Adversarial near-miss: an org with live or undecided work must not be
    // retired, and the refusal must remove nothing.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const stateHome = fx.stateHome("alpha");
    mkdirSync(join(stateHome, "locks"), { recursive: true });
    writeFileSync(join(stateHome, "locks", "app--builder.lock"), "{}\n", "utf8");
    mkdirSync(join(stateHome, "approvals", "pending"), { recursive: true });
    writeFileSync(join(stateHome, "approvals", "pending", "abc.json"), "{}\n", "utf8");
    mkdirSync(join(stateHome, "lifecycle", "transactions"), { recursive: true });
    writeFileSync(join(stateHome, "lifecycle", "transactions", "reset-app.json"), "{}\n", "utf8");

    const plan = await planOrgArchive({ pointerPath: fx.pointerPath, org: "alpha" });
    expect(plan.blockers.map((blocker) => blocker.code).sort()).toEqual([
      "active_journal",
      "active_lock",
      "pending_approval",
    ]);

    const preview = await captureOrg(fx, ["archive", "alpha"], 2);
    expect(preview).toContain("BLOCKED active_lock");
    expect(preview).toContain("Nothing was archived or removed.");

    await expect(
      runOrg(fx, ["archive", "alpha", "--execute", "--confirm", "alpha"]),
    ).rejects.toThrow(/org archive: execution blocked/);
    expect(existsSync(stateHome)).toBe(true);
    expect(existsSync(join(stateHome, "locks", "app--builder.lock"))).toBe(true);
  });

  it("refuses an unknown org and an archive root inside the state home", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");

    await expect(runOrg(fx, ["archive", "ghost"])).rejects.toThrow(
      /org archive: unknown org "ghost"; operon org list shows: alpha/,
    );
    await expect(
      planOrgArchive({
        pointerPath: fx.pointerPath,
        org: "alpha",
        archiveRoot: join(fx.stateHome("alpha"), "archives"),
      }),
    ).rejects.toThrow("org archive: --archive-root must be outside the archived state home");
    expect(existsSync(fx.stateHome("alpha"))).toBe(true);
  });

  it("can retire an orphan state home that has no org home at all", async () => {
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    const orphanState = fx.stateHome("orphaned");
    mkdirSync(join(orphanState, "runs"), { recursive: true });
    writeFileSync(join(orphanState, "runs", "leftover.json"), '{"kept":true}\n', "utf8");
    expect(existsSync(orgBacklinkPath(orphanState))).toBe(false);

    await captureOrg(fx, ["archive", "orphaned", "--execute", "--confirm", "orphaned"]);
    expect(existsSync(orphanState)).toBe(false);
    // The active org is untouched.
    expect(existsSync(fx.stateHome("alpha"))).toBe(true);
    expect(existsSync(fx.pointerPath)).toBe(true);

    const latest = JSON.parse(
      readFileSync(join(fx.homeDir, ".operon", "archives", "orphaned-org-latest.json"), "utf8"),
    ) as { archive_path: string };
    expect(
      readFileSync(join(latest.archive_path, "state", "runs", "leftover.json"), "utf8"),
    ).toBe('{"kept":true}\n');
  });
});

async function runOrg(fx: Fixture, args: string[], expected = 0): Promise<void> {
  expect(await cmdOrg(args, { homeDir: fx.homeDir, pointerPath: fx.pointerPath })).toBe(expected);
}

async function captureOrg(fx: Fixture, args: string[], expected = 0): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runOrg(fx, args, expected);
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}
