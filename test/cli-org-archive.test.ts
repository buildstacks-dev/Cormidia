// ENH-001: retiring an org used to be hand-moving directories nobody could
// enumerate. `operon org list` makes every org discoverable and
// `operon org archive` retires one under the same rules as `app reset`:
// preview by default, --execute plus an exact --confirm token, and nothing
// removed that was not first archived and verified.
//
// Offline only: temp directories, an explicit pointer path, no network, no
// installed org, no provider.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdOrg } from "../src/cli/org.js";
import { readActiveOrgPointer } from "../src/org/home.js";
import {
  listOrgs,
  orgBacklinkPath,
  orgRetirementLedgerHome,
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
    expect(alpha.usageMeasured).toBe(true);

    // Identity-only enumeration skips the tree walk entirely, so doctor never
    // pays O(every file in every state home) to answer an orphan question.
    const cheap = await listOrgs({ pointerPath: fx.pointerPath, includeUsage: false });
    expect(cheap.map((org) => org.name)).toEqual(["alpha", "beta"]);
    expect(cheap.every((org) => org.usageMeasured === false)).toBe(true);
    expect(cheap.every((org) => org.footprintBytes === 0 && org.lastActivityAt === null)).toBe(true);
    expect(cheap.find((org) => org.name === "alpha")?.orgHome).toBe(fx.orgHome("alpha"));

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

// ---------------------------------------------------------------------------
// The real top-level CLI
//
// Every test above calls cmdOrg() directly, and src/cli/invocation-audit.ts
// documents that outside the top-level CLI scope both the audit binding and
// the terminal-row write are no-ops. That is precisely where `org archive`
// broke: the audit binds the ACTIVE org's state home before dispatch, so a
// unit-level call can never see the cross-org refusal or the terminal row
// being written back into the tree the command just removed. These drive
// src/cli.ts in a subprocess so the audit interaction is actually exercised.
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runCli(fx: Fixture, args: string[]): Promise<CliResult> {
  const neutralCwd = join(fx.root, "neutral");
  mkdirSync(neutralCwd, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.homeDir };
  // The active pointer under HOME is the only org selection these exercise.
  delete env["OPERON_ORG_HOME"];
  delete env["OPERON_STATE_HOME"];
  delete env["OPERON_HOME"];
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, ...args],
      { cwd: neutralCwd, env },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
  }
}

function invocationRows(stateHome: string): Array<Record<string, unknown>> {
  const ledger = join(stateHome, "invocations", `${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("operon org archive through the real CLI entrypoint", () => {
  it("retires a NON-ACTIVE org, in preview and on execute", async () => {
    // ENH-001's whole use case: retiring accumulated orgs that are, by
    // definition, not the active one. The command-level audit has already
    // bound the ACTIVE org's state home by the time `org archive` runs, so
    // re-binding the target's refused the command outright.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const alphaState = fx.stateHome("alpha");
    const betaState = fx.stateHome("beta");

    const preview = await runCli(fx, ["org", "archive", "alpha"]);
    expect(preview.stderr).not.toContain("invocation audit state home changed");
    expect(preview.code).toBe(0);
    expect(preview.stdout).toContain("Org archive plan: alpha");
    expect(existsSync(alphaState)).toBe(true);

    const executed = await runCli(fx, ["org", "archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(executed.stderr).not.toContain("invocation audit state home changed");
    expect(executed.code).toBe(0);
    expect(executed.stdout).toContain("Org archived: alpha");
    expect(existsSync(alphaState)).toBe(false);

    // beta stays active and untouched, and the retirement is journaled in the
    // ledger that survives it rather than in the tree that was removed.
    expect((await readActiveOrgPointer(fx.pointerPath)).stateHome).toBe(betaState);
    const rows = invocationRows(betaState).filter((row) => row["subcommand"] === "archive");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const terminal = rows.filter((row) => row["finishedAt"] !== undefined);
    expect(terminal.map((row) => row["outcome"])).toContain("org-archived");
    expect(terminal.every((row) => row["exitCode"] === 0)).toBe(true);
    expect((terminal.at(-1)?.["provenance"] as Record<string, string>).archivedOrg).toBe("alpha");
  }, 60_000);

  it("does not resurrect the state home when the ACTIVE org is archived", async () => {
    // The terminal audit row used to be written back into the just-removed
    // path, recreating <state>/invocations and <state>/state/invocation-journal
    // so `org list` re-reported the archived org as an orphan and `doctor`
    // WARNed to archive it again.
    const fx = await fixture();
    await makeOrg(fx, "beta");
    await makeOrg(fx, "alpha");
    const alphaState = fx.stateHome("alpha");
    expect((await readActiveOrgPointer(fx.pointerPath)).stateHome).toBe(alphaState);

    const executed = await runCli(fx, ["org", "archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(executed.code).toBe(0);
    expect(existsSync(alphaState)).toBe(false);
    expect(existsSync(join(alphaState, "invocations"))).toBe(false);
    expect(existsSync(join(alphaState, "state", "invocation-journal"))).toBe(false);
    expect(existsSync(fx.pointerPath)).toBe(false);

    // The org stays retired on every later read-only surface.
    await captureOrg(fx, ["use", fx.orgHome("beta")]);
    const listed = await runCli(fx, ["org", "list"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).not.toContain("alpha");
    expect(listed.stdout).toContain("beta");

    const doctor = await runCli(fx, ["doctor", "--config-only", "--json"]);
    expect(doctor.stdout).not.toContain("orgs/alpha");
  }, 60_000);

  it("makes doctor's own orphan remediation work end to end", async () => {
    // doctor tells the operator to `operon org archive <name>` for an orphan,
    // and an orphan is by definition never the active org — so the printed
    // remediation was guaranteed to hit the cross-org refusal.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    const orphanState = fx.stateHome("orphaned");
    mkdirSync(join(orphanState, "runs"), { recursive: true });
    writeFileSync(join(orphanState, "runs", "leftover.json"), '{"kept":true}\n', "utf8");

    const beforeJson = await runCli(fx, ["doctor", "--config-only", "--json"]);
    const orphanRow = (JSON.parse(beforeJson.stdout) as {
      orgs: Array<{ name: string; orphan: boolean }>;
    }).orgs.find((org) => org.name === "orphaned");
    expect(orphanRow?.orphan).toBe(true);

    const before = await runCli(fx, ["doctor", "--config-only"]);
    expect(before.stdout).toContain("orgs/orphaned");
    const remediation = /retire it with "operon ([^"]+)"/.exec(before.stdout);
    expect(remediation?.[1]).toBe("org archive orphaned");

    // Run exactly the command doctor printed.
    const printed = await runCli(fx, remediation![1]!.split(" "));
    expect(printed.stderr).not.toContain("invocation audit state home changed");
    expect(printed.code).toBe(0);
    expect(printed.stdout).toContain("Org archive plan: orphaned");

    const retired = await runCli(fx, [
      ...remediation![1]!.split(" "), "--execute", "--confirm", "orphaned",
    ]);
    expect(retired.code).toBe(0);
    expect(existsSync(orphanState)).toBe(false);

    const after = await runCli(fx, ["doctor", "--config-only"]);
    expect(after.stdout).not.toContain("orgs/orphaned");
    expect(existsSync(fx.stateHome("alpha"))).toBe(true);
  }, 60_000);

  it("keeps the org archived when `org use` selected it without --state-home", async () => {
    // Round-3 defect 3. `org use <path>` wrote an active pointer carrying only
    // org_home, so every consumer that read `pointer.state_home` disagreed
    // with the state home the CLI was actually using: `org list` never marked
    // the org active, `planOrgArchive` set clearsActivePointer false, the
    // pointer survived the retirement, and the next command re-derived the
    // removed path and re-created it. This is the mechanism under "the
    // archived org comes back", so it is asserted at the pointer AND at the
    // post-condition.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    await makeOrg(fx, "beta");
    const alphaState = fx.stateHome("alpha");

    const selected = await runCli(fx, ["org", "use", fx.orgHome("alpha")]);
    expect(selected.code).toBe(0);
    expect(readFileSync(fx.pointerPath, "utf8")).toContain(`state_home: ${alphaState}`);
    expect(await readActiveOrgPointer(fx.pointerPath)).toEqual({
      orgHome: fx.orgHome("alpha"),
      stateHome: alphaState,
    });

    const listed = await runCli(fx, ["org", "list"]);
    expect(listed.stdout).toContain("* alpha");

    const executed = await runCli(fx, ["org", "archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(executed.code).toBe(0);
    expect(existsSync(alphaState)).toBe(false);
    expect(existsSync(fx.pointerPath)).toBe(false);

    // The post-condition is absolute: it does not come back on any later
    // command, including the two that re-report orphans.
    for (const args of [["doctor", "--config-only"], ["org", "list"], ["org", "list", "--json"]]) {
      await runCli(fx, args);
      expect(existsSync(alphaState)).toBe(false);
    }
    const afterList = await runCli(fx, ["org", "list"]);
    expect(afterList.stdout).not.toContain("alpha");
    expect(existsSync(fx.stateHome("beta"))).toBe(true);
  }, 60_000);

  it("writes the terminal audit row of a self-destroying archive to the retirement ledger", async () => {
    // Round-3 defect 1. Every command is audited, so the fix for "the terminal
    // row re-creates the tree the command just removed" is not to skip the
    // row: it moves to a ledger that outlives the org. The retirement ledger
    // is under the archive root, which planOrgArchive already guarantees is
    // outside the archived state home.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    const alphaState = fx.stateHome("alpha");
    const ledger = orgRetirementLedgerHome(join(fx.homeDir, ".operon", "archives"));

    const executed = await runCli(fx, ["org", "archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(executed.code).toBe(0);
    expect(existsSync(alphaState)).toBe(false);

    const rows = invocationRows(ledger).filter((row) => row["finishedAt"] !== undefined);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ command: "org", subcommand: "archive", outcome: "org-archived", exitCode: 0 });
    const provenance = rows[0]!["provenance"] as Record<string, string>;
    expect(provenance["archivedOrg"]).toBe("alpha");
    expect(provenance["auditLedger"]).toBe(ledger);
    expect(provenance["auditLedgerReason"]).toContain("removed the state home it was journaling to");
    // The row landed outside the retired tree, not inside a re-created one.
    expect(existsSync(alphaState)).toBe(false);
  }, 60_000);

  it("archives the same org twice from the same paths without an ENOTEMPTY", async () => {
    // Round-3 defect 4. archiveId is a deterministic sha256 over
    // {name, stateHome, orgHome} and the staged directory was renamed onto it
    // with no collision handling, so the second retirement of a recreated
    // state home died with a raw Node errno and archived nothing.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    const ghost = fx.stateHome("ghost");
    const archiveRoot = join(fx.homeDir, ".operon", "archives");

    mkdirSync(join(ghost, "runs"), { recursive: true });
    writeFileSync(join(ghost, "runs", "x.json"), '{"pass":1}\n', "utf8");
    const first = await runCli(fx, ["org", "archive", "ghost", "--execute", "--confirm", "ghost"]);
    expect(first.code).toBe(0);

    mkdirSync(join(ghost, "runs"), { recursive: true });
    writeFileSync(join(ghost, "runs", "x.json"), '{"pass":2}\n', "utf8");
    const second = await runCli(fx, ["org", "archive", "ghost", "--execute", "--confirm", "ghost"]);
    expect(second.stderr).not.toContain("ENOTEMPTY");
    expect(second.code).toBe(0);
    expect(existsSync(ghost)).toBe(false);

    // Two archives, and the first one's bytes are still the first one's.
    const archives = readdirSync(archiveRoot)
      .filter((entry) => entry.startsWith("ghost-org-archive-"))
      .sort();
    expect(archives.length).toBe(2);
    expect(archives[1]).toBe(`${archives[0]}-2`);
    expect(readFileSync(join(archiveRoot, archives[0]!, "state", "runs", "x.json"), "utf8"))
      .toBe('{"pass":1}\n');
    expect(readFileSync(join(archiveRoot, archives[1]!, "state", "runs", "x.json"), "utf8"))
      .toBe('{"pass":2}\n');

    // And a third attempt with nothing left to archive is an actionable
    // message that names the archive, not a bare "unknown org".
    const third = await runCli(fx, ["org", "archive", "ghost", "--execute", "--confirm", "ghost"]);
    expect(third.code).not.toBe(0);
    expect(third.stderr).toContain("was already archived");
    expect(third.stderr).toContain(join(archiveRoot, "ghost-org-latest.json"));
  }, 60_000);

  it("still names orphan state homes, and retires one, when no active org resolves", async () => {
    // Round-3 defect 2. Retiring the active org is exactly when no active org
    // resolves — and doctor stopped enumerating orgs entirely in that state,
    // so the operator lost the only surface that names what is left on the
    // machine. The remediation doctor prints must also run verbatim there,
    // and a preview must not seed audit state inside the org it previews.
    const fx = await fixture();
    await makeOrg(fx, "alpha");
    const orphanState = fx.stateHome("orphaned");
    mkdirSync(join(orphanState, "runs"), { recursive: true });
    writeFileSync(join(orphanState, "runs", "leftover.json"), '{"kept":true}\n', "utf8");

    await runCli(fx, ["org", "archive", "alpha", "--execute", "--confirm", "alpha"]);
    expect(existsSync(fx.pointerPath)).toBe(false);

    const doctor = await runCli(fx, ["doctor", "--config-only"]);
    expect(doctor.stdout).toContain("active org      FAIL");
    expect(doctor.stdout).toContain("orgs/orphaned");
    const remediation = /retire it with "operon ([^"]+)"/.exec(doctor.stdout);
    expect(remediation?.[1]).toBe("org archive orphaned");

    const preview = await runCli(fx, remediation![1]!.split(" "));
    expect(preview.code).toBe(0);
    expect(preview.stdout).toContain("Org archive plan: orphaned");
    // The preview journals into the retirement ledger, never into the org it
    // is only describing.
    expect(existsSync(join(orphanState, "invocations"))).toBe(false);
    expect(existsSync(join(orphanState, "state", "invocation-journal"))).toBe(false);
    expect(
      invocationRows(orgRetirementLedgerHome(join(fx.homeDir, ".operon", "archives"))).length,
    ).toBeGreaterThan(0);

    const retired = await runCli(fx, [
      ...remediation![1]!.split(" "), "--execute", "--confirm", "orphaned",
    ]);
    expect(retired.code).toBe(0);
    expect(existsSync(orphanState)).toBe(false);
    const after = await runCli(fx, ["doctor", "--config-only"]);
    expect(after.stdout).not.toContain("orgs/orphaned");
  }, 60_000);
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
