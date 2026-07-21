/**
 * Environment inherited by every provider harness and its shell commands.
 *
 * Provider turns are headless: package managers, system installers, and git
 * must never try to open a prompt that cannot be answered. These values are
 * authoritative for the sandbox, while every unrelated caller-provided value
 * (provider credentials, HOME, PATH, campaign scratch paths, and so on) is
 * preserved.
 */
export const NON_INTERACTIVE_ENV = {
  CI: "true",
  NPM_CONFIG_YES: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
} as const satisfies NodeJS.ProcessEnv;

export function withNonInteractiveEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, ...NON_INTERACTIVE_ENV };
}
