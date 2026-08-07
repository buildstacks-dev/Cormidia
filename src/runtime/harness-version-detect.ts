// Where an installed harness version is actually READ from, split out of
// harness-support.ts (#338) so the declarations + banding logic and the
// per-source detection can each stay inside the new-module size budget.
//
// Two sources exist today. Vendored npm packages read their own manifest;
// installer-shipped products (#224) are the operator's own binary and are asked
// directly. Both are token-free — no model turn, no provider request.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toErrorMessage as errorMessage } from "./error-message.js";

export type HarnessVersionDetection =
  | { readonly detected: true; readonly version: string }
  | { readonly detected: false; readonly reason: string };

const requireFromHere = createRequire(import.meta.url);
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/**
 * `YYYY.MM.DD-<sha>` → `YYYY.M.D`. Calendar versions (cursor-agent) order
 * exactly like semver once the zero padding is gone, and the trailing build sha
 * carries no ordering — it is the `+build` component semver §10 says to ignore,
 * under a different spelling. Anything already strict semver, or matching
 * neither shape, is returned untouched so banding can call it `unknown` rather
 * than guess.
 */
export function normalizeCalendarVersion(raw: string): string {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-[0-9A-Za-z.-]+)?$/.exec(raw.trim());
  if (match === null) return raw.trim();
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

const VERSION_TOKEN = /^v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * `grok 1.0.0 (3cd0d0cbcebe) [stable]` → `1.0.0`. Not every harness prints a
 * bare version: some decorate the line with their own name, a build sha and a
 * release channel (grok, muse), and some print a banner before it (opencode,
 * whose readiness probe reads the LAST line for that reason). Lines are scanned
 * in order and only a token that is ALREADY a version shape is accepted, so a
 * sha, a channel word or a banner word can never be mistaken for the version.
 * Output with no such token anywhere is returned as its first line — banding
 * then says `unknown`, which is the honest answer rather than a guess (#339).
 */
function extractVersionToken(lines: readonly string[]): string {
  for (const line of lines) {
    const token = line.split(/\s+/).find((candidate) => VERSION_TOKEN.test(candidate));
    if (token !== undefined) return token.startsWith("v") ? token.slice(1) : token;
  }
  return lines[0] ?? "";
}

/**
 * Ask the operator's own binary. A missing binary is a detection FAILURE
 * (`unknown` band), never `below_floor` — Cormidia does not install providers
 * (#224), so "not present" is a readiness fact, not a version verdict.
 */
export function readBinaryVersion(
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): HarnessVersionDetection {
  let stdout: string;
  try {
    stdout = execFileSync(command, [...args], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      // Detection is read-only by contract: a harness that self-updates on
      // invocation is pinned quiet here rather than upgraded behind the
      // operator's back (#224).
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
  } catch (error) {
    return { detected: false, reason: `${command} ${args.join(" ")} failed: ${errorMessage(error)}` };
  }
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return { detected: false, reason: `${command} ${args.join(" ")} printed no version` };
  return { detected: true, version: normalizeCalendarVersion(extractVersionToken(lines)) };
}

export function readPackageVersion(packageName: string): HarnessVersionDetection {
  for (const manifestPath of candidateManifestPaths(packageName)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed["name"] !== packageName) continue;
    const version = parsed["version"];
    if (typeof version !== "string" || version.trim() === "") {
      return { detected: false, reason: `${packageName} manifest declares no version: ${manifestPath}` };
    }
    return { detected: true, version: version.trim() };
  }
  return { detected: false, reason: `${packageName} is not installed where ${MODULE_DIRECTORY} can resolve it` };
}

function candidateManifestPaths(packageName: string): string[] {
  const candidates: string[] = [];
  try {
    // Canonical when the package exports "./package.json" (Codex does).
    candidates.push(requireFromHere.resolve(`${packageName}/package.json`));
  } catch {
    // The others hide it behind an exports map; the node_modules walk finds it.
  }
  const segments = packageName.split("/");
  let directory = MODULE_DIRECTORY;
  for (;;) {
    candidates.push(join(directory, "node_modules", ...segments, "package.json"));
    const parent = dirname(directory);
    if (parent === directory) return candidates;
    directory = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
