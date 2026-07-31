// CF-J01-A — packed vs source-backed launcher parity + removed-cwd guard
// (L2, STD; C-OP-LIFE §1, B-15; case-catalog row CF-J01-A).
//
// HONEST REDUCTION: full packed-launcher OP parity would execute
// `src/operon.cjs`, which imports `dist/cli.js` — a build artifact whose
// freshness this hermetic lane cannot guarantee (a stale dist would flake the
// lane red or, worse, green-prove old code), and building tsc in-lane is not
// hermetic either. What IS in hermetic reach and is asserted here:
//   1. the removed-cwd guard fires identically (same bytes, same exit code)
//      through BOTH launcher entries — the guard is the pre-ESM contract the
//      two launchers share;
//   2. the same `org init --dry-run --json` op through the source-backed
//      launcher subprocess is byte-equivalent to the in-process module truth
//      (planOrgInit) — CLI wiring, flag parsing, and HOME-derived pointer
//      resolution agree with the module layer.
// The packed dist-execution cell is live-lane material; reduced here, not
// silently skipped.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planOrgInit } from "../../../src/org/home.js";
import { stableJson } from "../../../src/org/lifecycle.js";
import { REPO_ROOT } from "./support.js";

const execFileAsync = promisify(execFile);

const PACKED_LAUNCHER = join(REPO_ROOT, "src", "operon.cjs");
const SOURCE_LAUNCHER = join(REPO_ROOT, "src", "operon-local.cjs");

/** Run `node <launcher> <args>` from a working directory that is removed
 *  before exec — the removed-cwd seeded violation. */
async function runFromRemovedCwd(
  launcher: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const doomed = await mkdtemp(join(tmpdir(), "operon-cf-j01a-cwd-"));
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-c", 'cd "$1" && rmdir "$1" && exec node "$2" org show', "cf-j01a", doomed, launcher],
      { encoding: "utf8" },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  } finally {
    await rm(doomed, { recursive: true, force: true }).catch(() => undefined);
  }
}

describe("CF-J01-A — launcher parity and the removed-cwd guard (C-OP-LIFE §1)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  it("negative control: a removed working directory — the guard FIRES identically through both launchers", async () => {
    const packed = await runFromRemovedCwd(PACKED_LAUNCHER);
    const source = await runFromRemovedCwd(SOURCE_LAUNCHER);

    for (const [label, run] of [
      ["packed", packed],
      ["source-backed", source],
    ] as const) {
      expect(run.code, `${label} launcher exit code`).toBe(1);
      expect(run.stderr, `${label} launcher guard message`).toContain(
        "operon: cannot resolve the current working directory",
      );
      expect(run.stderr).toContain("cd to an existing directory and retry");
      // The guard refuses BEFORE any CLI work: no other output at all.
      expect(run.stdout).toBe("");
    }
    // Parity: byte-identical guard behavior across the two entries.
    expect(packed.stderr).toBe(source.stderr);
    expect(packed.code).toBe(source.code);
  });

  it("source-backed launcher: `org init --dry-run --json` agrees byte-for-byte with the in-process plan preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "operon-cf-j01a-parity-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });
    const target = join(root, "org");
    const stateHome = join(root, "state");

    // Subprocess env: HOME pinned to the temp world so the launcher's
    // homedir()-derived pointer path can never touch the operator's real
    // ~/.operon; ambient OPERON_* selection is stripped for the same reason.
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir };
    delete env["OPERON_ORG_HOME"];
    delete env["OPERON_STATE_HOME"];
    delete env["OPERON_HOME"];

    // Module truth FIRST: the CLI's sole preview write is its invocation
    // audit row, which creates the planned state home — planning in-process
    // before the subprocess keeps both previews computed against the same
    // pristine world.
    const viaModule = (
      await planOrgInit({
        target,
        name: "parity-org",
        stateHome,
        homeDir,
      })
    ).preview;

    const { stdout } = await execFileAsync(
      "node",
      [
        SOURCE_LAUNCHER,
        "org",
        "init",
        target,
        "--name",
        "parity-org",
        "--state-home",
        stateHome,
        "--dry-run",
        "--json",
      ],
      { encoding: "utf8", env, cwd: root, timeout: 25_000 },
    );

    const viaLauncher = JSON.parse(stdout) as Record<string, unknown>;

    expect(viaLauncher["status"]).toBe("ready");
    // Same op, two entries, one truth — full preview equality includes every
    // generated destination path and content hash.
    expect(stableJson(viaLauncher)).toBe(stableJson(viaModule));
  });
});
