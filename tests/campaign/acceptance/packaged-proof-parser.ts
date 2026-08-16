import type { PackagedInstallProof } from "./packaged-provenance.js";

const INSTALL_PROOF_SCHEMA = "cormidia-install-packaged-proof/1";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface TerminalInstallProof {
  mode: "install" | "dry-run";
  argv: string[];
  installedVersion: string;
  tarball: { name: string; sha256: string };
}

export function parseTerminalInstallProof(value: unknown): TerminalInstallProof {
  const root = object(value, "install proof");
  exact(root, ["schema", "mode", "argv", "installed_version", "tarball", "replaced_source_links"], "install proof");
  if (root["schema"] !== INSTALL_PROOF_SCHEMA) throw new Error("install proof schema is invalid");
  const mode = oneOf(root["mode"], ["install", "dry-run"], "install proof mode");
  const argv = stringArray(root["argv"], "install proof argv");
  const installedVersion = semver(root["installed_version"]);
  const tarball = parseTarball(root["tarball"]);
  boolean(root["replaced_source_links"], "install proof replaced_source_links");
  return { mode, argv, installedVersion, tarball };
}

export function parseStoredInstallProof(value: unknown): PackagedInstallProof {
  const root = object(value, "stored install proof");
  closed(
    root,
    ["exitCode", "argv", "mode", "installedVersion", "tarball", "ranAt"],
    ["stderr"],
    "stored install proof",
  );
  const exitCode = integer(root["exitCode"], "stored install proof exitCode");
  const argv = stringArray(root["argv"], "stored install proof argv");
  const mode = oneOf(root["mode"], ["install", "dry-run"], "stored install proof mode");
  const installedVersion = semver(root["installedVersion"]);
  const tarball = parseTarball(root["tarball"]);
  const ranAt = new Date(instant(root["ranAt"], "stored install proof ranAt"));
  const stderr = root["stderr"] === undefined ? undefined : string(root["stderr"], "stored install proof stderr");
  return { exitCode, argv, mode, installedVersion, tarball, ranAt, ...(stderr === undefined ? {} : { stderr }) };
}

function parseTarball(value: unknown): { name: string; sha256: string } {
  const row = object(value, "install proof tarball");
  exact(row, ["name", "sha256"], "install proof tarball");
  const name = nonEmpty(row["name"], "install proof tarball name");
  const sha256 = string(row["sha256"], "install proof tarball sha256");
  if (!SHA256.test(sha256)) throw new Error("install proof tarball sha256 must be lowercase sha256");
  return { name, sha256 };
}

function semver(value: unknown): string {
  const parsed = string(value, "installed version");
  if (!SEMVER.test(parsed)) throw new Error("installed version must be semver");
  return parsed;
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}
function nonEmpty(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (parsed.trim() === "") throw new Error(`${name} must not be blank`);
  return parsed;
}
function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${name} must be a string array`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${name} must be a finite integer`);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}
function instant(value: unknown, name: string): string {
  const parsed = string(value, name);
  if (Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed)
    throw new Error(`${name} is invalid`);
  return parsed;
}
function oneOf<const T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string") throw new Error(`${name} is invalid`);
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) throw new Error(`${name} is invalid`);
  return matched;
}
function exact(value: Record<string, unknown>, required: string[], name: string): void {
  closed(value, required, [], name);
}
function closed(value: Record<string, unknown>, required: string[], optional: string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0)
    throw new Error(`${name} has missing or unknown fields: ${[...missing, ...unknown].sort().join(", ")}`);
}
