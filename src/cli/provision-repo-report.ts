// Operator-facing rendering for `provision-repo` (#382).
//
// Split from the command so each module stays inside the new-module size
// ceiling, and because the preview IS the thing being approved: it has to name
// the exact repository, the exact bytes, the exact remote and branch, and the
// exact labels, in a form a human can read before an irreversible outward act.
//
// The verification block is printed per-facet rather than as one verdict. "Not
// ready" is only useful if it says WHICH of visibility, remote identity,
// default-branch ancestry, bootstrap commit, or labels is wrong.

import { stableJson } from "../org/lifecycle.js";
import type { ProvisionRefusedError } from "../org/repo-provision-execute.js";
import type { RepositoryProvisionTransaction } from "../org/repo-provision-journal.js";
import type { RepositoryProvisionPreflight } from "../org/repo-provision.js";
import type { ProvisionVerification } from "../org/repo-provision-verify.js";

export interface ProvisionReportContext {
  scope: "org" | "app";
  execute: boolean;
  json: boolean;
  provisionCommand: string;
}

export function emitProvisionReport(
  input: ProvisionReportContext,
  preflight: RepositoryProvisionPreflight,
  transaction: RepositoryProvisionTransaction | null,
  verification: ProvisionVerification | null,
  refusal?: ProvisionRefusedError,
): void {
  if (input.json) {
    console.log(
      stableJson({
        schema_version: 1,
        kind: "repository-provision",
        scope: input.scope,
        mutating: input.execute,
        preflight,
        transaction,
        verification,
        refusal: refusal === undefined ? null : { code: refusal.code, message: refusal.message },
        provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
      }).trimEnd(),
    );
    return;
  }
  printText(input, preflight, transaction, verification, refusal);
}

function printText(
  input: ProvisionReportContext,
  preflight: RepositoryProvisionPreflight,
  transaction: RepositoryProvisionTransaction | null,
  verification: ProvisionVerification | null,
  refusal?: ProvisionRefusedError,
): void {
  const target = preflight.target?.slug ?? preflight.identity_rejection?.value ?? "(unresolved)";
  console.log(`${input.execute ? "Provision" : "Would provision"} ${target} (private)`);
  console.log(`  source        ${preflight.source_root}`);
  console.log(`  remote        ${preflight.remote_name} -> ${preflight.remote_url || "(unresolved)"}`);
  console.log(`  push target   ${preflight.push_branch}`);
  console.log(`  remote state  ${preflight.remote.state}`);
  console.log(`  commit scope  ${preflight.owned_paths.length} file(s), ${preflight.total_bytes} bytes`);
  for (const entry of preflight.owned_paths.slice(0, 20)) {
    console.log(`      ${entry.path} (${entry.bytes} bytes)`);
  }
  if (preflight.owned_paths.length > 20) {
    console.log(`      … ${preflight.owned_paths.length - 20} more`);
  }
  console.log(`  labels        ${preflight.labels.length} canonical definition(s)`);

  for (const blocker of preflight.blockers) console.log(`  BLOCKED: ${blocker}`);
  if (refusal !== undefined) console.log(`  REFUSED (${refusal.code}): ${refusal.message}`);

  if (transaction !== null) {
    console.log(`  repository    ${transaction.repository_origin}`);
    console.log(`  commit        ${transaction.commit ?? "(none)"}`);
    console.log(`  durability    ${transaction.durability}`);
    console.log(`  next action   ${transaction.next_action}`);
  }
  if (verification !== null) {
    console.log(`  verification  ${verification.ready ? "ready" : "NOT ready"}`);
    for (const check of verification.checks) {
      console.log(`      ${check.status === "pass" ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
      if (check.remediation !== "") console.log(`           -> ${check.remediation}`);
    }
  }
  if (!input.execute && preflight.blockers.length === 0) {
    console.log(`\nNothing was created. Run \`${input.provisionCommand}\` to provision it.`);
  }
}
