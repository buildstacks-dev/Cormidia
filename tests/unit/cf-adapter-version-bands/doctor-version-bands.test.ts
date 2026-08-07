// CF-B02/03/04-BANDS (#331) — `cormidia doctor` reports all three bands for
// every harness: the declared floor, the version certification ran against,
// and what is actually installed. Detection is token-free, so the bands are
// reported even when the readiness probe is skipped.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdDoctorArgs } from "../../../src/cli/doctor.js";
import { HARNESS_SUPPORT } from "../../../src/runtime/harness-support.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

interface DoctorJson {
  adapters: Array<{ name: string; status: string; detail: string }>;
  harnessVersions: Array<{
    runtime: string;
    band: string;
    floor: string;
    testedWith: string;
    testedEvidence: string;
    version?: string;
    detail: string;
  }>;
}

let org: TempOrgHome | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await org?.cleanup();
  org = undefined;
});

async function runDoctor(): Promise<DoctorJson> {
  org = await makeTempOrgHome({ name: "version-bands" });
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  await cmdDoctorArgs(["--org-home", org.orgHome, "--state-home", org.stateHome, "--config-only", "--json"]);
  const payload = lines.join("\n");
  return JSON.parse(payload) as DoctorJson;
}

describe("CF-B02/03/04-BANDS — doctor renders the version bands", () => {
  it("reports floor, tested-with, evidence, and the installed version per harness", async () => {
    const report = await runDoctor();
    expect(report.harnessVersions.map((entry) => entry.runtime)).toEqual([...RUNTIME_KINDS]);
    for (const entry of report.harnessVersions) {
      const declaration = HARNESS_SUPPORT[entry.runtime as keyof typeof HARNESS_SUPPORT];
      expect(entry.floor).toBe(declaration.floor);
      expect(entry.testedWith).toBe(declaration.testedWith);
      expect(entry.testedEvidence).toBe(declaration.testedEvidence);
      if (declaration.versionSource.kind === "vendored_npm_package") {
        expect(entry.band).toBe("at_tested");
        expect(entry.version).toBe(declaration.testedWith);
        continue;
      }
      // Installer-shipped harnesses (#224) are the operator's own binary and
      // are legitimately absent here. Doctor must still render the bands, and
      // must never invent a version it did not read.
      expect(["at_tested", "unknown"]).toContain(entry.band);
      if (entry.band === "unknown") expect(entry.version).toBeUndefined();
      else expect(entry.version).toBe(declaration.testedWith);
    }
  });

  it("carries the band onto every adapter row even when the probe is skipped", async () => {
    const report = await runDoctor();
    for (const kind of RUNTIME_KINDS) {
      const row = report.adapters.find((adapter) => adapter.name === kind);
      expect(row, `no doctor row for ${kind}`).toBeDefined();
      const band = report.harnessVersions.find((entry) => entry.runtime === kind)?.band;
      expect(row?.detail).toContain(band === "unknown" ? "undetermined" : "at_tested");
      expect(row?.detail).toContain(`floor ${HARNESS_SUPPORT[kind].floor}`);
      expect(row?.detail).toContain(`tested-with ${HARNESS_SUPPORT[kind].testedWith}`);
      // Drift, band reporting, and an absent operator-installed binary never
      // turn a row into a hard failure.
      expect(row?.status).not.toBe("FAIL");
    }
  });
});
