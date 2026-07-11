// Tests the InterventionRecord lineage contract
// (src/org/learning/intervention.ts; spec §11, design §9.2). M3
// done-criterion 3: every published change — including a plain ticket — has
// a complete InterventionRecord chain; incomplete chains are named gap by
// gap, impossible states are rejected outright, and lineage only advances.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  interventionChainGaps,
  interventionPath,
  listInterventionRecords,
  readInterventionRecord,
  validateInterventionRecord,
  writeInterventionRecord,
} from "../../src/org/learning/intervention.js";
import { makeIntervention } from "./helpers.js";

const CLEANUPS: Array<() => void> = [];
afterEach(() => {
  while (CLEANUPS.length > 0) CLEANUPS.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-int-"));
  CLEANUPS.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("validateInterventionRecord", () => {
  it("accepts a routinely published ticket (approval_ref legitimately null)", () => {
    const record = validateInterventionRecord(makeIntervention());
    expect(record.destination).toBe("ticket");
    expect(record.approval_ref).toBeNull();
    expect(record.publish?.kind).toBe("issue");
  });

  it("rejects a validated claim without the experiment that produced it (design §9.1)", () => {
    expect(() =>
      validateInterventionRecord(
        makeIntervention({
          status: "active",
          activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "validated" },
        }),
      ),
    ).toThrow(/nothing but a completed experiment produces validated/);
  });

  it("accepts a validated claim with its full experiment/outcome lineage", () => {
    const record = validateInterventionRecord(
      makeIntervention({
        destination: "okf_concept",
        status: "active",
        approval_ref: "appr_01JXYZ",
        activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "validated" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        experiment_ref: "exp_builder-test-mapping_01",
        outcome_ref: "eval_0123456789ab",
      }),
    );
    expect(interventionChainGaps(record)).toEqual([]);
  });

  it("rejects published/active records without a publish block", () => {
    expect(() => validateInterventionRecord(makeIntervention({ publish: null }))).toThrow(
      /only proposed interventions are unpublished/,
    );
  });

  it("rejects rollback/status disagreements in both directions", () => {
    expect(() =>
      validateInterventionRecord(
        makeIntervention({
          rollback: { rolled_back_at: "2026-07-12T09:00:00.000Z", reason: "regression" },
        }),
      ),
    ).toThrow(/requires status "rolled_back"/);
    expect(() => validateInterventionRecord(makeIntervention({ status: "rolled_back" }))).toThrow(
      /requires the rollback block/,
    );
  });

  it("rejects an activation on a merely proposed record", () => {
    expect(() =>
      validateInterventionRecord(
        makeIntervention({
          status: "proposed",
          publish: null,
          activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "authorized" },
        }),
      ),
    ).toThrow(/proposed intervention cannot carry an activation/);
  });

  it("rejects destination reject — rejections live in the ledger, not interventions", () => {
    expect(() => validateInterventionRecord(makeIntervention({ destination: "reject" }))).toThrow(
      /destination must be one of/,
    );
  });
});

describe("interventionChainGaps (done-criterion 3)", () => {
  it("a plain published ticket has a complete chain", () => {
    expect(interventionChainGaps(validateInterventionRecord(makeIntervention()))).toEqual([]);
  });

  it("a published change without a reviewed content hash is a named gap", () => {
    const record = validateInterventionRecord(makeIntervention({ reviewed_content_hash: null }));
    expect(interventionChainGaps(record)).toEqual(["reviewed_content_hash"]);
  });

  it("an active concept without approval and episode linkage names every gap", () => {
    const record = validateInterventionRecord(
      makeIntervention({
        destination: "okf_concept",
        status: "active",
        publish: {
          kind: "bundle_version",
          ref: "org@2026.07.11-1",
          commit: "9c4e000",
          published_at: "2026-07-11T09:00:00.000Z",
        },
        activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "authorized" },
      }),
    );
    expect(interventionChainGaps(record)).toEqual(["approval_ref", "affected_episodes"]);
  });

  it("an experiment without a recorded outcome is a chain gap, not a silent maybe", () => {
    const record = validateInterventionRecord(
      makeIntervention({ experiment_ref: "exp_builder-test-mapping_01" }),
    );
    expect(interventionChainGaps(record)).toEqual([
      "outcome_ref (experiment declared but no recorded outcome)",
    ]);
  });

  it("a proposed record has no chain yet — nothing published, nothing missing", () => {
    const record = validateInterventionRecord(
      makeIntervention({ status: "proposed", publish: null, reviewed_content_hash: null }),
    );
    expect(interventionChainGaps(record)).toEqual([]);
  });
});

describe("writeInterventionRecord", () => {
  it("persists under learning/interventions/ and reads back validated", async () => {
    const orgHome = tempDir();
    const record = await writeInterventionRecord(orgHome, makeIntervention());
    expect(interventionPath(orgHome, record.intervention_id)).toContain(
      join("learning", "interventions"),
    );
    expect(await readInterventionRecord(orgHome, record.intervention_id)).toEqual(record);
    expect(await listInterventionRecords(orgHome)).toEqual([record]);
  });

  it("lineage only advances: a later status cannot move back", async () => {
    const orgHome = tempDir();
    await writeInterventionRecord(
      orgHome,
      makeIntervention({
        destination: "okf_concept",
        status: "active",
        approval_ref: "appr_01JXYZ",
        activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
      }),
    );
    await expect(writeInterventionRecord(orgHome, makeIntervention())).rejects.toThrow(
      /lineage only advances/,
    );
    // Forward to rolled_back is legal and completes the chain with the why.
    const rolledBack = await writeInterventionRecord(
      orgHome,
      makeIntervention({
        destination: "okf_concept",
        status: "rolled_back",
        approval_ref: "appr_01JXYZ",
        activation: { activated_at: "2026-07-11T09:00:00.000Z", claim: "authorized" },
        affected_episodes: { query: "bundle_versions.org >= 2026.07.11-1" },
        rollback: { rolled_back_at: "2026-07-12T09:00:00.000Z", reason: "late regression on alpha" },
      }),
    );
    expect(interventionChainGaps(rolledBack)).toEqual([]);
  });
});
