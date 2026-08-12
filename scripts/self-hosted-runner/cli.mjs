#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dockerRunSpec, managedOfflineRunnerIds, renderLaunchAgent, RUNNER_CONFIG } from "./lib.mjs";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const stateRoot = join(homedir(), "Library", "Application Support", "Cormidia", "ci-runner");
const installRoot = join(stateRoot, "app");
const logRoot = join(stateRoot, "logs");
const serviceLabel = "com.cormidia.github-actions-runner";
const servicePath = join(homedir(), "Library", "LaunchAgents", `${serviceLabel}.plist`);

function run(command, args, { env = process.env, capture = false, allowFailure = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const executable =
      command === "gh"
        ? (process.env.CORMIDIA_GH_PATH ?? command)
        : command === "docker"
          ? (process.env.CORMIDIA_DOCKER_PATH ?? command)
          : command;
    const child = spawn(executable, args, {
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? -1, stdout, stderr };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`${command} ${args[0] ?? ""} failed (${result.code})${stderr ? `: ${stderr.trim()}` : ""}`));
      } else {
        resolveResult(result);
      }
    });
  });
}

async function resolveExecutable(command) {
  const result = await run("/usr/bin/which", [command], { capture: true });
  const executable = result.stdout.trim();
  if (!executable.startsWith("/")) throw new Error(`could not resolve absolute ${command} executable`);
  return executable;
}

async function ghJson(path, { method = "GET" } = {}) {
  const args = ["api"];
  if (method !== "GET") args.push("--method", method);
  args.push(path);
  const result = await run("gh", args, { capture: true });
  return JSON.parse(result.stdout);
}

async function repositoryRunners() {
  const value = await ghJson(`repos/${RUNNER_CONFIG.repository}/actions/runners?per_page=100`);
  return Array.isArray(value.runners) ? value.runners : [];
}

async function cleanupManagedOfflineRunners() {
  const rows = await repositoryRunners();
  const ids = managedOfflineRunnerIds(rows);
  for (const id of ids) {
    await ghJson(`repos/${RUNNER_CONFIG.repository}/actions/runners/${id}`, { method: "DELETE" });
  }
  return ids;
}

function onlineManagedRunners(rows) {
  return rows.filter(
    (row) =>
      typeof row?.name === "string" &&
      row.name.startsWith(RUNNER_CONFIG.namePrefix) &&
      row.status === "online" &&
      Array.isArray(row.labels) &&
      row.labels.some((label) => label?.name === RUNNER_CONFIG.label),
  );
}

async function registrationToken() {
  const value = await ghJson(`repos/${RUNNER_CONFIG.repository}/actions/runners/registration-token`, {
    method: "POST",
  });
  if (typeof value.token !== "string" || value.token.length === 0) {
    throw new Error("GitHub returned no self-hosted runner registration token");
  }
  return value.token;
}

async function build() {
  await run("docker", ["build", "--platform=linux/arm64", "--tag", RUNNER_CONFIG.image, sourceRoot]);
}

async function runOne() {
  await cleanupManagedOfflineRunners();
  const online = onlineManagedRunners(await repositoryRunners());
  if (online.length > 0) {
    throw new Error(`refusing a duplicate runner while ${online.map((row) => row.name).join(", ")} is online`);
  }
  const token = await registrationToken();
  const spec = dockerRunSpec(token);
  await run("docker", spec.args, { env: { ...process.env, ...spec.env } });
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function serve() {
  let failures = 0;
  for (;;) {
    try {
      await runOne();
      failures = 0;
    } catch (cause) {
      failures += 1;
      const delaySeconds = Math.min(30, 2 ** Math.min(failures, 4));
      console.error(`${new Date().toISOString()} runner cycle failed: ${String(cause)}`);
      console.error(`${new Date().toISOString()} retrying in ${delaySeconds}s`);
      await sleep(delaySeconds * 1_000);
    }
  }
}

async function dockerInfo() {
  const result = await run("docker", ["info", "--format", "{{json .}}"], { capture: true });
  return JSON.parse(result.stdout);
}

async function dockerContainers() {
  const result = await run(
    "docker",
    ["ps", "--filter", "label=com.cormidia.github-actions-runner=true", "--format", "{{json .}}"],
    { capture: true },
  );
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function imagePresent() {
  const result = await run("docker", ["image", "inspect", RUNNER_CONFIG.image], { capture: true, allowFailure: true });
  return result.code === 0;
}

async function status() {
  const [runners, containers, present] = await Promise.all([repositoryRunners(), dockerContainers(), imagePresent()]);
  const managed = runners.filter(
    (row) => typeof row?.name === "string" && row.name.startsWith(RUNNER_CONFIG.namePrefix),
  );
  console.log(
    JSON.stringify(
      {
        repository: RUNNER_CONFIG.repository,
        label: RUNNER_CONFIG.label,
        image: { name: RUNNER_CONFIG.image, present },
        githubRunners: managed.map((row) => ({ name: row.name, status: row.status, busy: row.busy })),
        containers: containers.map((row) => ({ id: row.ID, name: row.Names, status: row.Status })),
      },
      null,
      2,
    ),
  );
}

async function doctor() {
  const [info, repository, permissions, workflowPermissions, present] = await Promise.all([
    dockerInfo(),
    ghJson(`repos/${RUNNER_CONFIG.repository}`),
    ghJson(`repos/${RUNNER_CONFIG.repository}/actions/permissions`),
    ghJson(`repos/${RUNNER_CONFIG.repository}/actions/permissions/workflow`),
    imagePresent(),
  ]);
  const checks = {
    repositoryPrivate: repository.private === true,
    actionsEnabled: permissions.enabled === true,
    workflowTokenReadOnly: workflowPermissions.default_workflow_permissions === "read",
    dockerArchitectureArm64: info.Architecture === "aarch64" || info.Architecture === "arm64",
    dockerCpuAtLeast12: Number(info.NCPU) >= RUNNER_CONFIG.cpus,
    dockerMemoryAtLeast28GiB: Number(info.MemTotal) >= 28 * 1024 ** 3,
    runnerImagePresent: present,
  };
  console.log(
    JSON.stringify(
      { checks, docker: { architecture: info.Architecture, cpus: info.NCPU, bytes: info.MemTotal } },
      null,
      2,
    ),
  );
  if (Object.values(checks).some((value) => value !== true)) process.exitCode = 1;
}

async function installService() {
  if (process.platform !== "darwin") throw new Error("launchd service installation is supported only on macOS");

  const stagingRoot = `${installRoot}.staging`;
  const previousRoot = `${installRoot}.previous`;
  await mkdir(stateRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });
  await mkdir(dirname(servicePath), { recursive: true });
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  for (const name of ["Dockerfile", "entrypoint.sh", "lib.mjs", "lib.d.mts", "cli.mjs"]) {
    await cp(join(sourceRoot, name), join(stagingRoot, name));
  }
  await rm(previousRoot, { recursive: true, force: true });
  try {
    await rename(installRoot, previousRoot);
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  try {
    await rename(stagingRoot, installRoot);
  } catch (cause) {
    await rename(previousRoot, installRoot).catch(() => undefined);
    throw cause;
  }
  await rm(previousRoot, { recursive: true, force: true });

  const [githubCliPath, dockerCliPath] = await Promise.all([resolveExecutable("gh"), resolveExecutable("docker")]);
  const plist = renderLaunchAgent({
    nodePath: process.execPath,
    githubCliPath,
    dockerCliPath,
    cliPath: join(installRoot, "cli.mjs"),
    workingDirectory: installRoot,
    stdoutPath: join(logRoot, "supervisor.log"),
    stderrPath: join(logRoot, "supervisor-error.log"),
  });
  await writeFile(servicePath, plist, { mode: 0o600 });

  const domain = `gui/${process.getuid()}`;
  await run("launchctl", ["bootout", domain, servicePath], { allowFailure: true, capture: true });
  await run("launchctl", ["bootstrap", domain, servicePath]);
  await run("launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]);
  console.log(`installed and started ${serviceLabel}`);
}

function usage() {
  console.log(`Cormidia self-hosted Core Checks runner

Usage:
  pnpm ci:runner -- <build|doctor|once|serve|status|service-install>

Commands:
  build            Build the pinned Linux ARM64 runner image
  doctor           Verify repository, Docker, permissions, and image prerequisites
  once             Register one ephemeral runner and wait for one job
  serve            Replenish one ephemeral runner after every completed job
  status           Report the managed GitHub runners and local containers
  service-install  Install an isolated copy and start the macOS launch agent
`);
}

const cliArgs = process.argv.slice(2);
const command = cliArgs[0] === "--" ? cliArgs[1] : cliArgs[0];
try {
  if (command === "build") await build();
  else if (command === "doctor") await doctor();
  else if (command === "once") await runOne();
  else if (command === "serve") await serve();
  else if (command === "status") await status();
  else if (command === "service-install") await installService();
  else {
    usage();
    if (command !== undefined && command !== "help" && command !== "--help") process.exitCode = 2;
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}
