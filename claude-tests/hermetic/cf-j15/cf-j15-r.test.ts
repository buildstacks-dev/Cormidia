// CF-J15-R / CF-B12 refusal surface — real ephemeral loopback server.

import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ObserveService } from "../../../src/observe/live-source.js";
import { startObserveServer, type StartedObserveServer } from "../../../src/observe/server.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { J15_APP, J15_APPS, J15_NOW, githubResult, scriptedGithubSource } from "./support.js";

function assertRefused(response: Response): void {
  if (response.status < 400) throw new Error(`read-only boundary accepted request with HTTP ${response.status}`);
}

describe("CF-J15-R — observer capability, read-only, traversal, and symlink refusal", () => {
  const states: TempStateHome[] = [];
  const services: ObserveService[] = [];
  const servers: StartedObserveServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0).reverse()) await server.close();
    for (const service of services.splice(0).reverse()) await service.stop();
    for (const state of states.splice(0).reverse()) await state.cleanup();
  });

  it("binds loopback and refuses absent/wrong capabilities and every mutation method/route", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-r-capability" });
    states.push(state);
    const service = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([githubResult(J15_NOW.toISOString())]),
      clock: () => J15_NOW,
      watchFiles: false,
    });
    services.push(service);
    await service.start();
    const server = await startObserveServer({ service, stateHome: state.stateHome, port: 0 });
    servers.push(server);

    expect(server.host).toBe("127.0.0.1");
    assertRefused(await fetch(`http://${server.host}:${server.port}/api/v1/snapshot`));
    expect((await fetch(`http://${server.host}:${server.port}/api/v1/snapshot`, {
      headers: { Authorization: "Bearer wrong-token" },
    })).status).toBe(401);

    const authorized = { Authorization: `Bearer ${server.token}` };
    const snapshot = await fetch(`http://${server.host}:${server.port}/api/v1/snapshot`, { headers: authorized });
    expect(snapshot.status).toBe(200);
    expect((await snapshot.json() as { org: { read_only: boolean } }).org.read_only).toBe(true);

    const mutation = await fetch(`http://${server.host}:${server.port}/api/v1/approvals/appr-j15`, {
      method: "POST",
      headers: authorized,
    });
    expect(mutation.status).toBe(405);
    expect(await mutation.json()).toMatchObject({ error: "method_not_allowed", read_only: true });
    expect((await fetch(`http://${server.host}:${server.port}/api/v1/approvals/appr-j15`, {
      headers: authorized,
    })).status).toBe(404);
  });

  it("serves only allowlisted in-home files and refuses encoded traversal and every symlink component", async () => {
    const state = await makeTempStateHome({ name: "cf-j15-r-paths" });
    states.push(state);
    const runDir = state.path("runs", J15_APP, "run-15");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "output.md"), "in-home output\n", "utf8");
    const outside = state.path("outside-secret.txt");
    await writeFile(outside, "must not cross\n", "utf8");
    await mkdir(state.path("runs", J15_APP, "run-link"), { recursive: true });
    await symlink(outside, state.path("runs", J15_APP, "run-link", "output.md"));

    const service = new ObserveService({
      orgName: J15_APPS.org.name,
      stateHome: state.stateHome,
      appsFile: J15_APPS,
      githubSource: scriptedGithubSource([githubResult(J15_NOW.toISOString())]),
      clock: () => J15_NOW,
      watchFiles: false,
    });
    services.push(service);
    await service.start();
    const server = await startObserveServer({ service, stateHome: state.stateHome, port: 0 });
    servers.push(server);
    const headers = { Authorization: `Bearer ${server.token}` };
    const root = `http://${server.host}:${server.port}`;

    const allowed = await fetch(`${root}/api/v1/artifacts/${J15_APP}/run-15/output`, { headers });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("in-home output\n");

    for (const path of [
      `/api/v1/artifacts/%2e%2e/run-15/output`,
      `/api/v1/artifacts/${J15_APP}/%2e%2e/output`,
      `/api/v1/artifacts/${J15_APP}/run-15/not-allowlisted`,
    ]) assertRefused(await fetch(`${root}${path}`, { headers }));

    const escaped = await fetch(`${root}/api/v1/artifacts/${J15_APP}/run-link/output`, { headers });
    expect(escaped.status).toBe(403);
    expect(await escaped.json()).toEqual({ error: "symlink_escape" });
  });

  it("negative control: the refusal detector fires on a seeded 2xx mutation response", () => {
    expect(() => assertRefused(new Response("mutated", { status: 200 }))).toThrow(/accepted request/);
  });
});
