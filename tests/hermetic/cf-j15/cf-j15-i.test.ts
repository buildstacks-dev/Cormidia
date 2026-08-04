// CF-J15-I / CF-B12 interruption: observer restart is independent of durable
// work; cached GitHub evidence keeps its old freshness; SSE gaps resync.

import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ObserveService } from "../../../src/observe/live-source.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { J15_APPS, J15_NOW, githubResult, scriptedGithubSource } from "./support.js";

class CaptureResponse extends EventEmitter {
  writableEnded = false;
  readonly chunks: string[] = [];
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
  end(): void { this.writableEnded = true; this.emit("close"); }
  text(): string { return this.chunks.join(""); }
}

function assertResync(text: string): void {
  if (!text.includes("event: resync") || !text.includes("cursor_outside_replay")) {
    throw new Error(`missing required SSE resync: ${text}`);
  }
}

describe("CF-J15-I — observer interruption/restart and SSE resynchronization", () => {
  const states: TempStateHome[] = [];
  const services: ObserveService[] = [];
  afterEach(async () => {
    for (const service of services.splice(0).reverse()) await service.stop();
    for (const state of states.splice(0).reverse()) await state.cleanup();
  });

  it("a failed refresh retains cached GitHub facts at their LAST successful observation time", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-i-stale" });
    states.push(state);
    const successAt = "2026-07-31T12:00:00.000Z";
    const failedAt = "2026-07-31T18:00:00.000Z";
    const durable = state.path("state", "durable-run-marker.txt");
    await writeFile(durable, "run remains independent\n", "utf8");
    const before = await readFile(durable, "utf8");
    const service = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([
        githubResult(successAt),
        githubResult(failedAt, { unavailable: true }),
      ]),
      clock: () => J15_NOW,
      watchFiles: false,
    });
    services.push(service);
    await service.start();
    expect(service.snapshot().delivery[0]?.observed_at).toBe(successAt);

    await service.refreshGithubNow();
    const failed = service.snapshot();
    expect(failed.delivery[0]?.observed_at).toBe(successAt);
    expect(failed.sources.find((source) => source.id === "github")).toMatchObject({
      status: "unavailable",
      observed_at: failedAt,
      last_success_at: successAt,
      detail: "seeded GitHub outage",
    });

    await service.stop();
    services.splice(services.indexOf(service), 1);
    expect(await readFile(durable, "utf8")).toBe(before);

    const restarted = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([githubResult(failedAt)]),
      clock: () => J15_NOW,
      watchFiles: false,
    });
    services.push(restarted);
    await restarted.start();
    expect(await readFile(durable, "utf8")).toBe(before);
  });

  it("a cursor older than the bounded replay emits resync instead of fabricated continuity", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-i-sse" });
    states.push(state);
    const service = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([githubResult(J15_NOW.toISOString())]),
      clock: () => J15_NOW,
      watchFiles: false,
      replayLimit: 1,
    });
    services.push(service);
    await service.start();
    for (const id of ["one", "two"]) {
      await writeFile(state.path("state", "events", "inbox", `${id}.json`), `${JSON.stringify({
        id,
        app: J15_APPS.apps[0]!.name,
        kind: "health-alert",
        occurred_at: `2026-07-31T12:0${id === "one" ? "1" : "2"}:00.000Z`,
      })}\n`, "utf8");
      await service.reconcileNow();
    }
    expect(service.snapshot().cursor).toBe("2");

    const response = new CaptureResponse();
    const unsubscribe = service.subscribe(response as unknown as ServerResponse, "0");
    assertResync(response.text());
    expect(response.text()).not.toContain("event: entity.upsert");
    unsubscribe();
  });

  it("negative control: the resync detector fires on a seeded silent gap", () => {
    expect(() => assertResync("id: 3\nevent: entity.upsert\n\n")).toThrow(/missing required SSE resync/);
  });
});
