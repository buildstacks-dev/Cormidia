// Strict, dependency-free semantic-version arithmetic (TASTE.md §3), split out
// of harness-support.ts so the declarations + banding policy and the version
// math each stay inside the new-module size budget — the same split #338 made
// for detection. Nothing here knows what a harness is.

export interface SemanticVersion {
  readonly release: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

// Deliberately strict and dependency-free (TASTE.md §3): no `v` prefix, no
// leading zeros, no missing patch. Build metadata is ignored per semver §10.
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/;

export function parseSemanticVersion(raw: string): SemanticVersion | undefined {
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

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
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
