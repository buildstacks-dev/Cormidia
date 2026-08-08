// CF-INV-ACC-7b (L1/L2) — the campaign asserts `install:packaged`'s exit status
// and records what it installed, without reimplementing the script's checks.
//
// The install double is spawned as a REAL process, so every exit status here is
// an observed one. That matters most for the two documented traps: a machine
// with `link:local` links still in place, and a bare `--dry-run` whose non-zero
// exit is the script working correctly rather than an install failure.

import { afterEach, describe, expect, it } from "vitest";
import {
  assertPackagedProvenance,
  parseInstallProof,
  PackagedProvenanceError,
} from "../../campaign/acceptance/packaged-provenance.js";
import { makePackagedInstallDouble } from "../../fixtures/acceptance/packaged-install-double.js";

const cleanups: Array<() => Promise<void>> = [];
const COMMIT_PIN_AT = new Date("2026-08-07T09:00:00.000Z");
const RAN_AT = new Date("2026-08-07T09:30:00.000Z");

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function refusal(run: () => unknown): PackagedProvenanceError {
  try {
    run();
  } catch (error) {
    if (error instanceof PackagedProvenanceError) return error;
    throw error;
  }
  throw new Error("expected a PackagedProvenanceError, but the preflight was accepted");
}

describe("CF-INV-ACC-7b the happy path records the installed identity", () => {
  it("accepts a zero-exit packaged install and carries version + tarball into the report", async () => {
    const double = await makePackagedInstallDouble({
      installedVersion: "1.4.0",
      tarballName: "cormidia-1.4.0.tgz",
      tarballSha256: "b".repeat(64),
    });
    cleanups.push(double.cleanup);
    const proof = parseInstallProof(await double.run(["--replace-source-links"]), RAN_AT);

    const record = assertPackagedProvenance({ proof, commitPinAt: COMMIT_PIN_AT });
    expect(record.installedVersion).toBe("1.4.0");
    expect(record.tarballName).toBe("cormidia-1.4.0.tgz");
    expect(record.tarballSha256).toBe("b".repeat(64));
    expect(record.displacedSourceLinks).toBe(true);
    expect(record.restoreCommand).toBe("pnpm link:local");
  });
});

describe("CF-INV-ACC-7b the refused cases", () => {
  it("negative control: a campaign started with link:local links present is red", async () => {
    const double = await makePackagedInstallDouble({ sourceBackedLinksPresent: true });
    cleanups.push(double.cleanup);
    const run = await double.run([]);
    expect(run.exitCode).not.toBe(0);

    const error = refusal(() =>
      assertPackagedProvenance({ proof: parseInstallProof(run, RAN_AT), commitPinAt: COMMIT_PIN_AT }),
    );
    expect(error.code).toBe("preflight-failed");
    expect(error.message).toContain("source-backed link(s) would block the packaged install");
  });

  it("negative control: a bare --dry-run non-zero exit is not readable as a rehearsal pass", async () => {
    const double = await makePackagedInstallDouble({ sourceBackedLinksPresent: true });
    cleanups.push(double.cleanup);
    const bare = await double.run(["--dry-run"]);
    expect(bare.exitCode).toBe(1);
    expect(
      refusal(() => assertPackagedProvenance({ proof: parseInstallProof(bare, RAN_AT), commitPinAt: COMMIT_PIN_AT }))
        .code,
    ).toBe("preflight-failed");
  });

  it("negative control: even a CLEAN --dry-run is refused — it installed nothing", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const clean = await double.run(["--dry-run", "--replace-source-links"]);
    expect(clean.exitCode).toBe(0);

    const error = refusal(() =>
      assertPackagedProvenance({ proof: parseInstallProof(clean, RAN_AT), commitPinAt: COMMIT_PIN_AT }),
    );
    expect(error.code).toBe("preflight-dry-run");
  });

  it("negative control: a skipped preflight is refused", () => {
    expect(refusal(() => assertPackagedProvenance({ commitPinAt: COMMIT_PIN_AT })).code).toBe("preflight-missing");
  });

  it("negative control: a preflight older than the commit pin proves a different tree", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const proof = parseInstallProof(await double.run(["--replace-source-links"]), new Date("2026-08-06T09:00:00.000Z"));
    expect(refusal(() => assertPackagedProvenance({ proof, commitPinAt: COMMIT_PIN_AT })).code).toBe("preflight-stale");
  });

  it("negative control: a preflight run without --replace-source-links is refused", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const proof = parseInstallProof(await double.run([]), RAN_AT);
    expect(refusal(() => assertPackagedProvenance({ proof, commitPinAt: COMMIT_PIN_AT })).code).toBe("preflight-flags");
  });

  it("negative control: a preflight reporting no installed identity is malformed, not thin", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const run = await double.run(["--replace-source-links"]);
    const stripped = { ...run, stdout: JSON.stringify({ mode: "install", argv: ["--replace-source-links"] }) };
    expect(
      refusal(() =>
        assertPackagedProvenance({ proof: parseInstallProof(stripped, RAN_AT), commitPinAt: COMMIT_PIN_AT }),
      ).code,
    ).toBe("identity-missing");
  });

  it("negative control: a campaign turn invoking pnpm dev or tsx src/ is refused", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const proof = parseInstallProof(await double.run(["--replace-source-links"]), RAN_AT);

    for (const command of ["pnpm dev dispatch --app acc-1", "tsx src/cli.ts loop", "node ./src/cli.ts observe"]) {
      const error = refusal(() =>
        assertPackagedProvenance({ proof, commitPinAt: COMMIT_PIN_AT, turnCommands: ["cormidia dispatch", command] }),
      );
      expect(error.code).toBe("source-backed-invocation");
    }
  });

  it("accepts packaged binary invocations unchanged", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const proof = parseInstallProof(await double.run(["--replace-source-links"]), RAN_AT);
    expect(() =>
      assertPackagedProvenance({
        proof,
        commitPinAt: COMMIT_PIN_AT,
        turnCommands: ["cormidia dispatch --app acc-1", "cormidia-job run job.yaml"],
      }),
    ).not.toThrow();
  });
});
