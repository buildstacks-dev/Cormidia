import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CampaignBudgetStore,
  type CampaignBudgetLedger,
} from "../eval-runner/campaign-budget.js";
import {
  evaluateEpisodePlannerDiagnostic,
  type EpisodePlannerDiagnosticAttempt,
} from "../eval-runner/diagnostic.js";
import { loadEpisodePlannerCorpus } from "../eval-runner/episode-planner-corpus.js";
import {
  ARTIFACT_ROOT,
  HARNESS_ROOT,
  assertArtifactPath,
} from "../fixtures/controlled-world.js";
import { loadValidationPolicy } from "../policy/load.js";

const campaignArgument = argumentValue("--campaign") ?? "OPERON-L4-002";
if (
  campaignArgument !== "OPERON-L4-002" &&
  campaignArgument !== "OPERON-L4-003" &&
  campaignArgument !== "OPERON-L4-004" &&
  campaignArgument !== "OPERON-L4-005"
) {
  throw new Error(`unsupported diagnostic audit campaign ${campaignArgument}`);
}
const CAMPAIGN_ID = campaignArgument;
const CASE_ID =
  CAMPAIGN_ID === "OPERON-L4-003" || CAMPAIGN_ID === "OPERON-L4-005"
    ? "OPERON-EP-004"
    : "OPERON-EP-003";
const ROOT = assertArtifactPath(resolve(ARTIFACT_ROOT, "layer-4", CAMPAIGN_ID));
const REPORT_PATH = resolve(ROOT, "diagnostic-report.json");
const LEDGER_PATH = resolve(ROOT, "spend-ledger.json");
const ATTEMPT_ROOT = resolve(ROOT, "attempts");
const OUTPUT_PATH = resolve(ROOT, "diagnostic-evidence-audit.json");
const BASE_PROMPT_PATH = resolve(HARNESS_ROOT, "..", "prompts", "episode", "plan.md");
const OVERLAY_PATH = resolve(
  HARNESS_ROOT,
  "campaigns",
  CAMPAIGN_ID,
  "candidate-prompt-overlay.md",
);

interface AttemptEvidence extends EpisodePlannerDiagnosticAttempt {
  schema_version: 1;
  campaign_id: string;
  corpus_sha256: string;
  candidate_prompt_sha256: string;
  attempt_id: string;
  budget_turns: CampaignBudgetLedger["turns"];
  quality: { acceptable: boolean } | null;
  error: { name: string; message: string } | null;
}

interface DiagnosticReport {
  schema_version: 1;
  campaign_id: string;
  corpus: { corpus_sha256: string; case_id: string; attempts_required: number };
  candidate_prompt: {
    base_sha256: string;
    overlay_sha256: string;
    assembled_sha256: string;
    production_prompt_modified: boolean;
  };
  attempts_completed: number;
  spend: {
    ceiling_usd: number;
    per_turn_ceiling_usd: number;
    observed_usd: number;
    reserved_usd: number;
    unmeasured_turn_ids: string[];
    ceiling_violations: string[];
    integrity_passed: boolean;
  };
  diagnostic: {
    campaignId: string;
    status: string;
    passed: boolean;
    qualificationIssued: boolean;
    qualificationProhibited: boolean;
    observedAttempts: number;
    contractPasses: number;
    acceptableAttempts: number;
    failures?: string[];
  };
  qualification: { issued: boolean; authorized: boolean; reason: string };
  production_assignment_preserved: boolean;
  production_roles_modified: boolean;
  production_prompt_modified: boolean;
  frozen_corpus_modified: boolean;
  external_effects_executed: boolean;
  attempts: Array<{
    attempt_id: string;
    contract_passed: boolean;
    acceptable: boolean;
    evidence: string;
  }>;
}

const [
  reportSource,
  ledgerSource,
  corpus,
  policy,
  basePrompt,
  overlay,
  attemptFileNames,
] = await Promise.all([
  readFile(REPORT_PATH),
  readFile(LEDGER_PATH),
  loadEpisodePlannerCorpus(),
  loadValidationPolicy(resolve(HARNESS_ROOT, "validation-policy.yaml")),
  readFile(BASE_PROMPT_PATH),
  readFile(OVERLAY_PATH),
  readdir(ATTEMPT_ROOT),
]);
const report = JSON.parse(reportSource.toString("utf8")) as DiagnosticReport;
const authorization =
  CAMPAIGN_ID === "OPERON-L4-005"
    ? policy.authorizations.layer_4_episode_planner_l4_005_diagnostic
    : CAMPAIGN_ID === "OPERON-L4-004"
    ? policy.authorizations.layer_4_episode_planner_l4_004_diagnostic
    : CAMPAIGN_ID === "OPERON-L4-003"
    ? policy.authorizations.layer_4_episode_planner_l4_003_diagnostic
    : policy.authorizations.layer_4_episode_planner_diagnostic;
const assembledPrompt = Buffer.concat([
  basePrompt,
  Buffer.from("\n\n", "utf8"),
  overlay,
]);
const budgetStore = new CampaignBudgetStore(
  LEDGER_PATH,
  corpus.corpusSha256,
  {
    campaignId: CAMPAIGN_ID,
    aggregateCeilingUsd: 10,
    perTurnCeilingUsd: 5,
  },
);
const ledger = await budgetStore.read();
const spend = await budgetStore.summary();
const attemptSources = await Promise.all(
  attemptFileNames
    .filter((name) => new RegExp(`^${CASE_ID}-r[123]\\.json$`).test(name))
    .sort()
    .map(async (name) => ({
      name,
      source: await readFile(resolve(ATTEMPT_ROOT, name)),
    })),
);
const attempts = attemptSources.map(
  ({ source }) => JSON.parse(source.toString("utf8")) as AttemptEvidence,
);
const recomputedDiagnostic = evaluateEpisodePlannerDiagnostic(attempts, {
  campaignId: CAMPAIGN_ID,
  caseId: CASE_ID,
  requiredAttempts: 3,
});
const runEvidence = await collectRunEvidence();
const reportAttemptIds = report.attempts.map((attempt) => attempt.attempt_id).sort();
const observedAttemptIds = attempts.map((attempt) => attempt.attempt_id).sort();
const ledgerTurnIds = ledger.turns.map((turn) => turn.id).sort();
const attemptTurnIds = attempts.flatMap((attempt) =>
  attempt.budget_turns.map((turn) => turn.id),
).sort();
const checks = [
  {
    id: "report_identity",
    passed:
      report.schema_version === 1 &&
      report.campaign_id === CAMPAIGN_ID &&
      report.corpus.case_id === CASE_ID &&
      report.corpus.attempts_required === 3,
  },
  {
    id: "authorization_identity",
    passed:
      authorization.id === CAMPAIGN_ID &&
      authorization.status ===
        (CAMPAIGN_ID === "OPERON-L4-002"
          ? "human_authorized"
          : "human_authorized_by_delegation") &&
      authorization.corpus.case_id === CASE_ID &&
      authorization.corpus.runs_per_case === 3 &&
      authorization.spend.aggregate_ceiling_usd === 10 &&
      authorization.spend.per_turn_ceiling_usd === 5 &&
      authorization.quality.qualification_claim === "prohibited",
  },
  {
    id: "prompt_and_corpus_integrity",
    passed:
      sha256(basePrompt) === authorization.candidate_prompt.base_sha256 &&
      sha256(overlay) === authorization.candidate_prompt.overlay_sha256 &&
      sha256(assembledPrompt) === authorization.candidate_prompt.assembled_sha256 &&
      corpus.corpusSha256 === authorization.corpus.corpus_sha256 &&
      report.corpus.corpus_sha256 === corpus.corpusSha256 &&
      report.candidate_prompt.base_sha256 === sha256(basePrompt) &&
      report.candidate_prompt.overlay_sha256 === sha256(overlay) &&
      report.candidate_prompt.assembled_sha256 === sha256(assembledPrompt),
  },
  {
    id: "attempt_evidence_complete_and_consistent",
    passed:
      attempts.length === report.attempts_completed &&
      sameMembers(reportAttemptIds, observedAttemptIds) &&
      attempts.every(
        (attempt) =>
          attempt.schema_version === 1 &&
          attempt.campaign_id === CAMPAIGN_ID &&
          attempt.corpus_sha256 === corpus.corpusSha256 &&
          attempt.candidate_prompt_sha256 === sha256(assembledPrompt) &&
          attempt.caseId === CASE_ID &&
          attempt.acceptable ===
            (attempt.contractPassed && attempt.quality?.acceptable === true),
      ),
  },
  {
    id: "diagnostic_verdict_recomputes_or_original_defect_is_attributable",
    passed:
      report.diagnostic.observedAttempts === recomputedDiagnostic.observedAttempts &&
      report.diagnostic.contractPasses === recomputedDiagnostic.contractPasses &&
      report.diagnostic.acceptableAttempts === recomputedDiagnostic.acceptableAttempts &&
      (CAMPAIGN_ID === "OPERON-L4-003"
        ? report.diagnostic.campaignId === "OPERON-L4-002" &&
          report.diagnostic.status === "invalid_evidence" &&
          report.diagnostic.passed === false &&
          report.diagnostic.failures?.length === 3 &&
          recomputedDiagnostic.campaignId === CAMPAIGN_ID &&
          recomputedDiagnostic.status === "passed" &&
          recomputedDiagnostic.passed === true
        : report.diagnostic.campaignId === CAMPAIGN_ID &&
          report.diagnostic.status === recomputedDiagnostic.status &&
          report.diagnostic.passed === recomputedDiagnostic.passed),
  },
  {
    id: "qualification_prohibited_and_not_issued",
    passed:
      report.diagnostic.qualificationIssued === false &&
      report.diagnostic.qualificationProhibited === true &&
      report.qualification.issued === false &&
      report.qualification.authorized === false,
  },
  {
    id: "budget_identity_and_settlement",
    passed:
      ledger.campaign_id === CAMPAIGN_ID &&
      ledger.aggregate_ceiling_usd === 10 &&
      ledger.per_turn_ceiling_usd === 5 &&
      spend.reservedUsd === 0 &&
      spend.unmeasuredTurnIds.length === 0 &&
      spend.ceilingViolations.length === 0 &&
      spend.observedUsd <= 10 &&
      report.spend.observed_usd === spend.observedUsd &&
      report.spend.reserved_usd === spend.reservedUsd &&
      report.spend.unmeasured_turn_ids.length === 0 &&
      report.spend.ceiling_violations.length === 0 &&
      report.spend.integrity_passed === true &&
      ledger.turns.every(
        (turn) =>
          turn.status === "settled" &&
          turn.observed_usd !== null &&
          turn.usage_quality === "complete" &&
          turn.ceiling_violation === null,
      ),
  },
  {
    id: "attempt_turns_match_authoritative_ledger",
    passed: sameMembers(ledgerTurnIds, attemptTurnIds),
  },
  {
    id: "raw_outputs_retained",
    passed:
      runEvidence.outputHashes.length === ledger.turns.length &&
      runEvidence.outputHashes.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
  },
  {
    id: "no_tool_or_external_effect_events",
    passed: runEvidence.forbiddenEvents.length === 0,
  },
  {
    id: "protected_production_surfaces_preserved",
    passed:
      report.production_assignment_preserved === true &&
      report.production_roles_modified === false &&
      report.production_prompt_modified === false &&
      report.candidate_prompt.production_prompt_modified === false &&
      report.frozen_corpus_modified === false &&
      report.external_effects_executed === false &&
      protectedTrackedPathsClean(),
  },
];
const evidenceIntegrityPassed = checks.every((check) => check.passed);
const audit = {
  schema_version: 1,
  campaign_id: CAMPAIGN_ID,
  generated_at: new Date().toISOString(),
  independence: {
    level: "I1",
    description:
      "Role-separated same-agent audit of persisted evidence; not fresh-context or organizational independence.",
    c3_limitation:
      "A separate human/team review remains the normal C3 expectation before production adoption.",
  },
  evidence_integrity: evidenceIntegrityPassed
    ? CAMPAIGN_ID === "OPERON-L4-003"
      ? "passed_with_attributable_original_verdict_defect"
      : "passed"
    : "failed",
  diagnostic_result: {
    status: recomputedDiagnostic.status,
    passed: recomputedDiagnostic.passed,
    qualification_issued: false,
  },
  spend: {
    observed_usd: spend.observedUsd,
    ceiling_usd: ledger.aggregate_ceiling_usd,
    settled_turns: ledger.turns.length,
  },
  immutable_evidence: {
    diagnostic_report_sha256: sha256(reportSource),
    spend_ledger_sha256: sha256(ledgerSource),
    attempts: attemptSources.map(({ name, source }) => ({
      path: `./attempts/${name}`,
      sha256: sha256(source),
    })),
    raw_outputs: runEvidence.outputHashes,
  },
  checks,
};

await writeJsonAtomic(OUTPUT_PATH, audit);
console.log(JSON.stringify(audit, null, 2));
if (!evidenceIntegrityPassed) process.exitCode = 1;

async function collectRunEvidence(): Promise<{
  outputHashes: Array<{ path: string; sha256: string }>;
  forbiddenEvents: Array<{ path: string; event: string }>;
}> {
  const outputHashes: Array<{ path: string; sha256: string }> = [];
  const forbiddenEvents: Array<{ path: string; event: string }> = [];
  for (const attempt of attempts) {
    const runRoot = resolve(
      ROOT,
      "worlds",
      attempt.attempt_id,
      "state-home",
      "runs",
      "operon-layer-4-diagnostic",
    );
    const runDirectories = await readdir(runRoot);
    for (const runDirectory of runDirectories.sort()) {
      const outputPath = resolve(runRoot, runDirectory, "output.md");
      const eventsPath = resolve(runRoot, runDirectory, "events.jsonl");
      const [output, events] = await Promise.all([
        readFile(outputPath),
        readFile(eventsPath, "utf8"),
      ]);
      outputHashes.push({
        path: `./worlds/${attempt.attempt_id}/state-home/runs/` +
          `operon-layer-4-diagnostic/${runDirectory}/output.md`,
        sha256: sha256(output),
      });
      for (const line of events.split("\n").filter((entry) => entry.length > 0)) {
        const event = JSON.parse(line) as { event?: string };
        if (
          typeof event.event === "string" &&
          (event.event.startsWith("tool.") || event.event.startsWith("effect."))
        ) {
          forbiddenEvents.push({
            path: eventsPath,
            event: event.event,
          });
        }
      }
    }
  }
  return { outputHashes, forbiddenEvents };
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry) => right.includes(entry))
  );
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function protectedTrackedPathsClean(): boolean {
  const result = spawnSync(
    "git",
    ["diff", "--quiet", "--", "prompts/episode/plan.md", "roles.yaml"],
    { cwd: resolve(HARNESS_ROOT, ".."), encoding: "utf8" },
  );
  return result.status === 0;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
