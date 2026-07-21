/**
 * Environment inherited by every provider harness and its shell commands.
 *
 * Provider turns are headless: package managers, system installers, and git
 * must never try to open a prompt that cannot be answered. These values are
 * authoritative for the sandbox, while every unrelated caller-provided value
 * (provider credentials, HOME, PATH, campaign scratch paths, and so on) is
 * preserved.
 */

/**
 * Deny-by-default policy for dependency **build** (install) scripts.
 *
 * ISSUE-017 made the sandbox non-interactive; ISSUE-029 proved that is only
 * half the mechanism. pnpm 11 does not merely *prompt* about a dependency whose
 * install script it has no decision for — when it cannot ask, it *writes the
 * question into the repo*: `handleIgnoredBuilds` → `writeIgnoredBuildsToAllowBuilds`
 * appends an `allowBuilds:` block whose values are the literal string
 * `set this to true or false`, then fails the install. A builder that answers by
 * appending its own `allowBuilds:` block produces a duplicate YAML mapping key,
 * and from that moment *every* pnpm invocation dies at parse time — including the
 * ones that would repair the file. `CI=true` does not prevent this; the write
 * happens on the non-interactive path.
 *
 * The knob that does prevent it is a build policy that leaves pnpm nothing
 * undecided. Verified against the installed pnpm 11.10.0 (`pnpm help install`,
 * `pnpm config --help`, and the shipped `pnpm.mjs`):
 *
 * - pnpm 11 ignores `npm_config_*` / `NPM_CONFIG_*` entirely. Its env-config
 *   prefix is `pnpm_config_` / `PNPM_CONFIG_` (`getEnvKeySuffix` in pnpm.mjs), so
 *   `NPM_CONFIG_YES` above cannot carry package-manager policy — only a
 *   `PNPM_CONFIG_*` key can.
 * - `ignoreScripts` short-circuits the decision entirely: in `buildModules`,
 *   `ignoredBuilds.add(...)` is reached only when a dependency requires a build
 *   *and* the allow-build policy returned "undecided". With `ignoreScripts` set,
 *   that branch never runs, so the ignored-build set stays empty, so the
 *   placeholder is never written and the install exits 0.
 * - It denies rather than allows, which is the safer default: a dependency that
 *   silently runs an install script is the more dangerous outcome. The opposite
 *   knob (`dangerouslyAllowAllBuilds`) is deliberately NOT used here.
 * - It does not disable the gates: `pnpm run <script>` / `pnpm test` still
 *   execute normally under it (only lifecycle and dependency install scripts are
 *   skipped), so a test or lint gate can never pass vacuously because of it.
 *
 * A ticket that genuinely needs a dependency built opts in explicitly — the
 * app's `setup_command` passes `--no-ignore-scripts` (a CLI flag beats env
 * config in pnpm) alongside a committed `allowBuilds` decision. That opt-in path
 * can still reach the placeholder writer, which is why the setup gate keeps its
 * own detection backstop (`src/loop/setup-artifacts.ts`).
 */
export const DEPENDENCY_BUILD_POLICY_ENV = {
  PNPM_CONFIG_IGNORE_SCRIPTS: "true",
} as const satisfies NodeJS.ProcessEnv;

export const NON_INTERACTIVE_ENV = {
  CI: "true",
  NPM_CONFIG_YES: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  ...DEPENDENCY_BUILD_POLICY_ENV,
} as const satisfies NodeJS.ProcessEnv;

export function withNonInteractiveEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, ...NON_INTERACTIVE_ENV };
}

/** The build policy alone, for a caller that owns the rest of its environment
 *  (the quality-gate subprocess keeps its own `CI=1`, Stage 3). */
export function withDependencyBuildPolicy(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, ...DEPENDENCY_BUILD_POLICY_ENV };
}
