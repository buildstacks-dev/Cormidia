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
import { compareSemanticVersions, parseSemanticVersion } from "./harness-version-math.js";
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
      /**
       * Environment overlaid on the detection call. Detection must not have
       * side effects on the operator's install: muse's launcher self-updates
       * on invocation unless `MUSE_NO_AUTO_UPDATE=1` is set, and a `doctor`
       * run that silently upgrades a provider is exactly what #224 forbids.
       */
      readonly env?: Readonly<Record<string, string>>;
    };

export interface HarnessSupportDeclaration {
  /**
   * Oldest version whose external interface this adapter actually speaks.
   * Below it the adapter genuinely cannot function, so readiness refuses.
   */
  readonly floor: string;
  /** Exact version certification last ran against. */
  readonly testedWith: string;
  /** Dated `research/adapters/` record backing `testedWith`. */
  readonly testedEvidence: string;
  readonly versionSource: HarnessVersionSource;
}

// Each adapter now points at its own dated refresh record; the shared
// 2026-08-06 upstream-reference constant retired with codex's last use of it.
const CLAUDE_TESTED_EVIDENCE = "research/adapters/2026-08-07_claude-sdk-0.3.224-refresh.md";

/**
 * Exhaustive by construction: a new `RuntimeKind` is a compile error until its
 * bands are declared. That is deliberate — an undeclared harness has no floor,
 * and a harness with no floor has no refusal.
 *
 * A floor is an interface claim, not a copy of the pin: it moves only when an
 * adapter genuinely stops speaking the older surface. After the #335 refresh
 * wave every VENDORED floor sits BELOW its `testedWith` — claude 0.3.201 →
 * 0.3.224, codex 0.144.4 → 0.147.0, pi 0.80.7 → 0.84.1. Each bump moved the
 * certified version without breaking the interface the adapter speaks, and
 * raising a floor to match its pin would refuse operators who have not
 * upgraded — exactly what bands exist to avoid (adding-updating.md §6).
 * Lowering one further is per-adapter research owed with #224, not a guess.
 *
 * The installer-shipped harnesses (cursor, grok, muse) invert that: floor
 * EQUALS testedWith. Each one's gate claim rests on behaviour OBSERVED on one
 * build, not documented, so an older build carries no evidence about its gate —
 * and here an unknown gate posture means an ungated turn. Guessing which older
 * version still behaves would silently downgrade the gate.
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
    testedEvidence: "research/adapters/2026-08-07_codex-0.147-refresh.md",
    versionSource: { kind: "vendored_npm_package", packageName: "@openai/codex" },
  },
  pi: {
    // Floor stays at 0.80.7 deliberately (#224 owes the real interface claim):
    // raising it to match the pin would refuse operators who have not upgraded,
    // which is exactly what bands exist to avoid.
    floor: "0.80.7",
    testedWith: "0.84.1",
    testedEvidence: "research/adapters/2026-08-07_pi-0.84.1-refresh.md",
    versionSource: { kind: "vendored_npm_package", packageName: "@earendil-works/pi-coding-agent" },
  },
  cursor: {
    // cursor-agent versions calendar-style (`2026.08.04-aaa8809`), not strict
    // semver. `normalizeCalendarVersion` drops the build sha and zero-padding so
    // the SAME banding machinery applies — the sha is build metadata, exactly
    // the `+build` component semver §10 says to ignore.
    floor: "2026.8.4",
    testedWith: "2026.8.4",
    testedEvidence: "research/adapters/2026-08-07_cursor-adapter-certification.md",
    versionSource: { kind: "installed_binary", command: "cursor-agent", args: ["--version"] },
  },
  grok: {
    // Grok's hook runner fails OPEN, so the whole fail-closed posture rests on
    // `PreToolUse` firing ahead of every other authorization check — an ordering
    // proven against exactly this build (F-PT-027).
    floor: "1.0.0",
    testedWith: "1.0.0",
    testedEvidence: "research/adapters/2026-08-07_grok-build-adapter-certification.md",
    versionSource: { kind: "installed_binary", command: "grok", args: ["--version"] },
  },
  opencode: {
    // The operator's own install (often `~/.opencode/bin/opencode`, so PATH
    // absence is a detection failure, never a floor violation). `--version` may
    // print a banner before the number, which `extractVersionToken` handles by
    // scanning lines for a version-shaped token rather than trusting position.
    // Floor equals testedWith: certification proved the gate PLUGIN wires its
    // hooks on this build, and a plugin whose factory runs is not a plugin
    // whose hooks are wired — an unproven build could serve happily and run
    // every tool ungated.
    floor: "1.18.15",
    testedWith: "1.18.15",
    testedEvidence: "research/adapters/2026-08-07_opencode-adapter-certification.md",
    versionSource: { kind: "installed_binary", command: "opencode", args: ["--version"] },
  },
  muse: {
    // muse's launcher self-updates hourly, so detection pins
    // `MUSE_NO_AUTO_UPDATE=1` — the flag the adapter and readiness also use;
    // reading a version must never upgrade the operator's provider (#224). The
    // certified claim here is a NEGATIVE one: 0.1.0-R708.1 fired no managed
    // hook across twenty configurations, so every turn refuses an unproven seam.
    floor: "0.1.0",
    testedWith: "0.1.0",
    testedEvidence: "research/adapters/2026-08-07_muse-code-adapter-certification.md",
    versionSource: {
      kind: "installed_binary",
      command: "muse",
      args: ["--version"],
      env: { MUSE_NO_AUTO_UPDATE: "1" },
    },
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
    : readBinaryVersion(source.command, source.args, source.env);
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
