/** Provisioning needs the operator's normal credential helper while remaining
 * non-interactive. Replacing GIT_CONFIG_GLOBAL with /dev/null removes the
 * `gh auth git-credential` helper and makes every real baseline push fail. */
export function campaignGitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };
}
