export function assertGitHubTarget(actual: { owner: string; repo: string; isPrivate: boolean }, declared: { owner: string; repo_pattern: string }): void {
  if (actual.owner !== declared.owner) throw new Error("github_owner_not_allowlisted");
  if (!/^operon-eval-[a-z0-9][a-z0-9-]*$/.test(actual.repo)) throw new Error("github_repo_not_allowlisted");
  if (declared.repo_pattern !== "operon-eval-*" && actual.repo !== declared.repo_pattern) throw new Error("github_repo_not_declared");
  if (!actual.isPrivate) throw new Error("github_repo_must_be_private");
}

export function assertLiveConfirmation(args: { envEnabled: boolean; campaignId: string; confirmedId?: string; requestedMaxUsd?: number; manifestMaxUsd: number }): void {
  if (!args.envEnabled) throw new Error("live_eval_env_not_enabled");
  if (args.confirmedId !== args.campaignId) throw new Error("live_eval_confirmation_mismatch");
  if (typeof args.requestedMaxUsd !== "number" || !Number.isFinite(args.requestedMaxUsd) || args.requestedMaxUsd <= 0) throw new Error("live_eval_max_usd_required");
  if (args.requestedMaxUsd > args.manifestMaxUsd) throw new Error("live_eval_cap_exceeds_manifest");
}
