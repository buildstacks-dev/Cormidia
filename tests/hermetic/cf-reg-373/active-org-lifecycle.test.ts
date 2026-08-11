// Traceability: CF-REG-373 · HB-139 · case-catalog.md §10.3.

// CF-REG-373 (L2) — stale active-org pointers retain lifecycle identity at
// every CLI boundary. Real temp org homes and pointer bytes; zero network.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdContext } from "../../../src/cli/context-info.js";
import { cmdDoctorArgs } from "../../../src/cli/doctor.js";
import { runJsonCliCommand } from "../../../src/cli/json-failure.js";
import { cmdOrg } from "../../../src/cli/org.js";
import { resolveCormidiaHomes, type CormidiaHomeOptions } from "../../../src/org/home.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(name: string): Promise<TempOrgHome> {
  const value = await makeTempOrgHome({ name });
  cleanups.push(value.cleanup);
  return value;
}

async function emptySelection(): Promise<CormidiaHomeOptions> {
  const homeDir = await mkdtemp(join(tmpdir(), "cf-reg-373-empty-"));
  cleanups.push(() => rm(homeDir, { recursive: true, force: true }));
  return { env: {}, homeDir, pointerPath: join(homeDir, ".cormidia", "config") };
}

async function failureDocument(command: string, run: () => Promise<number>): Promise<Record<string, unknown>> {
  const out: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...parts: unknown[]) => out.push(parts.map(String).join(" ")));
  try {
    expect(await runJsonCliCommand(command, run)).toBe(1);
  } finally {
    log.mockRestore();
  }
  expect(out).toHaveLength(1);
  return JSON.parse(out[0]!) as Record<string, unknown>;
}

async function crossCommandErrors(options: CormidiaHomeOptions): Promise<Array<Record<string, unknown>>> {
  const documents: Array<Record<string, unknown>> = [];
  documents.push(await failureDocument("context", () => cmdContext(["--json"], options)));
  documents.push(await failureDocument("org", () => cmdOrg(["show", "--json"], options)));
  documents.push(await failureDocument("doctor", () => cmdDoctorArgs(["--json", "--config-only"], options)));
  return documents;
}

interface LifecycleFailure {
  code: string;
  message: string;
  remediation: string;
}

function errorOf(document: Record<string, unknown>): LifecycleFailure {
  return document.error as LifecycleFailure;
}

describe("CF-REG-373 active-org lifecycle classification", () => {
  it("fresh install: all discovery commands report no_active_org and leave the pointer absent", async () => {
    const options = await emptySelection();
    const errors = (await crossCommandErrors(options)).map(errorOf);
    expect(errors.map((error) => error.code)).toEqual(["no_active_org", "no_active_org", "no_active_org"]);
    expect(errors.every((error) => error.remediation.includes("cormidia org init"))).toBe(true);
    expect(existsSync(options.pointerPath!)).toBe(false);
  });

  it("stale pointer: all discovery commands name the missing path and preserve the pointer bytes", async () => {
    const org = await fixture("stale-org");
    const pointerBefore = await readFile(org.pointerPath, "utf8");
    await rm(org.orgHome, { recursive: true, force: true });
    const errors = (await crossCommandErrors(org.resolveOptions)).map(errorOf);
    expect(errors.map((error) => error.code)).toEqual([
      "active_org_missing",
      "active_org_missing",
      "active_org_missing",
    ]);
    for (const error of errors) {
      expect(error.message).toContain(org.orgHome);
      expect(error.remediation).toContain("cormidia org use");
      expect(error.remediation).toContain("cormidia org init");
      expect(error.code).not.toBe("command_failed");
    }
    expect(await readFile(org.pointerPath, "utf8")).toBe(pointerBefore);
    expect(existsSync(org.orgHome)).toBe(false);
  });

  it("incomplete home: all discovery commands report org_home_incomplete without repairing it", async () => {
    const org = await fixture("incomplete-org");
    const pointerBefore = await readFile(org.pointerPath, "utf8");
    await org.corrupt.removeRequired("TASTE.md");
    const errors = (await crossCommandErrors(org.resolveOptions)).map(errorOf);
    expect(errors.map((error) => error.code)).toEqual([
      "org_home_incomplete",
      "org_home_incomplete",
      "org_home_incomplete",
    ]);
    expect(errors.every((error) => error.message.includes("TASTE.md"))).toBe(true);
    expect(await readFile(org.pointerPath, "utf8")).toBe(pointerBefore);
    expect(existsSync(join(org.orgHome, "TASTE.md"))).toBe(false);
  });

  it("valid pointer remains the positive control across resolver, context, org show, and doctor", async () => {
    const org = await fixture("valid-org");
    const pointerBefore = await readFile(org.pointerPath, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(resolveCormidiaHomes(org.resolveOptions)).resolves.toMatchObject({ orgHome: org.orgHome });
      await expect(cmdContext(["--json"], org.resolveOptions)).resolves.toBe(0);
      await expect(cmdOrg(["show", "--json"], org.resolveOptions)).resolves.toBe(0);
      await expect(cmdDoctorArgs(["--json", "--config-only"], org.resolveOptions)).resolves.toBe(0);
    } finally {
      log.mockRestore();
    }
    expect(await readFile(org.pointerPath, "utf8")).toBe(pointerBefore);
  });
});
