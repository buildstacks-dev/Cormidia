// Traceability: CF-INV-ACC-7b · HB-126 · invariants.md INV-ACC-7b.

import { describe, expect, it } from "vitest";
import { parseStoredInstallProof, parseTerminalInstallProof } from "../../campaign/acceptance/packaged-proof-parser.js";

function terminal(): Record<string, unknown> {
  return {
    schema: "cormidia-install-packaged-proof/1",
    mode: "install",
    argv: ["--replace-source-links"],
    installed_version: "1.4.0",
    tarball: { name: "cormidia-1.4.0.tgz", sha256: "a".repeat(64) },
    replaced_source_links: true,
  };
}

describe("packaged install proof trust boundary", () => {
  it("refuses malformed mode, argv, and tarball before any campaign callback", () => {
    let callbacks = 0;
    for (const mutate of [
      (value: Record<string, unknown>) => (value["mode"] = "installed"),
      (value: Record<string, unknown>) => (value["argv"] = ["--replace-source-links", 1]),
      (value: Record<string, unknown>) => (value["tarball"] = { name: "cormidia.tgz", sha256: "UPPER" }),
    ]) {
      const value = terminal();
      mutate(value);
      expect(() => {
        parseTerminalInstallProof(value);
        callbacks += 1;
      }).toThrow();
    }
    expect(callbacks).toBe(0);
  });

  it("closed-parses the reviewed on-disk proof and its exact instant", () => {
    const stored = {
      exitCode: 0,
      argv: ["--replace-source-links"],
      mode: "install",
      installedVersion: "1.4.0",
      tarball: { name: "cormidia-1.4.0.tgz", sha256: "a".repeat(64) },
      ranAt: "2026-08-08T00:00:00.000Z",
    };
    expect(parseStoredInstallProof(stored).ranAt.toISOString()).toBe(stored.ranAt);
    expect(() => parseStoredInstallProof({ ...stored, extra: true })).toThrow(/unknown fields/);
  });
});
