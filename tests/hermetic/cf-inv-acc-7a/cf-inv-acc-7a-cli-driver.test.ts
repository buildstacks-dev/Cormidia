// CF-INV-ACC-7a / CF-INV-ACC-7b (L2) — the campaign reaches the product only
// through the packaged binaries, and records every call.
//
// Real spawned processes throughout. The two refusals are the ones that decide
// whether a campaign measured the product or the working tree, so both are
// seeded rather than reasoned about.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliDriverError, createCliDriver } from "../../campaign/acceptance/cli-driver.js";
import { makeCormidiaBinaryDouble } from "../../fixtures/acceptance/cormidia-binary-double.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function refusal(run: () => Promise<unknown>): Promise<CliDriverError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliDriverError) return error;
    throw error;
  }
  throw new Error("expected a CliDriverError, but the driver was built");
}

/** A checkout root only needs to be a realpath-able directory. Creating a temp
 *  GIT REPO for it costs several git invocations per test, and on a two-core CI
 *  runner that self-contention is what manufactures timeout flakes in unrelated
 *  suites (docs/DEVELOPMENT.md -> Shipping discipline). */
async function checkoutRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cormidia-checkout-"));
  cleanups.push(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

describe("CF-INV-ACC-7b the driver refuses anything but the packaged binaries", () => {
  it("builds against binaries that resolve outside the checkout", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "context", stdout: "{}\n" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();

    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });
    expect(driver.binaryPath("cormidia")).toBe(double.cormidiaPath);
  });

  it("negative control: a binary resolving INSIDE the checkout is refused — that is link:local", async () => {
    const checkout = await checkoutRoot();
    const insideBin = join(checkout, "node_modules", ".bin");
    await mkdir(insideBin, { recursive: true });
    const sourceBacked = join(insideBin, "cormidia");
    await writeFile(sourceBacked, "#!/usr/bin/env node\n", { mode: 0o755 });

    const error = await refusal(async () =>
      createCliDriver({
        cormidiaPath: sourceBacked,
        cormidiaJobPath: sourceBacked,
        checkoutRoot: checkout,
      }),
    );
    expect(error.code).toBe("binary-inside-checkout");
    expect(error.message).toContain("source-backed");
  });

  it("negative control: an unresolvable binary is refused at construction, not at the first turn", async () => {
    const checkout = await checkoutRoot();
    const error = await refusal(async () =>
      createCliDriver({
        cormidiaPath: join(checkout, "..", "nowhere", "cormidia"),
        cormidiaJobPath: join(checkout, "..", "nowhere", "cormidia-job"),
        checkoutRoot: checkout,
      }),
    );
    expect(error.code).toBe("binary-unresolved");
  });

  it("negative control: an argv that would run source-backed code is refused", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "loop" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });
    await expect(driver.run("cormidia", ["tsx", "src/cli.ts", "loop"])).rejects.toThrow(/source-backed/);
    expect(driver.recorded()).toEqual([]);
  });
});

describe("CF-INV-ACC-7a every invocation is recorded", () => {
  it("pins campaign org selection and refuses commands that could mutate the operator pointer", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "context", stdout: "{}\n" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    await expect(
      createCliDriver({
        cormidiaPath: double.cormidiaPath,
        cormidiaJobPath: double.cormidiaJobPath,
        checkoutRoot: checkout,
        activeOrg: { orgHome: "relative/org", stateHome: "/campaign/state" },
      }),
    ).rejects.toMatchObject({ code: "org-selection-not-isolated" });
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
      env: { CORMIDIA_ORG_HOME: "/ambient/org", CORMIDIA_STATE_HOME: "/ambient/state" },
      activeOrg: { orgHome: "/campaign/org", stateHome: "/campaign/state" },
    });

    await driver.run("cormidia", ["context", "--json"]);
    expect((await double.invocations())[0]).toMatchObject({
      orgHome: "/campaign/org",
      stateHome: "/campaign/state",
    });
    await expect(driver.run("cormidia", ["org", "use", "/another/org"])).rejects.toMatchObject({
      code: "active-pointer-mutation",
    });
    expect(driver.recorded()).toHaveLength(1);
  });

  it("records argv, exit status and output for each call, in order", async () => {
    const double = await makeCormidiaBinaryDouble([
      { whenArgvIncludes: "plan", stdout: '{"tickets":3}\n' },
      { whenArgvIncludes: "loop", stdout: "loop done\n" },
    ]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });

    await driver.run("cormidia", ["plan", "acc-1", "--auto", "--goal", "x"], { scenarioId: "S-ACC-1" });
    await driver.run("cormidia", ["loop", "--app", "acc-1", "--once"], { scenarioId: "S-ACC-1" });

    const recorded = driver.recorded();
    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.argv).toEqual(["plan", "acc-1", "--auto", "--goal", "x"]);
    expect(recorded[0]?.stdout).toContain('"tickets":3');
    expect(recorded[0]?.scenarioId).toBe("S-ACC-1");
    expect(recorded[1]?.argv).toContain("--once");

    // The double's own log is an independent record: what the campaign says it
    // ran must equal what a process actually received.
    const actual = await double.invocations();
    expect(actual.map((entry) => entry.argv)).toEqual(recorded.map((invocation) => invocation.argv));
  });

  it("returns a non-zero exit rather than throwing — a refusal is often the measurement", async () => {
    const double = await makeCormidiaBinaryDouble([
      { whenArgvIncludes: "approvals", exitCode: 3, stderr: "approval pending\n" },
    ]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });

    const invocation = await driver.run("cormidia", ["approvals", "review"]);
    expect(invocation.exitCode).toBe(3);
    expect(invocation.stderr).toContain("approval pending");
    expect(driver.recorded()).toHaveLength(1);
  });

  it("runOrThrow stops the campaign on a step whose failure makes continuing dishonest", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "new-app", exitCode: 1, stderr: "boom\n" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });

    await expect(driver.runOrThrow("cormidia", ["new-app", "acc-1"])).rejects.toThrow(/exited 1/);
    // Still recorded: a failed provisioning step is evidence, not a gap.
    expect(driver.recorded()).toHaveLength(1);
  });

  it("drives cormidia-job through the second binary, not the first", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "run", stdout: "job ok\n" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });

    await driver.run("cormidia-job", ["run", "job.yaml", "--workdir", "/tmp/w"], { scenarioId: "S-ACC-3" });
    const actual = await double.invocations();
    expect(actual[0]?.binary).toBe("cormidia-job");
  });

  it("hands back copies — a caller cannot rewrite the campaign's own record", async () => {
    const double = await makeCormidiaBinaryDouble([{ whenArgvIncludes: "context", stdout: "{}\n" }]);
    cleanups.push(double.cleanup);
    const checkout = await checkoutRoot();
    const driver = await createCliDriver({
      cormidiaPath: double.cormidiaPath,
      cormidiaJobPath: double.cormidiaJobPath,
      checkoutRoot: checkout,
    });
    await driver.run("cormidia", ["context", "--json"]);
    const first = driver.recorded();
    first[0]!.argv.push("--tampered");
    expect(driver.recorded()[0]?.argv).toEqual(["context", "--json"]);
  });
});
