// campaign/acceptance/packaged-provenance.ts — the binaries are the packaged
// ones (CORMIDIA-INV-ACC-7b; CORMIDIA-C-B27-001 §1.2).
//
// THE GUARDRAIL ALREADY EXISTS AND IS NOT REBUILT HERE.
// `scripts/install-packaged.mjs` performs build → `npm pack` → global tarball
// install → skill links from the installed root, then refuses if any binary
// still resolves inside this checkout or any skill target is not `current`.
// This module asserts that script's EXIT STATUS and records what it installed.
// Reimplementing its resolution checks would be worse than useless: the copy
// would drift, and a campaign would then pass against a lie the real script
// catches.
//
// Three ways a campaign fools itself about provenance, so three checks:
//   * the preflight was never run, or exited non-zero;
//   * the preflight predates the campaign's own commit pin, so it proves a
//     different tree;
//   * the preflight was `--dry-run`, and its exit status was read as a
//     rehearsal pass. On a machine with `link:local` active a bare `--dry-run`
//     exits NON-ZERO from the plan phase, and even a clean dry run installed
//     nothing at all.

export type PackagedProvenanceCode =
  | "preflight-missing"
  | "preflight-failed"
  | "preflight-stale"
  | "preflight-dry-run"
  | "preflight-flags"
  | "identity-missing"
  | "source-backed-invocation";

export class PackagedProvenanceError extends Error {
  constructor(
    readonly code: PackagedProvenanceCode,
    message: string,
  ) {
    super(`campaign refused: packaged-install preflight (${code}): ${message}`);
    this.name = "PackagedProvenanceError";
  }
}

/** Exactly what a run of the real script tells the campaign. */
export interface PackagedInstallProof {
  exitCode: number;
  /** Argv the script was invoked with, minus the interpreter and path. */
  argv: readonly string[];
  mode: "install" | "dry-run";
  installedVersion?: string;
  tarball?: { name: string; sha256: string };
  /** When the preflight ran. Compared against the campaign's commit-pin time. */
  ranAt: Date;
  stderr?: string;
}

export interface PackagedProvenanceRecord {
  installedVersion: string;
  tarballName: string;
  tarballSha256: string;
  preflightRanAt: string;
  preflightArgv: string[];
  /** Restated in the report: the dev loop was displaced for the campaign. */
  displacedSourceLinks: true;
  restoreCommand: "pnpm link:local";
}

export interface AssertPackagedProvenanceInput {
  proof?: PackagedInstallProof;
  /** When the campaign's authorized commit was created. */
  commitPinAt: Date;
  /** Commands any campaign turn invoked, so a `pnpm dev` slip is caught. */
  turnCommands?: readonly string[];
}

const SOURCE_BACKED = [/\bpnpm\s+dev\b/, /\btsx\s+src\//, /\bnode\s+.*\/src\/cli\.ts\b/];

/**
 * Fail-closed. Returns the provenance record the report must carry so "which
 * bytes did this campaign exercise" is answerable from the report alone.
 */
export function assertPackagedProvenance(input: AssertPackagedProvenanceInput): PackagedProvenanceRecord {
  const proof = input.proof;
  if (proof === undefined) {
    throw new PackagedProvenanceError(
      "preflight-missing",
      "no `pnpm install:packaged --replace-source-links` run is recorded for this campaign",
    );
  }

  // Ordered so the sharpest reading error is named as itself: a dry run that
  // exited non-zero is a dry run, not a failed install.
  if (proof.mode === "dry-run") {
    throw new PackagedProvenanceError(
      "preflight-dry-run",
      `the recorded preflight was \`--dry-run\` (exit ${proof.exitCode}); it installed nothing, so neither a zero ` +
        `nor a non-zero exit from it is a rehearsal pass`,
    );
  }
  if (proof.exitCode !== 0) {
    throw new PackagedProvenanceError(
      "preflight-failed",
      `exit ${proof.exitCode}${proof.stderr === undefined ? "" : `: ${proof.stderr.trim()}`}`,
    );
  }
  if (!proof.argv.includes("--replace-source-links")) {
    throw new PackagedProvenanceError(
      "preflight-flags",
      "the preflight must run with `--replace-source-links`; without it a source-backed link aborts the plan phase " +
        "and the packaged install never happens",
    );
  }
  if (proof.ranAt.getTime() < input.commitPinAt.getTime()) {
    throw new PackagedProvenanceError(
      "preflight-stale",
      `the preflight ran at ${proof.ranAt.toISOString()}, before the campaign's commit pin ` +
        `(${input.commitPinAt.toISOString()}); it proves a different tree`,
    );
  }
  if (proof.installedVersion === undefined || proof.tarball === undefined) {
    throw new PackagedProvenanceError(
      "identity-missing",
      "the preflight reported no installed version or tarball identity; a report that cannot answer " +
        '"which bytes did this exercise" is malformed, not merely thin',
    );
  }

  for (const command of input.turnCommands ?? []) {
    if (SOURCE_BACKED.some((pattern) => pattern.test(command))) {
      throw new PackagedProvenanceError(
        "source-backed-invocation",
        `a campaign turn invoked ${JSON.stringify(command)}, which executes TypeScript ` +
          "`npm install -g cormidia` never ships",
      );
    }
  }

  return {
    installedVersion: proof.installedVersion,
    tarballName: proof.tarball.name,
    tarballSha256: proof.tarball.sha256,
    preflightRanAt: proof.ranAt.toISOString(),
    preflightArgv: [...proof.argv],
    displacedSourceLinks: true,
    restoreCommand: "pnpm link:local",
  };
}

/** Parse one run of the install double / the real script into a proof. */
export function parseInstallProof(
  run: { exitCode: number; stdout: string; stderr: string },
  ranAt: Date,
): PackagedInstallProof {
  const line = run.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (line === undefined) {
    return { exitCode: run.exitCode, argv: [], mode: "install", ranAt, stderr: run.stderr };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { exitCode: run.exitCode, argv: [], mode: "install", ranAt, stderr: run.stderr };
  }
  const tarball = parsed["tarball"];
  const version = parsed["installed_version"];
  return {
    exitCode: run.exitCode,
    argv: Array.isArray(parsed["argv"]) ? (parsed["argv"] as string[]) : [],
    mode: parsed["mode"] === "dry-run" ? "dry-run" : "install",
    ranAt,
    stderr: run.stderr,
    ...(typeof version === "string" ? { installedVersion: version } : {}),
    ...(typeof tarball === "object" && tarball !== null
      ? { tarball: tarball as { name: string; sha256: string } }
      : {}),
  };
}
