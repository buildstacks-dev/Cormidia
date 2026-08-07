// Harness version bands — floor / tested-with / newer-than-tested (#331).
//
// A `package.json` pin is an *installation* pin. Under the installed-harness
// contract (#224) the harness is the operator's own install, so the pin has to
// mean a **compatibility declaration** instead: this is the version
// certification last ran against, and the operator may legitimately be running
// something older or newer. Making the tested version a hard minimum would
// break operators who have not upgraded.
//
// This module is the one machine-readable place those bands live — readiness
// refusal, `cormidia doctor`, and upstream-freshness automation all read it.
// Detection is token-free: no model turn, no provider request.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { definedProps } from "./optional-properties.js";
import type { RuntimeKind } from "./types.js";

/**
 * Where the installed harness version is read from. Today every harness ships
 * as a vendored npm package, so one member suffices. #224 turns harnesses into
 * user-installed products; adding an installed-binary member here replaces the
 * *source* — `assessHarnessVersion()` and its consumers do not change.
 */
type HarnessVersionSource = {
  readonly kind: "vendored_npm_package";
  readonly packageName: string;
};

export interface HarnessSupportDeclaration {
  /**
   * Oldest version whose external interface this adapter actually speaks.
   * Below it the adapter genuinely cannot function, so readiness refuses.
   */
  readonly floor: string;
  /** Exact version certification last ran against. */
  readonly testedWith: string;
  /** Dated `research/` record backing `testedWith`. */
  readonly testedEvidence: string;
  readonly versionSource: HarnessVersionSource;
}

const TESTED_EVIDENCE = "research/2026-08-06_adapter-upstream-references.md";
const CLAUDE_TESTED_EVIDENCE = "research/2026-08-07_claude-sdk-0.3.224-refresh.md";

/**
 * Exhaustive by construction: a new `RuntimeKind` is a compile error until its
 * bands are declared. That is deliberate — an undeclared harness has no floor,
 * and a harness with no floor has no refusal.
 *
 * Codex and pi floors still equal their `testedWith` because those harnesses
 * remain vendored at exactly those versions: no install below the pin exists
 * yet, so a conservative floor refuses nobody. Claude's floor now sits BELOW
 * its `testedWith` — the 0.3.201 → 0.3.224 bump (#335) moved the certified
 * version without changing the interface the adapter speaks, and raising the
 * floor to match the pin would refuse operators who have not upgraded, which
 * is exactly what bands exist to avoid (docs/harness/adding-updating.md §6).
 * Lowering a floor further, to the oldest interface an adapter genuinely
 * speaks, is per-adapter research owed with #224, not a guess to be made here.
 */
export const HARNESS_SUPPORT: Record<RuntimeKind, HarnessSupportDeclaration> = {
  claude: {
    floor: "0.3.201",
    testedWith: "0.3.224",
    testedEvidence: CLAUDE_TESTED_EVIDENCE,
    versionSource: { kind: "vendored_npm_package", packageName: "@anthropic-ai/claude-agent-sdk" },
  },
  codex: {
    floor: "0.144.4",
    testedWith: "0.144.4",
    testedEvidence: TESTED_EVIDENCE,
    versionSource: { kind: "vendored_npm_package", packageName: "@openai/codex" },
  },
  pi: {
    // Floor stays at 0.80.7 deliberately (#224 owes the real interface claim):
    // raising it to match the pin would refuse operators who have not upgraded,
    // which is exactly what bands exist to avoid.
    floor: "0.80.7",
    testedWith: "0.84.1",
    testedEvidence: "research/2026-08-07_pi-0.84.1-refresh.md",
    versionSource: { kind: "vendored_npm_package", packageName: "@earendil-works/pi-coding-agent" },
  },
};

export type HarnessVersionDetection =
  | { readonly detected: true; readonly version: string }
  | { readonly detected: false; readonly reason: string };

/** Injection seam: tests and future version sources supply their own. */
export type HarnessVersionDetector = (runtime: RuntimeKind) => HarnessVersionDetection;

export type HarnessVersionBand = "below_floor" | "older_than_tested" | "at_tested" | "newer_than_tested" | "unknown";

export interface HarnessVersionAssessment {
  readonly runtime: RuntimeKind;
  readonly band: HarnessVersionBand;
  readonly floor: string;
  readonly testedWith: string;
  readonly testedEvidence: string;
  /** Installed version; absent when detection failed or the value was malformed. */
  readonly version?: string;
  /** One line naming every band. `cormidia doctor` renders it verbatim. */
  readonly detail: string;
}

/** Token-free installed-version detection. Never sends a provider request. */
export function detectHarnessVersion(runtime: RuntimeKind): HarnessVersionDetection {
  return readPackageVersion(HARNESS_SUPPORT[runtime].versionSource.packageName);
}

/**
 * Place the installed harness in its band. `below_floor` is the only refusing
 * band; drift in either direction is a note, never a block. `unknown` is an
 * honest verdict — an undetectable or malformed version is never reported as
 * a version we have tested.
 */
export function assessHarnessVersion(
  runtime: RuntimeKind,
  detect: HarnessVersionDetector = detectHarnessVersion,
): HarnessVersionAssessment {
  const declaration = HARNESS_SUPPORT[runtime];
  const bands = `floor ${declaration.floor}, tested-with ${declaration.testedWith} (${declaration.testedEvidence})`;
  const undetermined = (reason: string): HarnessVersionAssessment =>
    assessment(runtime, declaration, "unknown", undefined, `installed version undetermined — ${bands}: ${reason}`);

  const detection = detect(runtime);
  if (!detection.detected) return undetermined(detection.reason);
  const band = bandForVersion(declaration, detection.version);
  if (band === "unknown") {
    return undetermined(`reported version "${detection.version}" is not a strict semantic version`);
  }
  return assessment(
    runtime,
    declaration,
    band,
    detection.version,
    `version ${detection.version} ${BAND_PHRASE[band]} — ${bands}`,
  );
}

/**
 * Pure banding: where `version` sits against one declaration. Malformed input
 * is `unknown`, never a pass — a version we cannot read is not a version we
 * have tested. Throws only when the *declaration itself* is not strict semver,
 * which is an authoring error, not a runtime condition.
 */
export function bandForVersion(declaration: HarnessSupportDeclaration, version: string): HarnessVersionBand {
  const floor = parseSemanticVersion(declaration.floor);
  const tested = parseSemanticVersion(declaration.testedWith);
  if (floor === undefined || tested === undefined) {
    throw new Error(
      "harness support declaration is not a strict semantic version: " +
        `floor=${declaration.floor} testedWith=${declaration.testedWith}`,
    );
  }
  const installed = parseSemanticVersion(version);
  if (installed === undefined) return "unknown";
  if (compareSemanticVersions(installed, floor) < 0) return "below_floor";
  const againstTested = compareSemanticVersions(installed, tested);
  if (againstTested < 0) return "older_than_tested";
  return againstTested === 0 ? "at_tested" : "newer_than_tested";
}

const BAND_PHRASE: Record<HarnessVersionBand, string> = {
  below_floor: "is below the supported floor",
  older_than_tested: "is older than tested but at or above the floor",
  at_tested: "matches tested-with",
  newer_than_tested: "is newer than tested; drift is allowed and unproven",
  unknown: "could not be placed in a band",
};

function assessment(
  runtime: RuntimeKind,
  declaration: HarnessSupportDeclaration,
  band: HarnessVersionBand,
  version: string | undefined,
  detail: string,
): HarnessVersionAssessment {
  return {
    runtime,
    band,
    floor: declaration.floor,
    testedWith: declaration.testedWith,
    testedEvidence: declaration.testedEvidence,
    detail,
    ...definedProps({ version }),
  };
}

const requireFromHere = createRequire(import.meta.url);
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(packageName: string): HarnessVersionDetection {
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

interface SemanticVersion {
  readonly release: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

// Deliberately strict and dependency-free (TASTE.md §3): no `v` prefix, no
// leading zeros, no missing patch. Build metadata is ignored per semver §10.
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/;

function parseSemanticVersion(raw: string): SemanticVersion | undefined {
  const match = SEMANTIC_VERSION.exec(raw);
  if (match === null) return undefined;
  const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => Number(part));
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  // An empty identifier, or a numeric one with a leading zero, is not semver.
  if (prerelease.some((part) => part === "" || (/^\d+$/.test(part) && !NUMERIC_IDENTIFIER.test(part))))
    return undefined;
  return { release: [major, minor, patch], prerelease };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.release[index] ?? 0) - (right.release[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

// Semver §11: a prerelease has lower precedence than the release it precedes.
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = NUMERIC_IDENTIFIER.test(leftPart);
    const rightNumeric = NUMERIC_IDENTIFIER.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
