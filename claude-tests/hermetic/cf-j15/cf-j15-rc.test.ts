// CF-J15-RC / CF-B12 reader corruption: torn/corrupt records are rejected,
// their owning source is invalid, and claims remain explicitly incomplete.

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { buildReport } from "../../../src/report/project.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { J15_APP, J15_APPS, J15_NOW, githubResult, seedJ15Run } from "./support.js";

function assertInvalidSource(status: string, detail: string): void {
  if (status === "healthy" || !/(torn|unreadable|malformed)/i.test(detail)) {
    throw new Error(`corrupt source overclaimed health: ${status} ${detail}`);
  }
}

describe("CF-J15-RC — torn local reads are rejected and source-scoped", () => {
  const states: TempStateHome[] = [];
  afterEach(async () => {
    for (const state of states.splice(0).reverse()) await state.cleanup();
  });

  it("a torn final ledger append degrades only ledger truth and is disclosed by Observer and Reports", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-rc-torn-ledger" });
    states.push(state);
    await seedJ15Run(state);
    await appendFile(state.path("telemetry", "2026-07-31.jsonl"), "{\"at\":\"torn", "utf8");

    const local = await indexLocalSources({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      filters: {},
      now: J15_NOW,
    });
    const ledger = local.source_health.find((source) => source.id === "ledger")!;
    assertInvalidSource(ledger.status, ledger.detail);
    expect(local.ledger).toHaveLength(1);

    const snapshot = projectObserveSnapshot({
      ...local,
      cursor: "0",
      github: githubResult(J15_NOW.toISOString()).apps,
    });
    expect(snapshot.sources.find((source) => source.id === "ledger")?.status).toBe("degraded");
    expect(snapshot.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source_health", detail: expect.stringMatching(/torn final append/) }),
    ]));
    expect(snapshot.totals.cost.known_cost_usd).toBe(1.25);

    const report = await buildReport({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      query: { period: "all" },
      now: J15_NOW,
    });
    expect(report.quality.torn_tails).toBe(1);
    expect(report.quality.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "torn_tail", day: "2026-07-31" }),
    ]));
    expect(report.quality.notices.join(" ")).toMatch(/torn/i);
  });

  it("an unreadable envelope remains a visible corrupt pass while local-file claims degrade", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-rc-envelope" });
    states.push(state);
    const runDir = state.path("runs", J15_APP, "corrupt-run");
    await mkdir(runDir, { recursive: true });
    await writeFile(state.path("runs", J15_APP, "corrupt-run", "envelope.json"), "{\"status\":", "utf8");

    const local = await indexLocalSources({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      filters: {},
      now: J15_NOW,
    });
    const files = local.source_health.find((source) => source.id === "local_files")!;
    assertInvalidSource(files.status, files.detail);
    const snapshot = projectObserveSnapshot({
      ...local,
      cursor: "0",
      github: githubResult(J15_NOW.toISOString()).apps,
    });
    expect(snapshot.passes).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: "corrupt-run", status: "corrupt(envelope)", usage: expect.objectContaining({ quality: "unavailable" }) }),
    ]));
    expect(snapshot.passes.find((pass) => pass.run_id === "corrupt-run")?.quality_reason).toMatch(/unreadable/i);
  });

  it("negative control: the invalid-source detector fires if a corrupt read is seeded as healthy", () => {
    expect(() => assertInvalidSource("healthy", "all good")).toThrow(/overclaimed health/);
  });
});
