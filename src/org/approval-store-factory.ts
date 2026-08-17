import { ApprovalStore, type ApprovalStoreOptions } from "./approvals.js";
import type { AppsFile } from "./apps.js";

/** Construct the org's approval store from its already-validated AppsFile.
 * Callers must thread that config; state-home contents are not an authority
 * source and are never rediscovered here. */
export function approvalStoreForApps(
  stateHome: string,
  appsFile: AppsFile,
  options: ApprovalStoreOptions = {},
): ApprovalStore {
  return new ApprovalStore(stateHome, { ...options, policy: appsFile.approvalPolicy ?? {} });
}
