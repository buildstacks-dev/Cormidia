// Self-test for the scripted `install:packaged` double (HB-120).
//
// The double's whole value is that its exit status is REAL — spawned, not
// asserted about. A double whose failure path silently exited zero would let
// the CF-INV-ACC-7b preflight case pass against nothing.

import { afterEach, describe, expect, it } from "vitest";
import { INSTALL_PROOF_SCHEMA, makePackagedInstallDouble } from "./packaged-install-double.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("fixtures/acceptance/packaged-install-double self-test", () => {
  it("exits zero and emits a parseable proof payload on the happy path", async () => {
    const double = await makePackagedInstallDouble({ installedVersion: "1.4.0", tarballName: "cormidia-1.4.0.tgz" });
    cleanups.push(double.cleanup);
    const run = await double.run(["--replace-source-links"]);
    expect(run.exitCode).toBe(0);
    const proof = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    expect(proof["schema"]).toBe(INSTALL_PROOF_SCHEMA);
    expect(proof["mode"]).toBe("install");
    expect(proof["installed_version"]).toBe("1.4.0");
    expect(proof["replaced_source_links"]).toBe(true);
  });

  it("carries a settable non-zero exit status through a real process", async () => {
    const double = await makePackagedInstallDouble({ exitCode: 3, failureReason: "skill target is not current" });
    cleanups.push(double.cleanup);
    const run = await double.run(["--replace-source-links"]);
    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain("skill target is not current");
  });

  it("aborts in the plan phase when source-backed links are present without --replace-source-links", async () => {
    const double = await makePackagedInstallDouble({ sourceBackedLinksPresent: true });
    cleanups.push(double.cleanup);
    const run = await double.run([]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("source-backed link(s) would block the packaged install");
    expect(run.stdout).toBe("");
  });

  it("a bare --dry-run on such a machine still exits non-zero — the documented trap", async () => {
    const double = await makePackagedInstallDouble({ sourceBackedLinksPresent: true });
    cleanups.push(double.cleanup);
    const bare = await double.run(["--dry-run"]);
    expect(bare.exitCode).toBe(1);

    const both = await double.run(["--dry-run", "--replace-source-links"]);
    expect(both.exitCode).toBe(0);
    expect((JSON.parse(both.stdout.trim()) as Record<string, unknown>)["mode"]).toBe("dry-run");
  });

  it("echoes argv so a campaign can prove which flags it actually passed", async () => {
    const double = await makePackagedInstallDouble();
    cleanups.push(double.cleanup);
    const run = await double.run(["--replace-source-links", "--verbose"]);
    expect((JSON.parse(run.stdout.trim()) as { argv: string[] }).argv).toEqual(["--replace-source-links", "--verbose"]);
  });
});
