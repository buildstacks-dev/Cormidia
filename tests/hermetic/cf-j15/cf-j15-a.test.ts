// CF-J15-A / CF-IF-XSURF / CF-IF-HTML — one fixture, one canonical answer
// through report CLI rendering, JSON, /reports API, portable HTML, and Live.

import { afterEach, describe, expect, it } from "vitest";
import { ObserveService } from "../../../src/observe/live-source.js";
import { startObserveServer, type StartedObserveServer } from "../../../src/observe/server.js";
import { buildReport } from "../../../src/report/project.js";
import { renderReportHtml } from "../../../src/report/render-html.js";
import { renderReportTerminal } from "../../../src/report/render-terminal.js";
import { ReportService } from "../../../src/report/service.js";
import type { CostAggregate } from "../../../src/runtime/cost.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { J15_APPS, J15_NOW, githubResult, scriptedGithubSource, seedJ15Run } from "./support.js";

function assertSameCost(reference: CostAggregate, candidates: CostAggregate[]): void {
  for (const candidate of candidates) {
    if (JSON.stringify(candidate) !== JSON.stringify(reference)) {
      throw new Error(`cross-surface cost drift: ${JSON.stringify(reference)} != ${JSON.stringify(candidate)}`);
    }
  }
}

function embeddedReport(html: string): { headline: { cost: CostAggregate } } {
  const match = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) throw new Error("portable report omitted embedded data");
  return JSON.parse(match[1]) as { headline: { cost: CostAggregate } };
}

describe("CF-J15-A / CF-IF-XSURF — report and observe surfaces agree", () => {
  const states: TempStateHome[] = [];
  const services: ObserveService[] = [];
  const servers: StartedObserveServer[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0).reverse()) await server.close();
    for (const service of services.splice(0).reverse()) await service.stop();
    for (const state of states.splice(0).reverse()) await state.cleanup();
  });

  it("CLI text, JSON, Live snapshot, /reports, and portable HTML project the identical ledger aggregate", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-a" });
    states.push(state);
    await seedJ15Run(state);
    const query = { period: "all" as const };
    const report = await buildReport({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      query,
      now: J15_NOW,
    });
    const json = JSON.parse(JSON.stringify(report)) as typeof report;
    const html = renderReportHtml(report);
    const terminal = renderReportTerminal(report);

    const observe = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([githubResult(J15_NOW.toISOString())]),
      clock: () => J15_NOW,
      watchFiles: false,
    });
    services.push(observe);
    await observe.start();
    const reportService = new ReportService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      clock: () => J15_NOW,
    });
    const server = await startObserveServer({
      service: observe,
      reportService,
      stateHome: state.stateHome,
      port: 0,
    });
    servers.push(server);
    const headers = { Authorization: `Bearer ${server.token}` };
    const root = `http://${server.host}:${server.port}`;
    const api = await fetch(`${root}/api/v1/reports/summary?period=all`, { headers });
    expect(api.status).toBe(200);
    const apiReport = (await api.json()) as typeof report;
    const exportHtml = await fetch(`${root}/api/v1/reports/export.html?period=all`, { headers });
    expect(exportHtml.status).toBe(200);
    const servedHtml = await exportHtml.text();

    const cost = report.headline.cost;
    assertSameCost(cost, [
      json.headline.cost,
      embeddedReport(html).headline.cost,
      observe.snapshot().totals.cost,
      apiReport.headline.cost,
      embeddedReport(servedHtml).headline.cost,
    ]);
    expect(cost.known_cost_usd).toBe(1.25);
    expect(terminal).toContain("Recorded equivalent cost  $1.25");

    for (const portable of [html, servedHtml]) {
      expect(portable).toContain("connect-src 'none'");
      expect(portable).toContain("default-src 'none'");
      expect(portable).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
      expect(portable).not.toContain("<script src=");
    }
  });

  it("negative control: the agreement detector fires on a seeded surface drift", () => {
    const base: CostAggregate = {
      known_cost_usd: 1.25,
      provider_turns: 1,
      known_turns: 1,
      unknown_turns: 0,
      unknown_refs: [],
      mechanical_passes: 0,
      coverage: "complete",
      usage_quality: "complete",
    };
    expect(() => assertSameCost(base, [{ ...base, known_cost_usd: 0 }])).toThrow(/cross-surface cost drift/);
  });
});
