// Tests the durable planner->ticket publication record (#128) in
// src/loop/plan-publication-record.ts: write/read round-trip, absent-file
// semantics, and the invalid-is-an-error contract — a corrupted record must
// surface as a diagnostic error, never flow into an identity comparison.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishedTicketsPath,
  readPublishedTicketsRecord,
  writePublishedTicketsRecord,
} from "../../src/loop/plan-publication-record.js";
import type { PlanProvenance } from "../../src/loop/plan-tickets.js";

const PROVENANCE: PlanProvenance = {
  episodeId: "trace:greenfield:plan-greenfield-1234",
  runId: "20260718-090000-plan-bootstrap-bootstrap-plan",
  traceId: "plan-greenfield-1234",
};

describe("published-tickets record", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function seed(contents: string): void {
    root = mkdtempSync(join(tmpdir(), "operon-pubrec-"));
    const path = publishedTicketsPath(root, "greenfield", PROVENANCE.runId);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }

  it("round-trips a written record and reads absence as undefined", async () => {
    root = mkdtempSync(join(tmpdir(), "operon-pubrec-"));
    const written = await writePublishedTicketsRecord(
      root,
      "greenfield",
      PROVENANCE,
      [{ index: 0, issueNumber: 41, title: "Ship it", ready: true, labels: ["op:ready"] }],
      new Date("2026-07-18T09:00:00Z"),
    );
    expect(await readPublishedTicketsRecord(root, "greenfield", PROVENANCE.runId)).toEqual(written);
    expect(written.published[0]).toEqual({
      index: 0,
      issue_number: 41,
      title: "Ship it",
      ready: true,
      labels: ["op:ready"],
    });
    expect(await readPublishedTicketsRecord(root, "greenfield", "20260718-000000-none-none")).toBeUndefined();
  });

  it("throws the diagnostic error on JSON null — never a raw TypeError (review fix)", async () => {
    seed("null\n");
    await expect(readPublishedTicketsRecord(root, "greenfield", PROVENANCE.runId)).rejects.toThrow(
      /greenfield\/20260718-090000-plan-bootstrap-bootstrap-plan is not a valid v1 record/,
    );
  });

  it("throws on non-JSON content with the file identity in the message", async () => {
    seed("{ torn");
    await expect(readPublishedTicketsRecord(root, "greenfield", PROVENANCE.runId)).rejects.toThrow(
      /is not valid JSON/,
    );
  });

  it("rejects wrong-typed identity fields instead of returning them (review fix)", async () => {
    seed(
      JSON.stringify({
        schema_version: 1,
        app: "greenfield",
        episode_id: 42, // wrong type — must fail the read, not flow onward
        run_id: PROVENANCE.runId,
        trace_id: PROVENANCE.traceId,
        published_at: "2026-07-18T09:00:00.000Z",
        published: [{}],
      }),
    );
    await expect(readPublishedTicketsRecord(root, "greenfield", PROVENANCE.runId)).rejects.toThrow(
      /is not a valid v1 record/,
    );
  });
});
