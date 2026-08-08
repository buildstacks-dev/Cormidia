// CF-B27-* (L2) — durable report persistence and resume (B-27 §3).
//
// Every clause here was contract text with no implementation until this landed:
// the runner built its report in memory and returned it. The expensive failure
// is not losing a file — it is a campaign that spent real tokens for hours,
// crashed, and left something a reader accepts as terminal truth.

import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptanceCampaignReport } from "../../campaign/acceptance/campaign-report.js";
import {
  campaignReportPath,
  claimCampaignIdentity,
  configHash,
  persistReport,
  readStoredReport,
  ReportStoreError,
} from "../../campaign/acceptance/report-store.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const cleanups: Array<() => Promise<void>> = [];
const clock = (): Date => new Date("2026-08-08T12:00:00.000Z");

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function root(name: string): Promise<TempStateHome> {
  const fixture = await makeTempStateHome({ name });
  cleanups.push(fixture.cleanup);
  return fixture;
}

function report(overrides: Partial<AcceptanceCampaignReport> = {}): AcceptanceCampaignReport {
  return {
    schema_version: 1,
    campaign_id: "l-acc-run-1",
    lane: "L-ACC",
    commit: "a".repeat(40),
    provenance: {
      installedVersion: "1.4.0",
      tarballName: "cormidia-1.4.0.tgz",
      tarballSha256: "c".repeat(64),
      preflightRanAt: "2026-08-08T10:00:00.000Z",
      preflightArgv: ["--replace-source-links"],
      displacedSourceLinks: true,
      restoreCommand: "pnpm link:local",
    },
    scenarios: [],
    verdict: "inconclusive",
    release_signal: null,
    rq1_relationship: "outside RQ-1; produces no release evidence",
    authorized_scenario_ids: [],
    spend: {
      maxOutputTokens: 4_000_000,
      maxEquivUsd: 520,
      observedOutputTokens: 0,
      observedEquivUsd: 0,
      debitedUnknownOutputTokens: 0,
      debitedUnknownEquivUsd: 0,
      ceilingExhausted: false,
      reservationRefusals: [],
    },
    gaps: [],
    ...overrides,
  };
}

async function refusal(run: () => Promise<unknown>): Promise<ReportStoreError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReportStoreError) return error;
    throw error;
  }
  throw new Error("expected a ReportStoreError, but the store accepted it");
}

describe("CF-B27-* the config hash is a content identity", () => {
  it("is stable under key order and sensitive to content", () => {
    expect(configHash({ a: 1, b: [2, 3] })).toBe(configHash({ b: [2, 3], a: 1 }));
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }));
  });

  it("ignores undefined-valued keys, which JSON would drop anyway", () => {
    expect(configHash({ a: 1, b: undefined })).toBe(configHash({ a: 1 }));
  });
});

describe("CF-B27-* persistence is atomic and re-readable", () => {
  it("writes a report and reads back exactly what it stored", async () => {
    const fixture = await root("report-roundtrip");
    const hash = configHash({ campaignId: "l-acc-run-1" });
    await persistReport({ root: fixture.stateHome, configSha256: hash, report: report(), status: "running", clock });

    const stored = await readStoredReport(fixture.stateHome, "l-acc-run-1");
    expect(stored?.status).toBe("running");
    expect(stored?.config_sha256).toBe(hash);
    expect(stored?.report.release_signal).toBeNull();
    expect(stored?.updated_at).toBe("2026-08-08T12:00:00.000Z");
  });

  it("leaves a parseable file behind, never a half-written one", async () => {
    const fixture = await root("report-atomic");
    await persistReport({
      root: fixture.stateHome,
      configSha256: configHash({}),
      report: report(),
      status: "running",
      clock,
    });
    const contents = await readFile(campaignReportPath(fixture.stateHome, "l-acc-run-1"), "utf8");
    expect(() => JSON.parse(contents)).not.toThrow();
  });

  it("returns undefined for a campaign that has never run", async () => {
    const fixture = await root("report-absent");
    expect(await readStoredReport(fixture.stateHome, "never-ran")).toBeUndefined();
  });

  it("negative control: a torn report is REFUSED, never read as 'not started'", async () => {
    const fixture = await root("report-torn");
    await persistReport({
      root: fixture.stateHome,
      configSha256: configHash({}),
      report: report(),
      status: "running",
      clock,
    });
    const path = campaignReportPath(fixture.stateHome, "l-acc-run-1");
    const whole = await readFile(path, "utf8");
    await writeFile(path, whole.slice(0, Math.floor(whole.length / 2)), "utf8");

    expect((await refusal(async () => readStoredReport(fixture.stateHome, "l-acc-run-1"))).code).toBe("report-torn");
  });

  it("negative control: a structurally incomplete envelope is refused too", async () => {
    const fixture = await root("report-shape");
    const path = campaignReportPath(fixture.stateHome, "l-acc-run-1");
    await persistReport({
      root: fixture.stateHome,
      configSha256: configHash({}),
      report: report(),
      status: "running",
      clock,
    });
    await writeFile(path, JSON.stringify({ schema_version: 1, campaign_id: "l-acc-run-1" }), "utf8");
    expect((await refusal(async () => readStoredReport(fixture.stateHome, "l-acc-run-1"))).code).toBe("report-torn");
  });
});

describe("CF-B27-* identity claiming and resume", () => {
  it("claims a fresh identity when nothing was stored", async () => {
    const fixture = await root("claim-fresh");
    const claim = await claimCampaignIdentity({
      root: fixture.stateHome,
      campaignId: "l-acc-run-1",
      configSha256: configHash({ a: 1 }),
    });
    expect(claim.kind).toBe("fresh");
  });

  it("resumes the same campaign under the same config", async () => {
    const fixture = await root("claim-resume");
    const hash = configHash({ a: 1 });
    await persistReport({ root: fixture.stateHome, configSha256: hash, report: report(), status: "running", clock });

    const claim = await claimCampaignIdentity({
      root: fixture.stateHome,
      campaignId: "l-acc-run-1",
      configSha256: hash,
    });
    expect(claim.kind).toBe("resume");
    expect(claim.existing?.report.campaign_id).toBe("l-acc-run-1");
  });

  it("negative control: a config changed under a live campaign refuses and names the drift", async () => {
    const fixture = await root("claim-drift");
    await persistReport({
      root: fixture.stateHome,
      configSha256: configHash({ scenarios: 3 }),
      report: report(),
      status: "running",
      clock,
    });

    const error = await refusal(async () =>
      claimCampaignIdentity({
        root: fixture.stateHome,
        campaignId: "l-acc-run-1",
        configSha256: configHash({ scenarios: 2 }),
      }),
    );
    expect(error.code).toBe("config-hash-drift");
    expect(error.message).toContain("a different campaign, not a resume");
  });

  it("negative control: two campaigns cannot share a report identity", async () => {
    const fixture = await root("claim-conflict");
    const hash = configHash({ a: 1 });
    await persistReport({ root: fixture.stateHome, configSha256: hash, report: report(), status: "final", clock });

    expect(
      (
        await refusal(async () =>
          claimCampaignIdentity({ root: fixture.stateHome, campaignId: "l-acc-run-1", configSha256: hash }),
        )
      ).code,
    ).toBe("report-already-final");
  });

  it("a finalized report stays readable — evidence outlives the campaign", async () => {
    const fixture = await root("claim-final-readable");
    await persistReport({
      root: fixture.stateHome,
      configSha256: configHash({}),
      report: report(),
      status: "final",
      clock,
    });
    expect((await readStoredReport(fixture.stateHome, "l-acc-run-1"))?.status).toBe("final");
  });
});
