// fixtures/acceptance/packaged-install-double.ts — a scripted stand-in for
// `pnpm install:packaged`, spawned as a REAL process with a settable exit
// status.
//
// CORMIDIA-INV-ACC-7b is explicit that the campaign asserts the script's exit
// status and does NOT reimplement its checks — `scripts/install-packaged.mjs`
// already resolves each declared binary, refuses a checkout-internal
// resolution, and refuses any skill target that is not `current`. So the
// double models the script's OBSERVABLE contract only: argv, exit code, and
// the proof payload on stdout. It deliberately contains no resolution logic,
// because a double that reimplemented the check would let the campaign pass
// against a lie the real script would have caught.
//
// The two behaviors it reproduces from the real script (acceptance/README.md →
// "Installing the way a user does") are the ones a campaign gets wrong:
//   * source-backed `link:local` links present without `--replace-source-links`
//     abort in the PLAN phase, before any mutation;
//   * a bare `--dry-run` on such a machine therefore exits NON-ZERO, and that
//     non-zero exit must never be read as a rehearsal pass.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** One line of stdout, matching what the campaign preflight parses. */
export const INSTALL_PROOF_SCHEMA = "cormidia-install-packaged-proof/1";

export interface PackagedInstallScript {
  /** Exit status for a run that reaches the install phase. Default 0. */
  exitCode?: number;
  installedVersion?: string;
  tarballName?: string;
  tarballSha256?: string;
  /** Model a machine with `pnpm link:local` symlinks still in place. */
  sourceBackedLinksPresent?: boolean;
  /** Extra stderr text for the install-phase failure path. */
  failureReason?: string;
}

export interface PackagedInstallRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PackagedInstallDouble {
  command: string;
  /** Base args; callers append campaign flags such as `--replace-source-links`. */
  args: string[];
  scriptPath: string;
  run(extraArgs?: readonly string[]): Promise<PackagedInstallRun>;
  cleanup(): Promise<void>;
}

function scriptSource(script: PackagedInstallScript): string {
  const config = {
    exitCode: script.exitCode ?? 0,
    installedVersion: script.installedVersion ?? "1.4.0",
    tarballName: script.tarballName ?? "cormidia-1.4.0.tgz",
    tarballSha256: script.tarballSha256 ?? "a".repeat(64),
    sourceBackedLinksPresent: script.sourceBackedLinksPresent ?? false,
    failureReason: script.failureReason ?? "",
  };
  return [
    `const config = ${JSON.stringify(config)};`,
    `const argv = process.argv.slice(2);`,
    `const dryRun = argv.includes("--dry-run");`,
    `const replace = argv.includes("--replace-source-links");`,
    // Plan phase: mutates nothing, and refuses BEFORE the dry-run exit.
    `if (config.sourceBackedLinksPresent && !replace) {`,
    `  process.stderr.write("2 source-backed link(s) would block the packaged install\\n");`,
    `  process.exit(1);`,
    `}`,
    `const proof = {`,
    `  schema: ${JSON.stringify(INSTALL_PROOF_SCHEMA)},`,
    `  mode: dryRun ? "dry-run" : "install",`,
    `  argv,`,
    `  installed_version: config.installedVersion,`,
    `  tarball: { name: config.tarballName, sha256: config.tarballSha256 },`,
    `  replaced_source_links: replace,`,
    `};`,
    `process.stdout.write(JSON.stringify(proof) + "\\n");`,
    `if (dryRun) process.exit(0);`,
    `if (config.exitCode !== 0 && config.failureReason) process.stderr.write(config.failureReason + "\\n");`,
    `process.exit(config.exitCode);`,
    "",
  ].join("\n");
}

export async function makePackagedInstallDouble(script: PackagedInstallScript = {}): Promise<PackagedInstallDouble> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-install-double-"));
  const scriptPath = join(root, "install-packaged-double.mjs");
  await writeFile(scriptPath, scriptSource(script), "utf8");
  return {
    command: process.execPath,
    args: [scriptPath],
    scriptPath,
    async run(extraArgs = []) {
      try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...extraArgs], {
          encoding: "utf8",
        });
        return { exitCode: 0, stdout, stderr };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
      }
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
