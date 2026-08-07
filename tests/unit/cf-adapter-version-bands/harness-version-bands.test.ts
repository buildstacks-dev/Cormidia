// CF-B02/03/04-BANDS (#331) — a harness version pin is a compatibility
// declaration, not an installation pin. Every adapter declares floor /
// tested-with / evidence in one machine-readable place, and every installed
// version lands in exactly one band. `unknown` is an honest verdict: a version
// we cannot read is never reported as a version we have tested.

import { describe, expect, it } from "vitest";
import {
  assessHarnessVersion,
  bandForVersion,
  detectHarnessVersion,
  HARNESS_SUPPORT,
  type HarnessSupportDeclaration,
  type HarnessVersionBand,
  type HarnessVersionDetector,
} from "../../../src/runtime/harness-support.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";

/** A detector that reports exactly what the test says is installed. */
function fixedDetector(version: string): HarnessVersionDetector {
  return () => ({ detected: true, version });
}

function bumpPatch(version: string, by: number): string {
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${Number(patch) + by}`;
}

/**
 * The largest strict-semver version strictly BELOW `version`. Decrementing the
 * patch is not enough: a floor like grok's `1.0.0` becomes `1.0.-1`, which is
 * not semver, so banding answers `unknown` and the below_floor assertion tests
 * nothing while still looking green. Borrow from the lowest non-zero component
 * instead, so every declared floor gets a real below-floor probe.
 */
function belowFloor(version: string): string {
  const parts = version.split(".").map(Number);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const value = parts[index];
    if (value !== undefined && value > 0) {
      parts[index] = value - 1;
      for (let lower = index + 1; lower < parts.length; lower += 1) parts[lower] = 999;
      return parts.join(".");
    }
  }
  throw new Error(`no version exists below ${version}; a 0.0.0 floor cannot be probed`);
}

const SPREAD_DECLARATION: HarnessSupportDeclaration = {
  floor: "1.2.3",
  testedWith: "1.5.0",
  testedEvidence: "research/fixture.md",
  versionSource: { kind: "vendored_npm_package", packageName: "fixture" },
};

describe("CF-B02/03/04-BANDS — declared bands", () => {
  it("declares bands for every registered runtime kind and nothing else", () => {
    expect(Object.keys(HARNESS_SUPPORT).sort()).toEqual([...RUNTIME_KINDS].sort());
  });

  it.each(RUNTIME_KINDS)("%s declares strict semver with floor at or below tested-with", (kind) => {
    const declaration = HARNESS_SUPPORT[kind];
    expect(bandForVersion(declaration, declaration.floor)).not.toBe("unknown");
    // floor > testedWith would make the tested version itself unsupported.
    expect(bandForVersion(declaration, declaration.testedWith)).toBe("at_tested");
    expect(declaration.testedEvidence).toMatch(/^research\/\d{4}-\d{2}-\d{2}[-_].+\.md$/);
  });

  it("refuses a declaration that is not strict semver", () => {
    expect(() => bandForVersion({ ...SPREAD_DECLARATION, floor: "v1.2" }, "1.2.3")).toThrow(
      /not a strict semantic version/,
    );
  });
});

describe("CF-B02/03/04-BANDS — per-adapter banding", () => {
  it.each(RUNTIME_KINDS)("%s: a version below the floor is banded below_floor", (kind) => {
    const declaration = HARNESS_SUPPORT[kind];
    const below = belowFloor(declaration.floor);
    const assessment = assessHarnessVersion(kind, fixedDetector(below));
    expect(assessment.band).toBe("below_floor");
    expect(assessment.version).toBe(below);
    expect(assessment.floor).toBe(declaration.floor);
    expect(assessment.testedWith).toBe(declaration.testedWith);
    expect(assessment.detail).toContain(declaration.testedEvidence);
  });

  it.each(RUNTIME_KINDS)("%s: the tested version is clean and names all three bands", (kind) => {
    const declaration = HARNESS_SUPPORT[kind];
    const assessment = assessHarnessVersion(kind, fixedDetector(declaration.testedWith));
    expect(assessment.band).toBe("at_tested");
    expect(assessment.detail).toContain(`floor ${declaration.floor}`);
    expect(assessment.detail).toContain(`tested-with ${declaration.testedWith}`);
    expect(assessment.detail).toContain(declaration.testedWith);
  });

  it.each(RUNTIME_KINDS)("%s: a newer version drifts but is never refused", (kind) => {
    const declaration = HARNESS_SUPPORT[kind];
    const newer = bumpPatch(declaration.testedWith, 1);
    const assessment = assessHarnessVersion(kind, fixedDetector(newer));
    expect(assessment.band).toBe("newer_than_tested");
    expect(assessment.detail).toMatch(/newer than tested/);
    expect(assessment.detail).toContain(declaration.testedWith);
  });

  it.each(RUNTIME_KINDS)("%s: an undetectable version is unknown, never a pass", (kind) => {
    const assessment = assessHarnessVersion(kind, () => ({ detected: false, reason: "binary not on PATH" }));
    expect(assessment.band).toBe("unknown");
    expect(assessment.version).toBeUndefined();
    expect(assessment.detail).toContain("binary not on PATH");
    expect(assessment.detail).not.toMatch(/matches tested-with/);
  });

  it.each(RUNTIME_KINDS)("%s: a malformed version is unknown, never a pass", (kind) => {
    const assessment = assessHarnessVersion(kind, fixedDetector("nightly-2026-08-06"));
    expect(assessment.band).toBe("unknown");
    expect(assessment.version).toBeUndefined();
    expect(assessment.detail).toMatch(/not a strict semantic version/);
  });

  it("bands a version between the floor and tested-with as older_than_tested", () => {
    // Today every adapter declares floor === testedWith, so the drift-below
    // band has no reachable real version; the seam is still proven here.
    expect(bandForVersion(SPREAD_DECLARATION, "1.4.9")).toBe("older_than_tested");
    expect(bandForVersion(SPREAD_DECLARATION, "1.2.3")).toBe("older_than_tested");
    expect(bandForVersion(SPREAD_DECLARATION, "1.2.2")).toBe("below_floor");
  });
});

describe("CF-B02/03/04-BANDS — strict semver comparison", () => {
  const cases: ReadonlyArray<readonly [string, HarnessVersionBand]> = [
    ["1.2.3", "older_than_tested"],
    ["1.10.0", "newer_than_tested"],
    ["1.5.0", "at_tested"],
    ["2.0.0", "newer_than_tested"],
    // A prerelease has lower precedence than the release it precedes.
    ["1.5.0-rc.1", "older_than_tested"],
    ["1.2.3-rc.1", "below_floor"],
    // Malformed: v-prefix, leading zeros, missing patch, empty identifier.
    ["v1.5.0", "unknown"],
    ["1.05.0", "unknown"],
    ["1.5", "unknown"],
    ["1.5.0-", "unknown"],
    ["", "unknown"],
  ];
  it.each(cases)("%s bands as %s against floor 1.2.3 / tested 1.5.0", (version, expected) => {
    expect(bandForVersion(SPREAD_DECLARATION, version)).toBe(expected);
  });

  it("orders prerelease identifiers per semver §11", () => {
    const declaration: HarnessSupportDeclaration = {
      ...SPREAD_DECLARATION,
      floor: "1.0.0-rc.1",
      testedWith: "1.0.0-rc.2",
    };
    expect(bandForVersion(declaration, "1.0.0-rc.2")).toBe("at_tested");
    expect(bandForVersion(declaration, "1.0.0-rc.1")).toBe("older_than_tested");
    // Numeric identifiers compare numerically, not lexically.
    expect(bandForVersion(declaration, "1.0.0-rc.10")).toBe("newer_than_tested");
    // A longer identifier set outranks the prefix it extends.
    expect(bandForVersion(declaration, "1.0.0-rc.2.1")).toBe("newer_than_tested");
    // Alphanumeric identifiers compare in ASCII order: beta precedes rc.
    expect(bandForVersion(declaration, "1.0.0-beta.9")).toBe("below_floor");
    // A release outranks every prerelease of the same version.
    expect(bandForVersion(declaration, "1.0.0")).toBe("newer_than_tested");
    // Build metadata is ignored.
    expect(bandForVersion(declaration, "1.0.0-rc.2+build.7")).toBe("at_tested");
  });
});

// Vendored packages are installed by `pnpm install`, so CI and a developer
// machine both resolve them. Installer-shipped harnesses (#224) are the
// OPERATOR's binary and are legitimately absent in CI — asserting they resolve
// everywhere would assert that Cormidia installs providers, which it must not.
const VENDORED_KINDS = RUNTIME_KINDS.filter(
  (kind) => HARNESS_SUPPORT[kind].versionSource.kind === "vendored_npm_package",
);
const INSTALLED_BINARY_KINDS = RUNTIME_KINDS.filter(
  (kind) => HARNESS_SUPPORT[kind].versionSource.kind === "installed_binary",
);

describe("CF-B02/03/04-BANDS — token-free detection of the installed harness", () => {
  it.each(VENDORED_KINDS)("%s resolves the vendored package version without a provider call", (kind) => {
    const source = HARNESS_SUPPORT[kind].versionSource;
    const named = source.kind === "vendored_npm_package" ? source.packageName : kind;
    const detection = detectHarnessVersion(kind);
    expect(detection, `no installed version for ${named}`).toMatchObject({ detected: true });
  });

  it.each(VENDORED_KINDS)("%s is installed at its declared tested-with version", (kind) => {
    // A dependency bump that does not also move testedWith would leave the
    // declaration lying about what certification ran against
    // (docs/harness/adding-updating.md §6).
    expect(assessHarnessVersion(kind).band, `bump testedWith for ${kind} in src/runtime/harness-support.ts`).toBe(
      "at_tested",
    );
  });

  it.each(INSTALLED_BINARY_KINDS)(
    "%s reports its operator-installed binary honestly — resolved, or an undetermined band, never a claimed pass",
    (kind) => {
      // The binary may or may not be present on the machine running this suite.
      // Both outcomes are correct; the one thing that must never happen is a
      // band claiming a version certification ran against when none was read.
      const assessment = assessHarnessVersion(kind);
      const detection = detectHarnessVersion(kind);
      if (detection.detected) {
        expect(assessment.band, `re-certify ${kind} and bump testedWith`).toBe("at_tested");
        expect(assessment.version).toBe(HARNESS_SUPPORT[kind].testedWith);
        return;
      }
      expect(assessment.band).toBe("unknown");
      expect(assessment.version).toBeUndefined();
      expect(assessment.detail).toContain("undetermined");
      // Absence is a readiness fact, never a version verdict: Cormidia does not
      // install providers (#224), so a missing binary must not read as
      // below_floor and must not block.
      expect(assessment.band).not.toBe("below_floor");
    },
  );

  it("reports an unresolvable package honestly rather than guessing", () => {
    const assessment = assessHarnessVersion("claude", () => ({
      detected: false,
      reason: "@vendor/absent is not installed",
    }));
    expect(assessment.band).toBe("unknown");
    expect(assessment.detail).toContain("undetermined");
  });
});
