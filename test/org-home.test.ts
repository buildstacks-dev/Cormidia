// Explicit packaging boundary: package source, committed org home, runtime
// state, and app repos are separate locations.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initOrgHome,
  ORG_HOME_DEFINITION,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
} from "../src/org/home.js";
import { cmdOrg } from "../src/cli/org.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe("org home lifecycle", () => {
  it("atomically creates a complete org, separate state home, and active pointer", async () => {
    const parent = temp("operon-org-parent-");
    const fakeHome = temp("operon-user-home-");
    const orgHome = join(parent, "my-org");

    const result = await initOrgHome({ target: orgHome, name: "my-org", homeDir: fakeHome });

    expect(result.orgHome).toBe(orgHome);
    expect(result.stateHome).toBe(join(fakeHome, ".operon", "my-org"));
    for (const rel of ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml", "prompts"]) {
      expect(existsSync(join(orgHome, rel))).toBe(true);
    }
    expect(result.appsFile.apps).toEqual([]);
    expect(await readFile(join(fakeHome, ".operon", "config"), "utf8")).toContain(`org_home: ${orgHome}`);

    const resolved = await resolveOperonHomes({ homeDir: fakeHome });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(result.stateHome);
  });

  it("persists an explicitly selected state home across later commands", async () => {
    const parent = temp("operon-custom-state-");
    const fakeHome = temp("operon-custom-home-");
    const orgHome = join(parent, "org");
    const stateHome = join(parent, "state");
    await initOrgHome({ target: orgHome, name: "custom", stateHome, homeDir: fakeHome });

    const resolved = await resolveOperonHomes({ homeDir: fakeHome });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(stateHome);
    expect(await readFile(join(fakeHome, ".operon", "config"), "utf8")).toContain(
      `state_home: ${stateHome}`,
    );
  });

  it("keeps org and state overrides semantically independent", async () => {
    const parent = temp("operon-org-overrides-");
    const fakeHome = temp("operon-user-overrides-");
    const orgHome = join(parent, "org-config");
    const stateHome = join(parent, "runtime-state");
    await initOrgHome({ target: orgHome, name: "separate", homeDir: fakeHome });

    const resolved = await resolveOperonHomes({
      env: { OPERON_ORG_HOME: orgHome, OPERON_STATE_HOME: stateHome },
      homeDir: fakeHome,
    });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(stateHome);
  });

  it("prints one-line meanings during org initialization", async () => {
    const parent = temp("operon-org-cli-");
    const fakeHome = temp("operon-user-cli-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cmdOrg(["init", join(parent, "team"), "--name", "team"], { homeDir: fakeHome });
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain(ORG_HOME_DEFINITION);
    expect(output).toContain(STATE_HOME_DEFINITION);
    expect(output).toContain("operon doctor");
  });

  it("refuses to replace an existing target", async () => {
    const target = temp("operon-existing-org-");
    await expect(initOrgHome({ target, name: "existing" })).rejects.toThrow(/target already exists/);
  });
});
