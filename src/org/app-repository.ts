// Defense in depth for an ALREADY REGISTERED app (#385). A contaminated record
// predates this guard, so every outward-action surface — verify, planning,
// loop/dispatch — refuses it before the first network call and names the
// supported recovery. Remediation is never "hand-edit apps.yaml or
// .cormidia/config.yaml": both sources are bound to the same wrong identity,
// so only a transactional re-onboard actually corrects it.

import {
  classifyRepositoryIdentity,
  isRepositoryIdentity,
  type RepositoryIdentity,
  type RepositoryIdentityRejection,
} from "../runtime/repo-identity.js";

export function appRepositoryRecovery(appName: string): string {
  return (
    `re-onboard ${appName} against its real repository: cormidia app reset ${appName} --execute ` +
    `--confirm ${appName}, then cormidia bootstrap <checkout> --repo <owner/repo> (or cormidia new-app ` +
    "… --repo <owner/repo>). Editing apps.yaml, .cormidia/config.yaml, or the generated guide by hand " +
    "leaves the other sources bound to the wrong identity."
  );
}

/** Parse-don't-cast at an outward seam. `surface` names the refusing command so
 * the operator learns which action was stopped, not just that something was. */
export function assertActionableAppRepository(
  app: { readonly name: string; readonly repo: string },
  surface: string,
): RepositoryIdentity {
  const result = classifyRepositoryIdentity(app.repo);
  if (isRepositoryIdentity(result)) return result;
  throw new Error(
    `${surface}: app ${app.name} is registered with a non-actionable repository identity ` +
      `"${result.value}" — ${result.detail}. ${appRepositoryRecovery(app.name)}`,
  );
}

/** Non-throwing form for surfaces that report checks instead of failing hard. */
export function appRepositoryRejection(repo: string): RepositoryIdentityRejection | undefined {
  const result = classifyRepositoryIdentity(repo);
  return isRepositoryIdentity(result) ? undefined : result;
}
