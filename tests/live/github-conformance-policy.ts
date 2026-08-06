import type { GithubConformanceOptions } from "../fixtures/github-double/conformance/suite.js";

export type ReleaseGithubConformanceOptions = Required<
  Pick<GithubConformanceOptions, "readBackAttempts" | "readBackDelayMs" | "labelSearchReadBackDelayMs">
>;

const DEFAULT_RELEASE_GITHUB_CONFORMANCE_OPTIONS: ReleaseGithubConformanceOptions = {
  readBackAttempts: 3,
  readBackDelayMs: 1_000,
  labelSearchReadBackDelayMs: 60_000,
};

/** Keep the ratified three-attempt count and ordinary one-second projection
 * policy while giving only GitHub's observed-slow label filter two minutes in
 * total. Exhaustion is still incomplete/inconclusive in the result mapper. */
export function releaseGithubConformanceOptions(
  options: ReleaseGithubConformanceOptions = DEFAULT_RELEASE_GITHUB_CONFORMANCE_OPTIONS,
): ReleaseGithubConformanceOptions {
  if (options.readBackAttempts !== 3) {
    throw new Error("release GitHub conformance requires exactly three attempts");
  }
  if (options.readBackDelayMs !== 1_000) {
    throw new Error("release GitHub conformance general readback interval must remain 1000ms");
  }
  if (options.labelSearchReadBackDelayMs !== 60_000) {
    throw new Error("release GitHub conformance label-search interval must remain exactly 60000ms");
  }
  return { ...options };
}
