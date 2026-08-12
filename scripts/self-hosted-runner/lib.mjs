import { randomUUID } from "node:crypto";

export const RUNNER_CONFIG = Object.freeze({
  repository: "cormidia/Cormidia",
  repositoryUrl: "https://github.com/cormidia/Cormidia",
  label: "cormidia-core-linux-arm64",
  namePrefix: "cormidia-core-",
  image: "cormidia-actions-runner:2.336.0",
  runnerVersion: "2.336.0",
  runnerSha256: "58b758e420b87093fbd4bfddd368074960053e2f1388f01848c82624b90f27d1",
  baseImage: "ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea",
  cpus: 12,
  memory: "24g",
  pidsLimit: 2048,
});

function runnerName() {
  return `${RUNNER_CONFIG.namePrefix}${randomUUID().slice(0, 12)}`;
}

export function dockerRunSpec(registrationToken) {
  if (typeof registrationToken !== "string" || registrationToken.length === 0) {
    throw new TypeError("registration token must be a non-empty string");
  }

  const name = runnerName();
  return {
    args: [
      "run",
      "--rm",
      `--name=${name}`,
      "--hostname=cormidia-actions-runner",
      "--label=com.cormidia.github-actions-runner=true",
      `--cpus=${RUNNER_CONFIG.cpus}`,
      `--memory=${RUNNER_CONFIG.memory}`,
      `--pids-limit=${RUNNER_CONFIG.pidsLimit}`,
      "--cap-drop=ALL",
      "--cap-add=NET_ADMIN",
      "--cap-add=SETGID",
      "--cap-add=SETPCAP",
      "--cap-add=SETUID",
      "--security-opt=no-new-privileges",
      "--env=RUNNER_URL",
      "--env=RUNNER_TOKEN",
      "--env=RUNNER_NAME",
      "--env=RUNNER_LABEL",
      RUNNER_CONFIG.image,
    ],
    env: {
      RUNNER_URL: RUNNER_CONFIG.repositoryUrl,
      RUNNER_TOKEN: registrationToken,
      RUNNER_NAME: name,
      RUNNER_LABEL: RUNNER_CONFIG.label,
    },
  };
}

function labelNames(row) {
  if (!Array.isArray(row?.labels)) return [];
  return row.labels.flatMap((label) => (typeof label?.name === "string" ? [label.name] : []));
}

export function managedOfflineRunnerIds(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const managed =
      Number.isInteger(row?.id) &&
      typeof row?.name === "string" &&
      row.name.startsWith(RUNNER_CONFIG.namePrefix) &&
      row.status === "offline" &&
      row.busy === false &&
      labelNames(row).includes(RUNNER_CONFIG.label);
    return managed ? [row.id] : [];
  });
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderLaunchAgent({ nodePath, cliPath, workingDirectory, stdoutPath, stderrPath }) {
  const values = [nodePath, cliPath, workingDirectory, stdoutPath, stderrPath];
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("launch agent paths must be non-empty strings");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cormidia.github-actions-runner</string>
  <key>ProgramArguments</key><array>
    <string>${xml(nodePath)}</string>
    <string>${xml(cliPath)}</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(workingDirectory)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrPath)}</string>
</dict></plist>
`;
}

export function auditRunnerAppliance({ dockerfile, entrypoint, runSpec }) {
  const violations = [];
  const args = Array.isArray(runSpec?.args) ? runSpec.args : [];
  const env = runSpec?.env ?? {};

  if (!dockerfile.includes(RUNNER_CONFIG.baseImage)) violations.push("runner base image is not digest-pinned");
  if (!dockerfile.includes(`ARG RUNNER_VERSION=${RUNNER_CONFIG.runnerVersion}`)) {
    violations.push("official runner version pin is missing");
  }
  if (!dockerfile.includes(`ARG RUNNER_SHA256=${RUNNER_CONFIG.runnerSha256}`)) {
    violations.push("official runner checksum pin is missing");
  }
  if (args.at(-1) !== RUNNER_CONFIG.image) violations.push("runner image drifted from the exact local pin");
  if (env.RUNNER_LABEL !== RUNNER_CONFIG.label) violations.push("runner label drifted from repository routing label");
  if (!args.includes("--rm") || !entrypoint.includes("--ephemeral")) {
    violations.push("runner is not ephemeral and one-job disposable");
  }
  if (args.includes("--privileged")) violations.push("privileged runner containers are forbidden");
  if (args.some((arg) => arg === "-v" || arg.startsWith("--volume"))) violations.push("host mounts are forbidden");
  if (args.some((arg) => arg.includes("docker.sock"))) violations.push("Docker socket exposure is forbidden");
  for (const required of [
    "--cap-drop=ALL",
    "--cap-add=NET_ADMIN",
    "--cap-add=SETGID",
    "--cap-add=SETPCAP",
    "--cap-add=SETUID",
    "--security-opt=no-new-privileges",
    `--pids-limit=${RUNNER_CONFIG.pidsLimit}`,
    `--cpus=${RUNNER_CONFIG.cpus}`,
    `--memory=${RUNNER_CONFIG.memory}`,
  ]) {
    if (!args.includes(required)) violations.push(`runner isolation flag missing: ${required}`);
  }
  if (!entrypoint.includes("169.254.0.0/16")) violations.push("link-local/cloud-metadata network refusal is missing");
  if (!entrypoint.includes("/etc/resolv.conf") || !entrypoint.includes("--dport 53")) {
    violations.push("Docker DNS exception is not narrowed to resolver port 53");
  }
  for (const cidr of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) {
    if (!entrypoint.includes(cidr)) violations.push(`private-LAN network refusal is missing: ${cidr}`);
  }
  if (!entrypoint.includes("--bounding-set=-all")) violations.push("job capabilities are not dropped before execution");
  if (!entrypoint.includes("env -u RUNNER_TOKEN")) violations.push("registration token remains in the job environment");
  if (env.GH_TOKEN !== undefined) violations.push("administrator GitHub credential entered the runner container");
  return violations;
}
