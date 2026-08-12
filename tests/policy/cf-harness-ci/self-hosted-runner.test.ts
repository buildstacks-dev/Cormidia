// CF-HARNESS-CI — HB-P7 manifest owner; HB-152 runner-hosting slice —
// validation-policy.yaml `ci` runner-hosting contract.
//
// The self-hosted runner appliance is a one-job, repository-scoped execution
// boundary. These tests pin its immutable inputs, isolation flags, outbound-only
// registration, cleanup scope, and launchd supervision. Every structural pin has
// a seeded negative control so the detector proves it can turn red.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  RUNNER_CONFIG,
  auditRunnerAppliance,
  dockerRunSpec,
  managedOfflineRunnerIds,
  renderLaunchAgent,
} from "../../../scripts/self-hosted-runner/lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const runnerRoot = join(repoRoot, "scripts", "self-hosted-runner");
const probeWorkflowPath = join(repoRoot, ".github", "workflows", "self-hosted-runner-probe.yml");

async function applianceSources(): Promise<{ dockerfile: string; entrypoint: string }> {
  return {
    dockerfile: await readFile(join(runnerRoot, "Dockerfile"), "utf8"),
    entrypoint: await readFile(join(runnerRoot, "entrypoint.sh"), "utf8"),
  };
}

function probeViolations(source: string): string[] {
  const document = parse(source) as Record<string, unknown>;
  const jobs = document.jobs as Record<string, Record<string, unknown>> | undefined;
  const probe = jobs?.probe;
  const steps = Array.isArray(probe?.steps) ? (probe.steps as Record<string, unknown>[]) : [];
  const checkout = steps.find((step) => step.uses === "actions/checkout@v5");
  const withValues = checkout?.with as Record<string, unknown> | undefined;
  const violations: string[] = [];
  if (probe?.["runs-on"] !== RUNNER_CONFIG.label) violations.push("probe routing label drifted");
  if (probe?.["timeout-minutes"] !== 5) violations.push("probe timeout drifted");
  if (withValues?.["persist-credentials"] !== false) violations.push("checkout credentials persist into job code");
  if (!steps.some((step) => step.run === "bash scripts/self-hosted-runner/probe.sh")) {
    violations.push("runner boundary probe command is missing");
  }
  return violations;
}

describe("CF-HARNESS-CI — HB-152 self-hosted runner appliance", () => {
  it("pins the official ARM64 runner bytes and the immutable Ubuntu base", async () => {
    const sources = await applianceSources();
    expect(sources.dockerfile).toContain(`ARG RUNNER_VERSION=${RUNNER_CONFIG.runnerVersion}`);
    expect(sources.dockerfile).toContain(`ARG RUNNER_SHA256=${RUNNER_CONFIG.runnerSha256}`);
    expect(sources.dockerfile).toContain(RUNNER_CONFIG.baseImage);
    expect(auditRunnerAppliance({ ...sources, runSpec: dockerRunSpec("fixture-token") })).toEqual([]);
  });

  it("starts a disposable, resource-bounded container without host mounts or a Docker socket", () => {
    const spec = dockerRunSpec("fixture-token");
    expect(spec.args).toContain("--rm");
    expect(spec.args).toContain("--cap-drop=ALL");
    expect(spec.args).toContain("--cap-add=NET_ADMIN");
    expect(spec.args).toContain("--cap-add=SETGID");
    expect(spec.args).toContain("--cap-add=SETPCAP");
    expect(spec.args).toContain("--cap-add=SETUID");
    expect(spec.args).toContain("--security-opt=no-new-privileges");
    expect(spec.args).toContain("--pids-limit=2048");
    expect(spec.args).toContain("--cpus=12");
    expect(spec.args).toContain("--memory=24g");
    expect(spec.args.some((arg) => arg === "--privileged" || arg.startsWith("--volume") || arg === "-v")).toBe(false);
    expect(spec.env.RUNNER_TOKEN).toBe("fixture-token");
    expect(spec.env.GH_TOKEN).toBeUndefined();
  });

  it("registers one ephemeral custom-label runner and drops every capability before job code", async () => {
    const sources = await applianceSources();
    expect(sources.entrypoint).toContain("--ephemeral");
    expect(sources.entrypoint).toContain("--disableupdate");
    expect(sources.entrypoint).toContain("--no-default-labels");
    expect(sources.entrypoint).toContain('--labels "${RUNNER_LABEL}"');
    expect(sources.entrypoint).toContain("--bounding-set=-all");
    expect(sources.entrypoint).toContain("env -u RUNNER_TOKEN");
  });

  it("blocks host, private-LAN, link-local, and cloud-metadata destinations before dropping NET_ADMIN", async () => {
    const { entrypoint } = await applianceSources();
    expect(entrypoint).toContain("/etc/resolv.conf");
    expect(entrypoint).toContain("--dport 53");
    for (const cidr of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]) {
      expect(entrypoint).toContain(cidr);
    }
    expect(entrypoint.indexOf("install_network_guard")).toBeLessThan(entrypoint.indexOf("setpriv"));
  });

  it("deletes only offline runners carrying both the managed name prefix and exact label", () => {
    const rows = [
      { id: 1, name: "cormidia-core-a", status: "offline", busy: false, labels: [{ name: RUNNER_CONFIG.label }] },
      { id: 2, name: "cormidia-core-b", status: "online", busy: false, labels: [{ name: RUNNER_CONFIG.label }] },
      { id: 3, name: "foreign", status: "offline", busy: false, labels: [{ name: RUNNER_CONFIG.label }] },
      { id: 4, name: "cormidia-core-c", status: "offline", busy: false, labels: [{ name: "foreign" }] },
    ];
    expect(managedOfflineRunnerIds(rows)).toEqual([1]);
  });

  it("renders one keep-alive launch agent with explicit working and log paths", () => {
    const plist = renderLaunchAgent({
      nodePath: "/opt/node&26/bin/node",
      cliPath: "/repo<runner>/cli.mjs",
      workingDirectory: "/repo<runner>",
      stdoutPath: "/state/logs/out.log",
      stderrPath: "/state/logs/error.log",
    });
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("/opt/node&amp;26/bin/node");
    expect(plist).toContain("/repo&lt;runner&gt;");
  });

  it("routes the independent proof job to the exact runner label without persistent checkout credentials", async () => {
    const source = await readFile(probeWorkflowPath, "utf8");
    expect(probeViolations(source)).toEqual([]);
  });
});

describe("CF-HARNESS-CI — HB-152 seeded runner-appliance violations", () => {
  it("fires when a host mount, privileged mode, or Docker socket enters the job boundary", async () => {
    const sources = await applianceSources();
    const seeded = dockerRunSpec("fixture-token");
    seeded.args.splice(-1, 0, "--privileged", "--volume=/var/run/docker.sock:/var/run/docker.sock");
    const violations = auditRunnerAppliance({ ...sources, runSpec: seeded });
    expect(violations).toContainEqual(expect.stringContaining("privileged"));
    expect(violations).toContainEqual(expect.stringContaining("host mount"));
    expect(violations).toContainEqual(expect.stringContaining("Docker socket"));
  });

  it("fires when ephemeral registration, the network guard, or capability drop disappears", async () => {
    const sources = await applianceSources();
    const seededEntrypoint = sources.entrypoint
      .replace("--ephemeral", "")
      .replaceAll("--dport 53", "--dport 443")
      .replace("169.254.0.0/16", "198.18.0.0/15")
      .replace("--bounding-set=-all", "--bounding-set=+net_admin");
    const violations = auditRunnerAppliance({
      dockerfile: sources.dockerfile,
      entrypoint: seededEntrypoint,
      runSpec: dockerRunSpec("fixture-token"),
    });
    expect(violations).toContainEqual(expect.stringContaining("ephemeral"));
    expect(violations).toContainEqual(expect.stringContaining("link-local"));
    expect(violations).toContainEqual(expect.stringContaining("DNS"));
    expect(violations).toContainEqual(expect.stringContaining("capabilities"));
  });

  it("fires when bootstrap cannot drop root or its bounding set because SETUID, SETGID, or SETPCAP is absent", async () => {
    const sources = await applianceSources();
    const seeded = dockerRunSpec("fixture-token");
    seeded.args = seeded.args.filter(
      (arg) => !["--cap-add=SETUID", "--cap-add=SETGID", "--cap-add=SETPCAP"].includes(arg),
    );
    const violations = auditRunnerAppliance({ ...sources, runSpec: seeded });
    expect(violations).toContainEqual(expect.stringContaining("SETUID"));
    expect(violations).toContainEqual(expect.stringContaining("SETGID"));
    expect(violations).toContainEqual(expect.stringContaining("SETPCAP"));
  });

  it("fires when the image or repository-routing label drifts", async () => {
    const sources = await applianceSources();
    const seeded = dockerRunSpec("fixture-token");
    seeded.args[seeded.args.length - 1] = "untrusted/latest";
    seeded.env.RUNNER_LABEL = "self-hosted";
    const violations = auditRunnerAppliance({ ...sources, runSpec: seeded });
    expect(violations).toContainEqual(expect.stringContaining("image"));
    expect(violations).toContainEqual(expect.stringContaining("label"));
  });

  it("fires when the probe routes elsewhere or checkout credentials persist", async () => {
    const source = await readFile(probeWorkflowPath, "utf8");
    const seeded = source
      .replace("runs-on: cormidia-core-linux-arm64", "runs-on: ubuntu-latest")
      .replace("persist-credentials: false", "persist-credentials: true");
    const violations = probeViolations(seeded);
    expect(violations).toContain("probe routing label drifted");
    expect(violations).toContain("checkout credentials persist into job code");
  });
});
