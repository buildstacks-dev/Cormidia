// CF-B30 / CF-C-B30 — HB-128 — contracts/B-30-job-config-journal.md, CORMIDIA-C-B30-003.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditJobInvocation } from "../../../../src/jobs/invocation-audit.js";
import { makeTempStateHome } from "../../../fixtures/state-home.js";

describe("CF-B30-AUDIT — cormidia-job participates in the command ledger", () => {
  it("records a terminal invocation around a live run", async () => {
    const state = await makeTempStateHome({ name: "job-audit" });
    try {
      const moments = [new Date("2026-08-08T01:00:00Z"), new Date("2026-08-08T01:00:02Z")];
      await expect(
        auditJobInvocation(["run", "/tmp/job.yaml", "--json"], async () => 0, {
          stateHome: state.stateHome,
          now: () => moments.shift()!,
        }),
      ).resolves.toBe(0);
      const rows = (await readFile(join(state.stateHome, "invocations", "2026-08-08.jsonl"), "utf8"))
        .trim()
        .split("\n");
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!)).toMatchObject({
        command: "cormidia-job",
        subcommand: "run",
        exitCode: 0,
        wallClockMs: 2000,
      });
    } finally {
      await state.cleanup();
    }
  });

  it("negative control: explain remains token-free and creates no audit home requirement", async () => {
    await expect(auditJobInvocation(["explain", "/tmp/job.yaml"], async () => 0)).resolves.toBe(0);
  });
});
