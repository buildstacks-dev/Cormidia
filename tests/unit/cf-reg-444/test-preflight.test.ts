// CF-REG-444 · HB-139 · validation-design/case-catalog.md §10.3; B-07
// process lifecycle and the disposable offline-install fixture contract.

import { describe, expect, it, vi } from "vitest";
import {
  checkProcessStartIdentity,
  formatPreflightResult,
  runTestCommand,
  runTestPreflight,
  type LiveChild,
  type TestPreflightResult,
} from "../../../scripts/test-preflight.js";
import { checkOfflinePackageStore, type InstallInvocation } from "../../../scripts/test-preflight-store.js";

function liveChild(pid: number): LiveChild {
  return { pid, alive: () => true, cleanup: async () => undefined };
}

const repoRoot = process.cwd();

describe("CF-REG-444 — bounded offline test preflight", () => {
  it("probes the current process and a live child through the process identity seam", async () => {
    const readIdentity = vi.fn((pid: number) => `start:${pid}`);
    const result = await checkProcessStartIdentity({
      readIdentity,
      spawnLiveChild: async () => liveChild(4242),
    });

    expect(result.status).toBe("available");
    expect(readIdentity).toHaveBeenCalledWith(process.pid);
    expect(readIdentity).toHaveBeenCalledWith(4242);
  });

  it("negative control: unavailable process identity fires one typed prerequisite failure", async () => {
    const result = await checkProcessStartIdentity({
      readIdentity: () => undefined,
      spawnLiveChild: async () => liveChild(4242),
    });

    expect(result).toMatchObject({ id: "process-start-identity", status: "unavailable" });
    expect(result.evidence).toContain("current pid");
    expect(result.remediation).toContain("process-start identity");
  });

  it("runs the exact non-mutating canary contract in a disposable directory", async () => {
    let invocation: InstallInvocation | undefined;
    const result = await checkOfflinePackageStore(repoRoot, "/tmp/cormidia-test-store", {
      install: async (candidate) => {
        invocation = candidate;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.status).toBe("available");
    expect(invocation?.args).toEqual([
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--verify-store-integrity",
    ]);
    expect(invocation?.cwd).not.toBe(repoRoot);
  });

  it("negative control: an incomplete offline store fires before Vitest and stays bounded", async () => {
    const result = await runTestPreflight({
      repoRoot,
      processProbe: {
        readIdentity: (pid) => `start:${pid}`,
        spawnLiveChild: async () => liveChild(4242),
      },
      packageStoreProbe: {
        install: async () => ({ exitCode: 1, stdout: "", stderr: "ERR_PNPM_NO_OFFLINE_TARBALL" }),
      },
    });
    let started = false;
    const exitCode = await runTestCommand({
      repoRoot,
      vitestBin: "vitest",
      vitestArgs: ["run"],
      preflight: async () => result,
      runVitest: async () => {
        started = true;
        return 0;
      },
    });

    expect(result.completeness).toBe("incomplete");
    expect(exitCode).toBe(1);
    expect(started).toBe(false);
    expect(formatPreflightResult(result)).toContain("Vitest was not started");
    expect(formatPreflightResult(result)).toContain("offline-package-store");
  });

  it("reports multiple missing prerequisites together without becoming a pass or skip", async () => {
    const result = await runTestPreflight({
      repoRoot,
      processProbe: {
        readIdentity: () => undefined,
        spawnLiveChild: async () => liveChild(4242),
      },
      packageStoreProbe: {
        install: async () => ({ exitCode: 1, stdout: "", stderr: "store incomplete" }),
      },
    });
    const formatted = formatPreflightResult(result);

    expect(result.completeness).toBe("incomplete");
    expect(formatted).toContain("process-start-identity");
    expect(formatted).toContain("offline-package-store");
    expect(formatted).not.toContain("skipped");
    expect(formatted).not.toContain("passed");
  });

  it("positive control reaches the unchanged Vitest command after a complete preflight", async () => {
    const complete: TestPreflightResult = {
      schema: "cormidia-test-preflight/1",
      completeness: "complete",
      checks: [],
    };
    const runVitest = vi.fn(async () => 0);
    const exitCode = await runTestCommand({
      repoRoot,
      vitestBin: "/repo/node_modules/.bin/vitest",
      vitestArgs: ["run", "--reporter=json"],
      preflight: async () => complete,
      runVitest,
    });

    expect(exitCode).toBe(0);
    expect(runVitest).toHaveBeenCalledWith("/repo/node_modules/.bin/vitest", ["run", "--reporter=json"]);
  });
});
