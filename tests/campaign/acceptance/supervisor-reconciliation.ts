// campaign/acceptance/supervisor-reconciliation.ts — the org does the work, not
// the supervisor (CORMIDIA-INV-ACC-7a).
//
// There is deliberately NO runtime guardrail that could prevent a supervising
// agent from running `git` itself. The honest mechanism is detection plus a
// refusal to score, and the detection is a three-way reconciliation of records
// that are produced independently:
//
//   * the campaign org's INVOCATION AUDIT — one row per `cormidia` /
//     `cormidia-job` CLI dispatch (`src/cli/invocation-audit.ts`);
//   * per-commit AUTHORSHIP in each scenario repository;
//   * the run journal's TURN RECORDS.
//
// A supervisor that edits a scenario repo directly leaves a commit with no turn
// behind it. A supervisor that runs `gh issue create` leaves a product-affecting
// action with no invocation-audit row. A supervisor that imports a provider SDK
// "just for the grading" leaves a provider call inside the campaign's own
// process. Each is a separate hole, so each is a separate check — and a scenario
// whose reconciliation does not close reports `ungraded`/`incomplete` rather
// than a score, because every score in that scenario would be measuring the
// supervisor.

export type ReconciliationCode =
  | "commit-outside-turn-identity"
  | "action-without-invocation-row"
  | "turn-without-invocation-row"
  | "provider-call-in-campaign-process";

export interface ScenarioCommit {
  sha: string;
  /** `Name <email>` exactly as git reports it. */
  author: string;
  /** The Cormidia turn this commit claims to come from, when it declares one. */
  turnId?: string;
}

/**
 * Commits at or before the provisioning baseline are the state the scenario
 * STARTED from, not work the org did — S-ACC-2's corpus is "built by the
 * campaign's provision phase, committed before onboarding". Without this the
 * reconciliation would flag the seed itself and no scenario could ever close.
 * With it, a supervisor commit sneaked in mid-run still fails, because it is
 * not among the provisioned shas.
 */
export interface ProvisioningBaseline {
  baselineCommit: string;
  /** Every sha at or before the baseline, from the provisioning phase. */
  provisionedShas: readonly string[];
}

export interface JournalTurnRecord {
  turnId: string;
  /** The invocation that launched this turn. */
  invocationId: string;
  role: string;
}

export interface InvocationAuditRow {
  invocationId: string;
  command: string;
  /** Product-affecting effects this dispatch is accountable for. */
  effects?: string[];
}

/** A product-affecting action observed on the outside — a branch, a PR, an
 *  issue, a pushed commit. Every one must trace to an invocation row. */
export interface ProductAffectingAction {
  id: string;
  kind: "commit" | "branch" | "pull-request" | "issue" | "file-write";
  invocationId?: string;
}

export interface SupervisorReconciliationInput {
  scenarioId: string;
  /** Author identities a Cormidia turn legitimately commits under. */
  turnIdentities: readonly string[];
  commits: readonly ScenarioCommit[];
  journalTurns: readonly JournalTurnRecord[];
  invocationAudit: readonly InvocationAuditRow[];
  actions: readonly ProductAffectingAction[];
  /** Provider SDK calls observed inside the campaign's own process. Grading is
   *  itself a Cormidia-invoked turn, so this must always be empty. */
  providerCallsInCampaignProcess?: number;
  /** Absent means NOTHING is exempt — the strictest reading, and the right
   *  default for a scenario with no seed. */
  provisioning?: ProvisioningBaseline;
}

export interface ReconciliationViolation {
  code: ReconciliationCode;
  subject: string;
  detail: string;
}

export interface SupervisorReconciliation {
  scenarioId: string;
  closed: boolean;
  violations: ReconciliationViolation[];
  /** What a non-closing reconciliation forces. Never a score. */
  forcedOutcome: "score-permitted" | "ungraded-and-incomplete";
  checked: { commits: number; turns: number; invocations: number; actions: number; provisionedCommitsExempt: number };
}

export function reconcileSupervisorNonParticipation(input: SupervisorReconciliationInput): SupervisorReconciliation {
  const violations: ReconciliationViolation[] = [];
  const identities = new Set(input.turnIdentities);
  const invocationIds = new Set(input.invocationAudit.map((row) => row.invocationId));

  const provisioned = new Set(input.provisioning?.provisionedShas ?? []);
  for (const commit of input.commits) {
    if (provisioned.has(commit.sha)) continue;
    if (!identities.has(commit.author)) {
      violations.push({
        code: "commit-outside-turn-identity",
        subject: commit.sha,
        detail: `commit author ${JSON.stringify(commit.author)} is not a Cormidia turn identity`,
      });
    }
  }

  for (const turn of input.journalTurns) {
    if (!invocationIds.has(turn.invocationId)) {
      violations.push({
        code: "turn-without-invocation-row",
        subject: turn.turnId,
        detail: `journal turn cites invocation ${turn.invocationId}, which has no audit row`,
      });
    }
  }

  for (const action of input.actions) {
    if (action.invocationId === undefined || !invocationIds.has(action.invocationId)) {
      violations.push({
        code: "action-without-invocation-row",
        subject: action.id,
        detail: `${action.kind} has no corresponding invocation-audit row; it was not performed by the binaries`,
      });
    }
  }

  const providerCalls = input.providerCallsInCampaignProcess ?? 0;
  if (providerCalls > 0) {
    violations.push({
      code: "provider-call-in-campaign-process",
      subject: input.scenarioId,
      detail: `${providerCalls} provider call(s) were made inside the campaign's own process; grading is itself a Cormidia-invoked turn`,
    });
  }

  const closed = violations.length === 0;
  return {
    scenarioId: input.scenarioId,
    closed,
    violations,
    forcedOutcome: closed ? "score-permitted" : "ungraded-and-incomplete",
    checked: {
      provisionedCommitsExempt: provisioned.size,
      commits: input.commits.length,
      turns: input.journalTurns.length,
      invocations: input.invocationAudit.length,
      actions: input.actions.length,
    },
  };
}

/** ASCII unit separator — `%x1f` in the git format string below. */
const SEPARATOR = "\u001f";

/** Read every commit of a scenario repository as `{sha, author}`. The git
 *  runner is injected so this stays usable over any repository handle. */
export function readScenarioCommits(git: (args: string[]) => string): ScenarioCommit[] {
  const output = git(["log", "--format=%H%x1f%an <%ae>"]).trim();
  if (output.length === 0) return [];
  return output.split("\n").map((line) => {
    const [sha, author] = line.split(SEPARATOR);
    return { sha: sha ?? "", author: author ?? "" };
  });
}
