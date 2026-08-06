import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  DEFAULT_SCHEDULER_PATH,
  SCHEDULER_REQUIRED_EXECUTABLES_ENV,
  requiredExecutablesManifest,
  schedulerEnvironmentPath,
} from "./environment.js";
import {
  DEFAULT_SCHEDULER_CADENCE_MINUTES,
  SCHEDULER_SCHEMA_VERSION,
  assertCadence,
  canonicalJson,
  schedulerIdentity,
  schedulerOrgId,
  sha256,
  type SchedulerBackend,
  type SchedulerCommand,
  type SchedulerDefinitionMetadata,
  type SchedulerExpectation,
} from "./model.js";
import { definedProps } from "../../runtime/optional-properties.js";

const MARKER = "cormidia-scheduler-metadata-v1:";

export interface SchedulerDefinitionInput {
  backend: SchedulerBackend;
  orgName: string;
  orgHome: string;
  stateHome: string;
  packageEntryPath: string;
  executablePath?: string;
  cadenceMinutes?: number;
  tsxImportPath?: string;
  environmentPath?: string;
  requiredExecutables?: Record<string, string>;
}

type ParsedSchedulerDefinition =
  | { kind: "owned"; metadata: SchedulerDefinitionMetadata; definitionHash: string }
  | { kind: "foreign"; reason: "ownership_mismatch" }
  | { kind: "malformed"; reason: "malformed_definition"; detail: string };

export function buildSchedulerExpectation(input: SchedulerDefinitionInput): SchedulerExpectation {
  const orgHome = resolve(input.orgHome);
  const stateHome = resolve(input.stateHome);
  const packageEntryPath = resolve(input.packageEntryPath);
  const executablePath = resolve(input.executablePath ?? process.execPath);
  const cadenceMinutes = input.cadenceMinutes ?? DEFAULT_SCHEDULER_CADENCE_MINUTES;
  const requiredExecutables = normalizeRequiredExecutables(input.requiredExecutables ?? {});
  const environmentPath = schedulerEnvironmentPath(
    requiredExecutables,
    input.environmentPath ?? DEFAULT_SCHEDULER_PATH,
  );
  assertCadence(cadenceMinutes);
  const schedulerId = schedulerIdentity(input.orgName, orgHome);
  const command = schedulerCommand({
    executablePath,
    packageEntryPath,
    orgHome,
    stateHome,
    ...definedProps({ tsxImportPath: input.tsxImportPath }),
    environmentPath,
    requiredExecutables,
  });
  const metadata: SchedulerDefinitionMetadata = {
    schema_version: SCHEDULER_SCHEMA_VERSION,
    owner: "cormidia",
    scheduler_id: schedulerId,
    org_id: schedulerOrgId(input.orgName, orgHome),
    org_name: input.orgName,
    backend: input.backend,
    cadence_minutes: cadenceMinutes,
    executable_path: executablePath,
    package_entry_path: packageEntryPath,
    org_home: orgHome,
    state_home: stateHome,
    command_sha256: sha256(canonicalJson(command)),
    environment_path: environmentPath,
    required_executables: requiredExecutables,
  };
  const definition = input.backend === "launchd" ? renderLaunchd(metadata, command) : renderSystemd(metadata, command);
  return { metadata, command, definition, definitionHash: sha256(definition) };
}

export function parseSchedulerDefinition(text: string): ParsedSchedulerDefinition {
  const line = text.split("\n").find((value) => value.includes(MARKER));
  if (line === undefined) return { kind: "foreign", reason: "ownership_mismatch" };
  const encoded = line
    .slice(line.indexOf(MARKER) + MARKER.length)
    .replace(/\s*(?:-->|$)/, "")
    .trim();
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!validMetadata(value)) throw new Error("metadata schema mismatch");
    const legacy = value as SchedulerDefinitionMetadata & {
      environment_path?: string;
      required_executables?: Record<string, string>;
    };
    return {
      kind: "owned",
      metadata: {
        ...legacy,
        environment_path: legacy.environment_path ?? DEFAULT_SCHEDULER_PATH,
        required_executables: legacy.required_executables ?? {},
      },
      definitionHash: sha256(text),
    };
  } catch (error) {
    return {
      kind: "malformed",
      reason: "malformed_definition",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function schedulerCommand(input: {
  executablePath: string;
  packageEntryPath: string;
  orgHome: string;
  stateHome: string;
  tsxImportPath?: string;
  environmentPath: string;
  requiredExecutables: Record<string, string>;
}): SchedulerCommand {
  const tsx = input.packageEntryPath.endsWith(".ts")
    ? (input.tsxImportPath ?? createRequire(import.meta.url).resolve("tsx"))
    : undefined;
  return {
    executablePath: input.executablePath,
    packageEntryPath: input.packageEntryPath,
    args: [
      ...(tsx !== undefined ? ["--import", resolve(tsx)] : []),
      input.packageEntryPath,
      "dispatch",
      "--org-home",
      input.orgHome,
      "--state-home",
      input.stateHome,
    ],
    environment: { PATH: input.environmentPath },
    requiredExecutables: { ...input.requiredExecutables },
  };
}

function renderLaunchd(metadata: SchedulerDefinitionMetadata, command: SchedulerCommand): string {
  const args = [command.executablePath, ...command.args]
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MARKER}${encodeMetadata(metadata)} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(metadata.scheduler_id)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(command.environment.PATH)}</string>
    <key>${SCHEDULER_REQUIRED_EXECUTABLES_ENV}</key>
    <string>${escapeXml(requiredExecutablesManifest(command.requiredExecutables))}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${metadata.cadence_minutes * 60}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(`${metadata.state_home}/scheduler/logs/stdout.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(`${metadata.state_home}/scheduler/logs/stderr.log`)}</string>
</dict>
</plist>
`;
}

function renderSystemd(metadata: SchedulerDefinitionMetadata, command: SchedulerCommand): string {
  const escaped = [command.executablePath, ...command.args].map(systemdQuote).join(" ");
  return `# ${MARKER}${encodeMetadata(metadata)}
[Unit]
Description=Cormidia org-scoped dispatch (${metadata.org_name})

[Service]
Type=oneshot
Environment=${systemdQuote(`PATH=${command.environment.PATH}`)}
Environment=${systemdQuote(`${SCHEDULER_REQUIRED_EXECUTABLES_ENV}=${requiredExecutablesManifest(command.requiredExecutables)}`)}
ExecStart=${escaped}
WorkingDirectory=${systemdQuote(metadata.org_home)}

[Timer]
OnBootSec=1min
OnUnitActiveSec=${metadata.cadence_minutes}min
Persistent=false
Unit=${metadata.scheduler_id}.service

[Install]
WantedBy=timers.target
`;
}

function encodeMetadata(metadata: SchedulerDefinitionMetadata): string {
  return Buffer.from(canonicalJson(metadata), "utf8").toString("base64url");
}

function validMetadata(value: unknown): value is SchedulerDefinitionMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.schema_version === SCHEDULER_SCHEMA_VERSION &&
    row.owner === "cormidia" &&
    typeof row.scheduler_id === "string" &&
    typeof row.org_id === "string" &&
    typeof row.org_name === "string" &&
    (row.backend === "launchd" || row.backend === "systemd") &&
    Number.isInteger(row.cadence_minutes) &&
    typeof row.executable_path === "string" &&
    typeof row.package_entry_path === "string" &&
    typeof row.org_home === "string" &&
    typeof row.state_home === "string" &&
    typeof row.command_sha256 === "string" &&
    (row.environment_path === undefined || typeof row.environment_path === "string") &&
    (row.required_executables === undefined ||
      (row.required_executables !== null &&
        typeof row.required_executables === "object" &&
        !Array.isArray(row.required_executables)))
  );
}

function normalizeRequiredExecutables(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, path]) => {
        if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new TypeError(`invalid required executable name: ${name}`);
        return [name, resolve(path)];
      }),
  );
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function systemdQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
