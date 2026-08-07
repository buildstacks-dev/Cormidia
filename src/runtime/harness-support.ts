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

import { readBinaryVersion, readPackageVersion, type HarnessVersionDetection } from "./harness-version-detect.js";
import { definedProps } from "./optional-properties.js";
import type { RuntimeKind } from "./types.js";

/**
 * Where the installed harness version is read from. Vendored npm packages read
 * their manifest; installer-shipped products (#224) are the operator's own
 * binary and are asked directly. `assessHarnessVersion()` and its consumers do
 * not change either way — only the source does.
 */
type HarnessVersionSource =
  | {
      readonly kind: "vendored_npm_package";
      readonly packageName: string;
    }
  | {
      /**
       * A required preinstalled binary (#224). Cormidia never installs it, so
       * absence is a detection failure, not a floor violation.
       */
      readonly kind: "installed_binary";
      readonly command: string;
      readonly args: readonly string[];
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

// Each adapter now points at its own dated refresh record; the shared
// 2026-08-06 upstream-reference constant retired with codex's last use of it.
const CLAUDE_TESTED_EVIDENCE = "research/2026-08-07_claude-sdk-0.3.224-refresh.md";

/**
 * Exhaustive by construction: a new `RuntimeKind` is a compile error until its
 * bands are declared. That is deliberate — an undeclared harness has no floor,
 * and a harness with no floor has no refusal.
 *
 * A floor is an interface claim, not a copy of the pin: it moves only when an
 * adapter genuinely stops speaking the older surface. After the #335 refresh
 * wave every floor sits BELOW its `testedWith` — claude 0.3.201 → 0.3.224,
 * codex 0.144.4 → 0.147.0, pi 0.80.7 → 0.84.1. Each bump moved the certified
 * version without breaking the interface the adapter speaks, and raising a
 * floor to match its pin would refuse operators who have not upgraded, which
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
    // Unchanged by the 0.147.0 refresh: the floor is an interface claim, not a
    // copy of the pin, and raising it would refuse operators still on 0.144.4
    // for no proven incompatibility (#224 owes the real per-adapter floor).
    floor: "0.144.4",
    testedWith: "0.147.0",
    testedEvidence: "research/2026-08-07_codex-0.147-refresh.md",
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
  cursor: {
    // cursor-agent versions calendar-style (`2026.08.04-aaa8809`), which is not
    // strict semver. `normalizeCalendarVersion` drops the build sha and the
    // zero-padding so the SAME banding machinery applies — the sha is build
    // metadata, exactly the `+build` component semver §10 says to ignore.
    // Floor equals testedWith because this harness has been certified against
    // exactly one build and its gate claim is version-banded: the hook-firing
    // behaviour the adapter depends on was observed, not documented, so
    // refusing an unproven older build is the honest default rather than a
    // guess about which older interface still fires hooks.
    floor: "2026.8.4",
    testedWith: "2026.8.4",
    testedEvidence: "research/2026-08-07_cursor-adapter-certification.md",
    versionSource: { kind: "installed_binary", command: "cursor-agent", args: ["--version"] },
  },
  grok: {
    // Grok Build ships via an installer, never npm, so the binary is the
    // operator's own and absence is a detection failure rather than a floor
    // violation. Floor equals testedWith for the same reason it does for
    // cursor: the adapter's gate rests on a version-banded *observed*
    // behaviour, not a documented interface. Grok's hook runner fails OPEN, so
    // the whole fail-closed posture depends on `PreToolUse` firing ahead of
    // every other authorization check — that ordering was proven against
    // exactly this build (F-PT-027). Refusing an unproven older build is the
    // honest default; guessing which older version still fires hooks first
    // would silently downgrade the gate to no gate at all.
    floor: "1.0.0",
    testedWith: "1.0.0",
    testedEvidence: "research/2026-08-07_grok-build-adapter-certification.md",
    versionSource: { kind: "installed_binary", command: "grok", args: ["--version"] },
  },
};

export type { HarnessVersionDetection };

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
  const source = HARNESS_SUPPORT[runtime].versionSource;
  return source.kind === "vendored_npm_package"
    ? readPackageVersion(source.packageName)
    : readBinaryVersion(source.command, source.args);
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
