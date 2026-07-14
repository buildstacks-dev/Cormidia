import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { deleteSession as deleteClaudeSession } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntime } from "../../src/runtime/adapters/claude.js";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { PiRuntime } from "../../src/runtime/adapters/pi.js";
import { runRole } from "../../src/loop/runRole.js";
import type { RoleConfig, Runtime, TurnHooks, TurnRequest, TurnResult } from "../../src/runtime/types.js";
import { gradeLibrary, gradeService } from "../../eval/graders/index.js";
import { grade as gradeApprovalSemantics } from "../../eval/graders/approval-semantics.js";
import { grade as gradeContextDelta } from "../../eval/graders/context-delta.js";
import { grade as gradeContinuation } from "../../eval/graders/continuation.js";
import { grade as gradeLearningClosure } from "../../eval/graders/learning-closure.js";
import { grade as gradePlanQuality } from "../../eval/graders/plan-quality.js";
import { grade as gradeStandingRoles } from "../../eval/graders/standing-roles.js";
import { grade as gradeStandard } from "../../eval/graders/standard-slug-options.js";
import {
  hashManifest,
  sha256,
  loadYamlFile,
  validateResult,
  writeAttemptResult,
  type AttemptResult,
  type CampaignManifest,
  type EvalCaseManifest,
} from "./core.js";
import { makeEvalActorGate, makeEvalRoleGate } from "./safety.js";
import {
  AdapterCalibrationExecutionError,
  calibrateAdapter,
  calibrationPassed,
  type AdapterCalibrationScenario,
} from "./adapter-calibration.js";
import { probeAdapterBoundary } from "./adapter-boundary-probe.js";
import { simulateVirtualSoak } from "./virtual-soak.js";
import { evalAppNetworkPolicy, runEvalAppGates } from "./app-gates.js";
import { scrubSecrets, truncatePreview } from "../../src/runtime/runlog/redact.js";
import { withEvalProviderEnvironment } from "./provider-scratch.js";

export interface LiveExecutionOptions {
  root: string;
  manifestPath: string;
  maxUsd: number;
  evalRoot: string;
  runtimeFactory?: (role: RoleConfig) => Runtime;
  hiddenGrader?: (caseId: string, workdir: string) => boolean | Promise<boolean>;
  visibleGate?: (manifest: EvalCaseManifest, workdir: string) => boolean;
  forbiddenProductionPaths?: string[];
  expectedCampaignSha256?: string;
  claudeProcessEnv?: NodeJS.ProcessEnv;
  claudeProtectedHome?: string;
  /** Test injection point. The production path uses the Claude SDK's exact
   * session deletion after calibration evidence is durable. */
  claudeSessionDeleter?: (sessionId: string, options: { dir: string }) => Promise<void>;
}

/**
 * Execute provider work through Operon's ordinary pass executor. The executor
 * owns run envelopes, L2/L3 evidence and exactly-once provider settlement;
 * this eval layer only admits attempts, invokes hidden oracles outside actor
 * context and writes immutable campaign results.
 */
export async function executeLiveCampaign(options: LiveExecutionOptions): Promise<{
  attempts: AttemptResult[];
  product_cost_usd: number;
  evaluator_cost_usd: number;
}> {
  const campaign = loadYamlFile(options.manifestPath) as CampaignManifest;
  const campaignSha256 = hashManifest(campaign);
  if (options.expectedCampaignSha256 !== undefined && campaignSha256 !== options.expectedCampaignSha256) throw new Error("campaign_hash_changed_before_execution");
  const campaignRoot = join(options.root, ".eval-artifacts", campaign.campaign_id);
  const attempts: AttemptResult[] = [];
  let productCost = 0;
  let evaluatorCost = 0;
  let retriesUsed = 0;
  let turnClockTick = 0;
  const claudePolicy = claudeSessionPolicy(campaign.profile, options.claudeProcessEnv);
  if (
    campaign.profile === "adapter-conformance" &&
    campaign.assignments.some((assignment) => assignment.runtime === "claude") &&
    options.runtimeFactory === undefined &&
    options.claudeProcessEnv === undefined
  ) {
    throw new Error("adapter_conformance_claude_environment_required");
  }
  const runtimeFactory = options.runtimeFactory ?? ((role: RoleConfig) =>
    runtimeFor(
      role,
      claudePolicy.processEnv,
      options.claudeProtectedHome,
      claudePolicy.persistSession,
    ));
  const claudeSessionDeleter = options.claudeSessionDeleter ??
    (options.runtimeFactory === undefined && claudePolicy.persistSession
      ? (sessionId: string, deletionOptions: { dir: string }) =>
          withEvalProviderEnvironment(
            claudePolicy.processEnv,
            () => deleteClaudeSession(sessionId, deletionOptions),
          )
      : undefined);
  const visibleGate = options.visibleGate ?? ((manifest: EvalCaseManifest, workdir: string) => visibleCommands(manifest, workdir, options.root));

  if (campaign.profile === "adapter-conformance") {
    return executeAdapterCampaign();
  }

  for (const item of campaign.cases) {
    const caseManifest = findCase(options.root, item.case_id);
    for (const repetitionId of item.repetition_ids) {
      const attemptId = `${safe(item.case_id)}-${safe(repetitionId)}`;
      const resultPath = join(campaignRoot, "results", `${attemptId}.json`);
      if (existsSync(resultPath)) {
        const resultDir = join(campaignRoot, "results");
        const retainedNames = readdirSync(resultDir).filter((name) => name === `${attemptId}.json` || name.startsWith(`${attemptId}-retry-`)).sort();
        for (const name of retainedNames) {
          const retained = JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult;
          const errors = validateResult(retained);
          if (errors.length > 0 || retained.campaign_sha256 !== campaignSha256) throw new Error(`invalid_retained_attempt: ${retained.attempt_id}: ${errors.join("; ")}`);
          attempts.push(retained);
          productCost += metric(retained, "cost", "product_usd");
          evaluatorCost += metric(retained, "cost", "evaluator_usd");
          if (retained.retry_of !== undefined) retriesUsed += 1;
        }
        continue;
      }

      const admittedAt = new Date().toISOString();
      const upper = campaign.spend.case_max_usd[item.case_id];
      if (upper === undefined || productCost + evaluatorCost + upper > options.maxUsd) {
        const stopped = makeResult(campaign, campaignSha256, attemptId, item.case_id, repetitionId, "budget_stop", admittedAt, ["harness:campaign_cap_cannot_cover_remaining_upper_bound"], excludedMetrics(caseManifest.route.expected));
        persist(stopped);
        attempts.push(stopped);
        continue;
      }

      if (item.case_id.startsWith("learning/")) {
        const miss = makeResult(campaign, campaignSha256, attemptId, item.case_id, repetitionId, "product_miss", admittedAt, ["harness:efficiency_learning_signal_absent"], zeroTurnMetrics(caseManifest.route.expected, item.case_id));
        persist(miss);
        attempts.push(miss);
        continue;
      }
      if (caseManifest.route.expected === "mechanical") {
        const artifactRel = join("artifact", `${attemptId}.json`); mkdirSync(join(campaignRoot, "artifact"), { recursive: true });
        if (item.case_id === "soak/virtual-seven-day/v1") {
          const soak = simulateVirtualSoak(); const passed = soak.executed_or_reasoned === soak.due_ticks && soak.duplicate_ticks === 0 && soak.silent_misses === 0 && soak.orphaned_runs === 0 && soak.mechanical_provider_leakage === 0 && soak.cross_app_budget_leaks === 0;
          writeFileSync(join(campaignRoot, artifactRel), `${JSON.stringify(soak, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          const result = makeResult(campaign, campaignSha256, attemptId, item.case_id, repetitionId, passed ? "passed" : "harness_error", admittedAt, [`artifact:${artifactRel}`], virtualSoakMetrics(soak, passed));
          persist(result); attempts.push(result); continue;
        }
        writeFileSync(join(campaignRoot, artifactRel), `${JSON.stringify({ schema_version: 1, case_id: item.case_id, result: "production_mechanical_surface_absent" })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        const result = makeResult(campaign, campaignSha256, attemptId, item.case_id, repetitionId, "product_miss", admittedAt, [`artifact:${artifactRel}`], zeroTurnMetrics("mechanical", item.case_id)); persist(result); attempts.push(result); continue;
      }

      const template = caseManifest.app.template.replace("operon-eval-", "");
      const task = readFileSync(join(options.root, "eval", caseManifest.episode.task_ref), "utf8");
      const stateRoot = join(campaignRoot, "state");
      const telemetry = { orgDir: stateRoot, trigger: "manual" as const };
      let retryOf: string | undefined;
      for (let runNumber = 0; ; runNumber += 1) {
        const runAttemptId = runNumber === 0 ? attemptId : `${attemptId}-retry-${runNumber}`;
        if (runNumber > 0 && productCost + evaluatorCost + upper > options.maxUsd) break;
        const workdir = join(options.evalRoot, "managed", runAttemptId);
        if (existsSync(workdir)) throw new Error(`unsettled_attempt_workdir_exists: ${runAttemptId}`);
        mkdirSync(workdir, { recursive: true });
        cpSync(join(options.root, "eval/apps", template, "seed"), workdir, { recursive: true });
        initializeGit(workdir);
        const actorGate = makeEvalActorGate({ workdir, forbiddenRoots: [join(options.root, "eval"), join(options.root, "test"), join(options.root, "research"), ...(options.forbiddenProductionPaths ?? [])] });
        const gateFor = (roleName: string) => makeEvalRoleGate(roleName, actorGate);
        if (!visibleGate(caseManifest, workdir)) { const failed = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, "harness_error", runNumber === 0 ? admittedAt : new Date().toISOString(), ["harness:pristine_visible_gate_failed"], zeroTurnMetrics(caseManifest.route.expected, item.case_id), retryOf); persist(failed); attempts.push(failed); break; }
        let builder: TurnResult | undefined;
        let reviewer: TurnResult | undefined;
        const extraTurns: TurnResult[] = [];
        let continuationInterrupted = !item.case_id.startsWith("continuation/");
        let outcome: AttemptResult["outcome"] = "product_miss";
        let failureCode: string | undefined;
        const evidence: string[] = [];
        const phaseObservations: PhaseObservation[] = [];
        const observedRun = async (kind: PhaseObservation["kind"], request: Parameters<typeof runRole>[0]) => { const before = artifactFingerprint(workdir); const run = await runRole(request); const after = artifactFingerprint(workdir); if (run.record) phaseObservations.push({ kind, result: run.record.result, before, after }); return run; };
        try {
          const primaryRoleName = roleForCase(item.case_id, repetitionId);
          const delivery = shouldIndependentReview(item.case_id);
          const builderRole = roleFor(primaryRoleName, campaign, item.case_id.startsWith("continuation/") ? upper / 2 : delivery ? upper / 3 : upper);
          const builderGate = gateFor(builderRole.name);
          if (item.case_id.startsWith("continuation/")) {
            const controller = new AbortController(); let abortIssued = false;
            const interruptedRun = await observedRun("interruption", { role: builderRole, app: template, turnId: `eval-${runAttemptId}-${primaryRoleName}-interrupted`, dryRun: false, workdir, runlogRoot: stateRoot, runtimeFor: runtimeFactory, hooks: { gate: builderGate, onProgress: () => { if (!abortIssued) { abortIssued = true; controller.abort("declared live continuation sample"); } } }, context: { taste: [], memoryExcerpts: [] }, telemetry, clock: nextTurnClock(), signal: controller.signal, briefOverride: `${task}\n\nBegin the declared sampled interruption through the ordinary Operon pass boundary. Preserve any durable artifact already created. Do not publish, deploy, or access sibling paths.` });
            if (interruptedRun.record) { evidence.push(`run:${interruptedRun.record.runId}`); extraTurns.push(interruptedRun.record.result); productCost += interruptedRun.record.result.usage.costUsd; continuationInterrupted = ["cancelled", "timed_out"].includes(interruptedRun.record.result.status); }
          }
          let contractReady = true;
          if (delivery) {
            const contractRun = await observedRun("contract", { role: builderRole, app: template, turnId: `eval-${runAttemptId}-${primaryRoleName}-contract`, dryRun: false, workdir, runlogRoot: stateRoot, runtimeFor: runtimeFactory, hooks: { gate: builderGate }, context: { taste: [], memoryExcerpts: [] }, telemetry, clock: nextTurnClock(), briefOverride: `${task}\n\nContract pass only. Inspect the isolated worktree and write eval-contract.md with binary acceptance criteria, scope, checks, and any genuine approval boundary. Do not implement product changes, publish, deploy, or access sibling paths.` });
            if (contractRun.record) {
              const contract = contractRun.record.result;
              evidence.push(`run:${contractRun.record.runId}`);
              extraTurns.push(contract);
              productCost += contract.usage.costUsd;
              if (contract.status !== "completed") {
                contractReady = false;
                const stop = classifyTurnStop(contract);
                if (stop) { outcome = stop.outcome; failureCode = stop.code; evidence.push(`harness:${stop.code}`, persistError(runAttemptId, turnFailureDetail(contract))); }
                else if (contract.status === "blocked_on_gate") outcome = "safety_stop";
              }
            }
          }
          if (contractReady) {
            const builderRun = await observedRun("implementation", { role: builderRole, app: template, turnId: `eval-${runAttemptId}-${primaryRoleName}-implement`, dryRun: false, workdir, runlogRoot: stateRoot, runtimeFor: runtimeFactory, hooks: { gate: builderGate }, context: { taste: [], memoryExcerpts: [] }, telemetry, clock: nextTurnClock(), briefOverride: `${task}\n\nImplementation pass. Follow the durable eval-contract.md when present, operate only inside this eval worktree, implement the requested change, and run bounded checks. Do not publish, deploy, or access sibling paths.` });
            builder = builderRun.record?.result;
            if (builderRun.record) evidence.push(`run:${builderRun.record.runId}`);
            productCost += builder?.usage.costUsd ?? 0;
            const builderStop = classifyTurnStop(builder);
            if (builderStop) { outcome = builderStop.outcome; failureCode = builderStop.code; evidence.push(`harness:${builderStop.code}`, persistError(runAttemptId, turnFailureDetail(builder))); }
            else {
              const visible = builder?.status === "completed" && visibleGate(caseManifest, workdir);
              const graderPassed = visible && await (options.hiddenGrader ?? gradeLiveCase)(item.case_id, workdir);
              const graderRel = join("grader", `${runAttemptId}.json`); mkdirSync(join(campaignRoot, "grader"), { recursive: true });
              writeFileSync(join(campaignRoot, graderRel), `${JSON.stringify({ schema_version: 1, case_id: item.case_id, attempt_id: runAttemptId, visible, hidden: graderPassed })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); evidence.push(`grader:${graderRel}`);
              if (graderPassed && shouldIndependentReview(item.case_id)) {
                const reviewerRole = roleFor("reviewer", campaign, upper / 3);
                const reviewerRun = await observedRun("review", { role: reviewerRole, app: template, turnId: `eval-${runAttemptId}-reviewer`, dryRun: false, workdir, runlogRoot: stateRoot, runtimeFor: runtimeFactory, hooks: { gate: gateFor(reviewerRole.name) }, context: { taste: [], memoryExcerpts: [] }, telemetry, clock: nextTurnClock(), briefOverride: `Independently review this eval-only change against the task below. Inspect the worktree and run bounded checks. Do not modify files or perform outward actions. Return a concise verdict.\n\n${task}` });
                reviewer = reviewerRun.record?.result;
                if (reviewerRun.record) evidence.push(`run:${reviewerRun.record.runId}`);
                evaluatorCost += reviewer?.usage.costUsd ?? 0;
                const reviewerStop = classifyTurnStop(reviewer);
                if (reviewerStop) { outcome = reviewerStop.outcome; failureCode = reviewerStop.code; evidence.push(`harness:${reviewerStop.code}`, persistError(runAttemptId, turnFailureDetail(reviewer))); }
                else outcome = reviewer?.status === "completed" && reviewer.escalations.length === 0 ? "passed" : reviewer?.status === "blocked_on_gate" ? "safety_stop" : "product_miss";
              } else if (graderPassed) outcome = "passed";
              else if (builder?.status === "blocked_on_gate") outcome = "safety_stop";
              if (!continuationInterrupted) outcome = "product_miss";
            }
          }
        } catch (error) {
          failureCode = typedError(error); evidence.push(`harness:${failureCode}`, persistError(runAttemptId, error)); outcome = failureCode === "harness_error" ? "harness_error" : "infra_invalid";
        }
        const metrics = turnMetrics(item.case_id, caseManifest.route.expected, task, builder, reviewer, extraTurns, phaseObservations);
        const attempt = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, outcome, runNumber === 0 ? admittedAt : new Date().toISOString(), evidence, metrics, retryOf);
        persist(attempt); attempts.push(attempt);
        if (outcome !== "infra_invalid" || !isRetryable(failureCode) || retriesUsed >= campaign.infrastructure_retries) break;
        retryOf = attemptId; retriesUsed += 1;
      }
    }
  }

  return { attempts, product_cost_usd: productCost, evaluator_cost_usd: evaluatorCost };

  function persist(value: AttemptResult): void {
    writeAttemptResult(join(campaignRoot, "results", `${value.attempt_id}.json`), value);
  }
  function persistError(attemptId: string, error: unknown): string {
    const rel = join("errors", `${attemptId}.json`);
    const path = join(campaignRoot, rel);
    mkdirSync(dirname(path), { recursive: true });
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = raw.replaceAll(campaignRoot, "<campaign-root>").replaceAll(options.root, "<package-root>");
    const payload = `${JSON.stringify({ schema_version: 1, attempt_id: attemptId, detail: scrubSecrets(truncatePreview(normalized, 2_000)) }, null, 2)}\n`;
    if (existsSync(path)) {
      if (readFileSync(path, "utf8") !== payload) throw new Error(`error_evidence_conflict: ${attemptId}`);
    } else {
      writeFileSync(path, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    return `artifact:${rel}`;
  }
  function nextTurnClock(): () => Date { const at = new Date(Date.now() + turnClockTick * 1_000); turnClockTick += 1; return () => at; }

  async function executeAdapterCampaign(): Promise<{ attempts: AttemptResult[]; product_cost_usd: number; evaluator_cost_usd: number }> {
    const declared = campaign.cases.flatMap((item) => item.repetition_ids.map((repetitionId) => ({ item, repetitionId })));
    const perAdapterCap = Math.min(options.maxUsd, campaign.spend.campaign_max_usd) / (declared.length + campaign.infrastructure_retries);
    for (const { item, repetitionId } of declared) {
      const attemptId = `${safe(item.case_id)}-${safe(repetitionId)}`;
      const resultPath = join(campaignRoot, "results", `${attemptId}.json`);
      let retryOf: string | undefined;
      let firstRunNumber = 0;
      if (existsSync(resultPath)) {
        const resultDir = join(campaignRoot, "results");
        const retainedNames = readdirSync(resultDir).filter((name) => name === `${attemptId}.json` || name.startsWith(`${attemptId}-retry-`)).sort();
        let last: AttemptResult | undefined;
        for (const name of retainedNames) {
          const retained = JSON.parse(readFileSync(join(resultDir, name), "utf8")) as AttemptResult;
          const errors = validateResult(retained);
          if (errors.length > 0 || retained.campaign_sha256 !== campaignSha256) throw new Error(`invalid_retained_attempt: ${retained.attempt_id}: ${errors.join("; ")}`);
          attempts.push(retained); productCost += metric(retained, "cost", "product_usd"); last = retained;
          if (retained.retry_of !== undefined) retriesUsed += 1;
        }
        const code = last?.evidence.find((ref) => ref.startsWith("harness:"))?.slice("harness:".length);
        if (!last || last.retry_of !== undefined || last.outcome !== "infra_invalid" || !isRetryable(code) || retriesUsed >= campaign.infrastructure_retries) continue;
        retryOf = attemptId; retriesUsed += 1; firstRunNumber = 1;
      }
      const assignment = campaign.assignments.find((candidate) => candidate.runtime === repetitionId || candidate.role === `${repetitionId}-probe`);
      if (!assignment || !["claude", "codex", "pi"].includes(assignment.runtime)) throw new Error(`adapter_assignment_missing: ${repetitionId}`);
      const role: RoleConfig = { name: assignment.role, runtime: assignment.runtime as RoleConfig["runtime"], model: assignment.model, effort: assignment.effort as RoleConfig["effort"], delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd: perAdapterCap };
      const admittedAt = new Date().toISOString();
      for (let runNumber = firstRunNumber; ; runNumber += 1) {
        const runAttemptId = runNumber === 0 ? attemptId : `${attemptId}-retry-${runNumber}`;
        if (productCost + perAdapterCap > options.maxUsd) {
          if (runNumber === 0) { const stopped = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, "budget_stop", admittedAt, ["harness:campaign_cap_cannot_cover_remaining_upper_bound"], excludedMetrics("standard")); persist(stopped); attempts.push(stopped); }
          break;
        }
        const workdir = join(options.evalRoot, "managed", runAttemptId);
        if (existsSync(workdir)) {
          const interrupted = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, "infra_invalid", new Date().toISOString(), ["harness:unsettled_attempt_workdir_after_process_exit"], adapterMetrics([], 0, "unavailable"), retryOf);
          persist(interrupted); attempts.push(interrupted); break;
        }
        mkdirSync(workdir, { recursive: true }); cpSync(join(options.root, "eval/apps/library/seed"), workdir, { recursive: true }); initializeGit(workdir);
        const adapterCase = findCase(options.root, item.case_id); if (!visibleGate(adapterCase, workdir)) { const failed = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, "harness_error", runNumber === 0 ? admittedAt : new Date().toISOString(), ["harness:pristine_visible_gate_failed"], zeroTurnMetrics("standard", item.case_id), retryOf); persist(failed); attempts.push(failed); break; }
        const gate = makeEvalActorGate({ workdir, forbiddenRoots: [join(options.root, "eval"), join(options.root, "test"), join(options.root, "research"), ...(options.forbiddenProductionPaths ?? [])] });
        let failureCode: string | undefined;
        let observedTurns: TurnResult[] = [];
        const observedClaudeSessionIds = new Set<string>();
        let sessionCleanupAttempted = false;
        const runRefs: string[] = [];
        let boundaryRel: string | undefined;
        const cleanupClaudeSessions = async (
          turns: readonly TurnResult[],
          policy: "exact_sdk_delete_after_grader_evidence" | "exact_sdk_delete_after_failure",
        ): Promise<string | undefined> => {
          if (repetitionId !== "claude" || claudeSessionDeleter === undefined) return undefined;
          sessionCleanupAttempted = true;
          const deleted = await deleteClaudeCalibrationSessions(
            turns,
            workdir,
            claudeSessionDeleter,
            observedClaudeSessionIds,
          );
          const cleanupRel = join("cleanup", `${runAttemptId}.json`);
          mkdirSync(join(campaignRoot, "cleanup"), { recursive: true });
          writeFileSync(join(campaignRoot, cleanupRel), `${JSON.stringify({
            schema_version: 1,
            attempt_id: runAttemptId,
            policy,
            sessions_deleted: deleted.length,
            session_id_sha256: deleted.map((id) => sha256(id)),
          }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          return cleanupRel;
        };
        try {
          const runtime = runtimeFactory(role);
          const stateRoot = join(campaignRoot, "state");
          const telemetry = { orgDir: stateRoot, trigger: "manual" as const };
          const recordedInvoke = async (
            request: TurnRequest,
            hooks: TurnHooks,
            scenario: AdapterCalibrationScenario,
          ): Promise<TurnResult> => {
            const recordedRuntime: Runtime = {
              kind: runtime.kind,
              runTurn: (ownedRequest, ownedHooks) =>
                runtime.runTurn(
                  {
                    ...ownedRequest,
                    ...(request.session !== undefined ? { session: request.session } : {}),
                    ...(request.maxTurns !== undefined ? { maxTurns: request.maxTurns } : {}),
                    ...(request.networkAccess !== undefined
                      ? { networkAccess: request.networkAccess }
                      : {}),
                  },
                  ownedHooks,
                ),
            };
            const observedHooks: TurnHooks = {
              ...hooks,
              onProgress: (progress) => {
                if (progress.session?.runtime === "claude") {
                  observedClaudeSessionIds.add(progress.session.id);
                }
                hooks.onProgress?.(progress);
              },
            };
            const run = await runRole({
              role: request.role,
              app: "adapter-calibration",
              turnId: `eval-${runAttemptId}-${scenario}`,
              dryRun: false,
              workdir,
              runlogRoot: stateRoot,
              runtimeFor: () => recordedRuntime,
              hooks: observedHooks,
              context: request.context,
              telemetry,
              clock: nextTurnClock(),
              signal: request.signal,
              briefOverride: request.task,
            });
            if (run.record === undefined) {
              throw new Error(`adapter_record_missing: ${scenario}`);
            }
            runRefs.push(`run:${run.record.runId}`);
            return run.record.result;
          };
          const boundaryEvidence = await probeAdapterBoundary({
            runtime: role.runtime,
            workdir,
            gate,
          });
          const persistedBoundaryRel = join("artifact", `${runAttemptId}-adapter-boundary.json`);
          boundaryRel = persistedBoundaryRel;
          mkdirSync(join(campaignRoot, "artifact"), { recursive: true });
          writeFileSync(
            join(campaignRoot, persistedBoundaryRel),
            `${JSON.stringify(boundaryEvidence, null, 2)}\n`,
            { encoding: "utf8", flag: "wx", mode: 0o600 },
          );
          const evidence = await calibrateAdapter({
            runtime,
            role,
            workdir,
            gate,
            invoke: recordedInvoke,
            boundaryEvidence,
          });
          observedTurns = evidence.turns;
          const cost = evidence.turns.reduce((sum, turn) => sum + turn.usage.costUsd, 0);
          const outcome: AttemptResult["outcome"] = calibrationPassed(evidence) ? "passed" : "product_miss";
          const graderRel = join("grader", `${runAttemptId}.json`); mkdirSync(join(campaignRoot, "grader"), { recursive: true });
          const result = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, outcome, runNumber === 0 ? admittedAt : new Date().toISOString(), [`provider:${repetitionId}-adapter-calibration`, `artifact:${persistedBoundaryRel}`, ...runRefs, `grader:${graderRel}`], adapterMetrics(evidence.turns, evidence.large_payload_bytes, evidence.usage_quality, { cache: evidence.cache_capability_observed, role_shaping_probe: evidence.role_shaping_probe, role_shaping_claim: evidence.role_shaping_claim }, 1), retryOf);
          const resultErrors = validateResult(result);
          if (resultErrors.length > 0) {
            throw new Error(`adapter_result_invalid: ${resultErrors.join("; ")}`);
          }
          writeFileSync(join(campaignRoot, graderRel), `${JSON.stringify({ ...evidence, run_ids: runRefs.map((ref) => ref.slice("run:".length)), turns: evidence.turns.map((turn) => ({ status: turn.status, usage: turn.usage, errorCode: turn.errorCode })) }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          const cleanupRel = await cleanupClaudeSessions(
            evidence.turns,
            "exact_sdk_delete_after_grader_evidence",
          );
          if (cleanupRel !== undefined) result.evidence.push(`artifact:${cleanupRel}`);
          persist(result); attempts.push(result); productCost += cost; break;
        } catch (error) {
          const partial = error instanceof AdapterCalibrationExecutionError ? error.turns : observedTurns;
          const cost = partial.reduce((sum, turn) => sum + turn.usage.costUsd, 0); productCost += cost;
          let cause = error instanceof AdapterCalibrationExecutionError ? error.causeValue : error;
          let cleanupRel: string | undefined;
          if (repetitionId === "claude" && claudeSessionDeleter !== undefined && !sessionCleanupAttempted) {
            try {
              cleanupRel = await cleanupClaudeSessions(
                partial,
                "exact_sdk_delete_after_failure",
              );
            } catch (cleanupError) {
              void cleanupError;
              cause = new Error("claude_session_cleanup_failed");
            }
          }
          failureCode = typedError(cause);
          const outcome: AttemptResult["outcome"] = failureCode === "provider_budget_stop" ? "budget_stop" : failureCode === "harness_error" ? "harness_error" : "infra_invalid";
          const result = makeResult(campaign, campaignSha256, runAttemptId, item.case_id, repetitionId, outcome, runNumber === 0 ? admittedAt : new Date().toISOString(), [
            ...(boundaryRel === undefined ? [] : [`artifact:${boundaryRel}`]),
            ...runRefs,
            ...(cleanupRel === undefined ? [] : [`artifact:${cleanupRel}`]),
            `harness:${failureCode}`,
            persistError(runAttemptId, cause),
          ], adapterMetrics(
            partial,
            error instanceof AdapterCalibrationExecutionError ? error.largePayloadBytes : 0,
            partial.length === 0 ? "unavailable" : usageQuality(partial),
            {},
            boundaryRel === undefined ? 0 : 1,
          ), retryOf);
          persist(result); attempts.push(result);
          if (outcome !== "infra_invalid" || !isRetryable(failureCode) || retriesUsed >= campaign.infrastructure_retries) break;
          retryOf = attemptId; retriesUsed += 1;
        }
      }
    }
    return { attempts, product_cost_usd: productCost, evaluator_cost_usd: 0 };
  }
}

function runtimeFor(
  role: RoleConfig,
  claudeProcessEnv?: NodeJS.ProcessEnv,
  claudeProtectedHome?: string,
  persistClaudeSession = false,
): Runtime {
  if (role.runtime === "codex") return new CodexRuntime();
  if (role.runtime === "claude") {
    return new ClaudeRuntime({
      baseOptions: {
        settingSources: [],
        skills: [],
        plugins: [],
        persistSession: persistClaudeSession,
        ...(claudeProcessEnv !== undefined ? { env: claudeProcessEnv } : {}),
      },
      ...(claudeProtectedHome !== undefined ? { protectedHome: claudeProtectedHome } : {}),
    });
  }
  return new PiRuntime();
}

export function claudeSessionPersistence(profile: CampaignManifest["profile"]): boolean {
  return profile === "adapter-conformance";
}

export function claudeSessionPolicy(
  profile: CampaignManifest["profile"],
  baseEnv: NodeJS.ProcessEnv | undefined,
): { persistSession: boolean; processEnv: NodeJS.ProcessEnv } {
  const persistSession = claudeSessionPersistence(profile);
  const processEnv = { ...(baseEnv ?? process.env) };
  if (persistSession) {
    // The continuation probe requires the CLI transcript. This exception is
    // paired with exact SDK deletion immediately after grader evidence is
    // durable; all other live profiles keep prompt/session history disabled.
    delete processEnv.CLAUDE_CODE_SKIP_PROMPT_HISTORY;
  } else {
    processEnv.CLAUDE_CODE_SKIP_PROMPT_HISTORY = "1";
  }
  return { persistSession, processEnv };
}

export async function deleteClaudeCalibrationSessions(
  turns: readonly TurnResult[],
  workdir: string,
  deleter: (sessionId: string, options: { dir: string }) => Promise<void>,
  observedSessionIds: Iterable<string> = [],
): Promise<string[]> {
  const sessionIds = [...new Set([
    ...turns
      .map((turn) => turn.session)
      .filter((session) => session.runtime === "claude")
      .map((session) => session.id),
    ...observedSessionIds,
  ])];
  for (const sessionId of sessionIds) {
    try {
      await deleter(sessionId, { dir: workdir });
    } catch {
      throw new Error("claude_session_cleanup_failed");
    }
  }
  return sessionIds;
}

function roleFor(name: string, campaign: CampaignManifest, maxTurnBudgetUsd: number): RoleConfig {
  const assignment = campaign.assignments.find((item) => item.role === name);
  if (!assignment || !["codex", "claude", "pi"].includes(assignment.runtime)) throw new Error(`missing_assignment: ${name}`);
  return {
    name,
    runtime: assignment.runtime as RoleConfig["runtime"],
    model: assignment.model,
    effort: assignment.effort as RoleConfig["effort"],
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd,
  };
}

function roleForCase(caseId: string, repetitionId: string): string {
  if (caseId.startsWith("planning/")) return "planner";
  if (caseId.startsWith("context/delta/")) { if (repetitionId.startsWith("claude-")) return "reviewer"; if (repetitionId.startsWith("pi-")) return "support"; return "builder"; }
  if (caseId.startsWith("roles/standing/")) {
    if (repetitionId.startsWith("sre")) return "sre";
    if (repetitionId.startsWith("support")) return "support";
    if (repetitionId.startsWith("marketing")) return "marketing";
  }
  return "builder";
}
function shouldIndependentReview(caseId: string): boolean { return caseId.startsWith("quick/") || caseId.startsWith("standard/") || caseId.startsWith("deep/") || caseId.startsWith("approval/"); }

function initializeGit(cwd: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "add", "-A"], { cwd });
  execFileSync("git", ["-c", "user.name=Operon Eval", "-c", "user.email=eval@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "eval seed"], { cwd, stdio: "ignore" });
}

function visibleCommands(manifest: EvalCaseManifest, cwd: string, root: string): boolean {
  try {
    const app = manifest.app.template.replace(/^operon-eval-/, "");
    const network = evalAppNetworkPolicy(manifest.side_effect_policy.network);
    runEvalAppGates({ cwd, seedDir: join(root, "eval/apps", app, "seed"), commands: manifest.oracle.visible_commands, network });
    return true;
  } catch {
    return false;
  }
}

export async function gradeLiveCase(caseId: string, root: string): Promise<boolean> {
  try {
    if (caseId.startsWith("quick/")) return gradeLibrary(root);
    if (caseId.startsWith("standard/")) return gradeStandard(root);
    if (caseId.startsWith("deep/")) return await gradeService(root);
    if (caseId.startsWith("planning/")) return gradePlanQuality(root);
    if (caseId.startsWith("context/")) return gradeContextDelta(root);
    if (caseId.startsWith("continuation/")) return gradeContinuation(root);
    if (caseId.startsWith("approval/")) return gradeApprovalSemantics(root);
    if (caseId.startsWith("learning/")) return gradeLearningClosure(root);
    if (caseId.startsWith("roles/")) return gradeStandingRoles(root);
    return false;
  } catch {
    return false;
  }
}

function makeResult(campaign: CampaignManifest, hash: string, attemptId: string, caseId: string, repetitionId: string, outcome: AttemptResult["outcome"], admittedAt: string, evidence: string[], metrics: Record<string, unknown>, retryOf?: string): AttemptResult {
  const latency = typeof metrics.latency === "object" && metrics.latency !== null && !Array.isArray(metrics.latency) ? metrics.latency as Record<string, unknown> : undefined;
  const elapsed = typeof latency?.elapsed_ms === "number" && Number.isFinite(latency.elapsed_ms) && latency.elapsed_ms >= 0 ? latency.elapsed_ms : undefined;
  const terminalAt = elapsed === undefined ? new Date().toISOString() : new Date(Date.parse(admittedAt) + elapsed).toISOString();
  return { schema_version: 1, campaign_id: campaign.campaign_id, campaign_sha256: hash, attempt_id: attemptId, case_id: caseId, repetition_id: repetitionId, outcome, admitted_at: admittedAt, terminal_at: terminalAt, evidence, metrics, exclusions: [], missing: [], ...(retryOf !== undefined ? { retry_of: retryOf } : {}) };
}

interface PhaseObservation { kind: "interruption" | "contract" | "implementation" | "review"; result: TurnResult; before: string; after: string }
function turnMetrics(caseId: string, route: string, task: string, builder?: TurnResult, reviewer?: TurnResult, extraTurns: TurnResult[] = [], observations: PhaseObservation[] = []): Record<string, unknown> {
  const turns = [...extraTurns, builder, reviewer].filter((value): value is TurnResult => value !== undefined);
  const product = (builder?.usage.costUsd ?? 0) + extraTurns.reduce((sum, turn) => sum + turn.usage.costUsd, 0);
  const evaluator = reviewer?.usage.costUsd ?? 0;
  const active = turns.reduce((sum, turn) => sum + turn.usage.wallClockMs, 0);
  const productiveObservations = observations.filter((item) => item.result.status === "completed" && item.result.escalations.length === 0 && (item.kind === "review" || item.before !== item.after));
  const productive = productiveObservations.length;
  const duplicateCost = observations.filter((item) => item.result.status === "completed" && item.kind !== "review" && item.before === item.after).reduce((sum, item) => sum + item.result.usage.costUsd, 0);
  const escalations = turns.flatMap((turn) => turn.escalations);
  const approvalKeys = escalations.map((item) => JSON.stringify(item.action));
  const approvalUnique = new Set(approvalKeys).size;
  const excluded = (reason: string) => ({ excluded: [reason] });
  return {
    route: { planned: route, final: route, model_turns: turns.length },
    context: { rendered_bytes: Buffer.byteLength(task), sources: { task: Buffer.byteLength(task) } },
    cost: { equivalent_usd: product + evaluator, product_usd: product, evaluator_usd: evaluator, quality: usageQuality(turns) },
    tokens: { input: turns.reduce((sum, turn) => sum + turn.usage.tokensIn, 0), output: turns.reduce((sum, turn) => sum + turn.usage.tokensOut, 0), quality: usageQuality(turns) },
    latency: { elapsed_ms: active, active_ms: active, human_wait_ms: 0 },
    human_load: { decisions: 0 },
    productivity: { productive_passes: productive, total_passes: turns.length, ratio: turns.length === 0 ? 0 : productive / turns.length, repeated_work_cost_usd: duplicateCost, evidence: observations.map((item) => ({ kind: item.kind, before_sha256: item.before, after_sha256: item.after, productive: productiveObservations.includes(item) })) },
    continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: builder?.status === "completed" && extraTurns.some((turn) => turn.status === "cancelled" || turn.status === "timed_out") ? 1 : 0, ratio: builder?.status === "completed" && extraTurns.some((turn) => turn.status === "cancelled" || turn.status === "timed_out") ? 1 : 0 } : excluded("not_continuation_case"),
    approvals: caseId.startsWith("approval/") ? { valid_requests: approvalUnique, total_requests: approvalKeys.length, precision: approvalKeys.length === 0 ? 0 : approvalUnique / approvalKeys.length, recurrence: approvalKeys.length - approvalUnique } : excluded("not_approval_case"),
    scheduler: excluded("not_scheduler_case"),
    learning: excluded("not_learning_case"),
    execution: { terminal_integrity: 1, provider_turns: turns.length, mechanical_steps: 0, provider_settlements: turns.length, mechanical_settlements: 0 },
  };
}

function zeroTurnMetrics(route: string, caseId: string): Record<string, unknown> {
  const excluded = (reason: string) => ({ excluded: [reason] });
  return { route: { planned: route, final: route, model_turns: 0 }, context: { rendered_bytes: 0, sources: {} }, cost: { equivalent_usd: 0, product_usd: 0, evaluator_usd: 0, quality: "complete" }, tokens: excluded("no_provider_turn"), latency: { elapsed_ms: 0, active_ms: 0, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: excluded("no_provider_turn"), continuation: caseId.startsWith("continuation/") ? { eligible: 1, resumed_without_repeat: 0, ratio: 0 } : excluded("not_continuation_case"), approvals: caseId.startsWith("approval/") ? { valid_requests: 0, total_requests: 0, precision: 0, recurrence: 0 } : excluded("not_approval_case"), scheduler: caseId.startsWith("soak/") ? { due_ticks: 0, reasoned_ticks: 0, reliability: 0 } : excluded("not_scheduler_case"), learning: caseId.startsWith("learning/") ? { eligible_capture: 1, captured: 0, capture_ratio: 0, effect_delta: 0 } : excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: 0, mechanical_steps: 1, provider_settlements: 0, mechanical_settlements: 0 } };
}

function adapterMetrics(turns: TurnResult[], renderedBytes: number, quality: string, capabilities: Record<string, unknown> = {}, mechanicalSteps = 0): Record<string, unknown> {
  const cost = turns.reduce((sum, turn) => sum + turn.usage.costUsd, 0);
  const active = turns.reduce((sum, turn) => sum + turn.usage.wallClockMs, 0); const excluded = (reason: string) => ({ excluded: [reason] });
  return { route: { planned: "standard", final: "standard", model_turns: turns.length }, context: { rendered_bytes: renderedBytes, sources: { calibration_task: renderedBytes } }, cost: { equivalent_usd: cost, product_usd: cost, evaluator_usd: 0, quality }, tokens: { input: turns.reduce((sum, turn) => sum + turn.usage.tokensIn, 0), output: turns.reduce((sum, turn) => sum + turn.usage.tokensOut, 0), quality }, latency: { elapsed_ms: active, active_ms: active, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: excluded("adapter_calibration_not_product_work"), continuation: excluded("not_continuation_case"), approvals: excluded("not_approval_case"), scheduler: excluded("not_scheduler_case"), learning: excluded("not_learning_case"), execution: { terminal_integrity: 1, provider_turns: turns.length, mechanical_steps: mechanicalSteps, provider_settlements: turns.length, mechanical_settlements: 0 }, capabilities };
}
function artifactFingerprint(cwd: string): string { const diff = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd, encoding: "utf8" }); const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8" }).split("\0").filter((path) => path !== "" && !path.startsWith(".eval-harness/")); const rows = untracked.sort().map((path) => { const stat = lstatSync(join(cwd, path)); return stat.isSymbolicLink() ? `${path}\0symlink` : stat.isFile() ? `${path}\0${sha256(readFileSync(join(cwd, path)))}` : `${path}\0special`; }); return `sha256:${sha256(`${diff}\n${rows.join("\n")}`)}`; }
function virtualSoakMetrics(soak: ReturnType<typeof simulateVirtualSoak>, passed: boolean): Record<string, unknown> { const excluded = (reason: string) => ({ excluded: [reason] }); return { route: { planned: "mechanical", final: "mechanical", model_turns: 0 }, context: { rendered_bytes: 0, sources: {} }, cost: { equivalent_usd: 0, product_usd: 0, evaluator_usd: 0, quality: "complete" }, tokens: excluded("no_provider_turn"), latency: { elapsed_ms: 7 * 24 * 60 * 60 * 1_000, active_ms: 0, human_wait_ms: 0 }, human_load: { decisions: 0 }, productivity: excluded("no_provider_turn"), continuation: excluded("not_continuation_case"), approvals: excluded("not_approval_case"), scheduler: { due_ticks: soak.due_ticks, reasoned_ticks: soak.executed_or_reasoned, reliability: soak.due_ticks === 0 ? 0 : soak.executed_or_reasoned / soak.due_ticks, duplicate_ticks: soak.duplicate_ticks, simulated_provider_turns: soak.provider_turns }, learning: excluded("not_learning_case"), execution: { terminal_integrity: passed ? 1 : 0, provider_turns: 0, mechanical_steps: soak.due_ticks, provider_settlements: 0, mechanical_settlements: 0 } }; }

function excludedMetrics(route: string): Record<string, unknown> {
  const excluded = ["not_admitted_due_to_budget"];
  return { route: { planned: route, final: route, excluded }, context: { excluded }, cost: { excluded }, tokens: { excluded }, latency: { excluded }, human_load: { excluded }, productivity: { excluded }, continuation: { excluded }, approvals: { excluded }, scheduler: { excluded }, learning: { excluded }, execution: { excluded, provider_turns: 0, mechanical_steps: 1, provider_settlements: 0, mechanical_settlements: 0 } };
}

function usageQuality(turns: TurnResult[]): string {
  const qualities = turns.map((turn) => turn.usage.quality ?? (turn.usage.costEstimated ? "estimated" : "complete"));
  if (qualities.includes("unavailable")) return "unavailable";
  if (qualities.includes("partial")) return "partial";
  if (qualities.includes("estimated")) return "estimated";
  return "complete";
}

function metric(result: AttemptResult, group: string, key: string): number {
  const parent = result.metrics[group];
  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) return 0;
  const value = (parent as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safe(value: string): string { return value.replaceAll(/[^a-zA-Z0-9_-]+/g, "-"); }
function classifyTurnStop(result: TurnResult | undefined): { outcome: AttemptResult["outcome"]; code: string } | undefined {
  if (!result || result.status === "completed" || result.status === "blocked_on_gate") return undefined;
  const detail = `${result.errorCode ?? ""} ${result.summary}`.toLowerCase();
  if (detail.includes("budget")) return { outcome: "budget_stop", code: "provider_budget_stop" };
  if (detail.includes("auth") || detail.includes("login")) return { outcome: "infra_invalid", code: "provider_unauthenticated" };
  if (result.status === "timed_out" || detail.includes("timeout")) return { outcome: "infra_invalid", code: "provider_timeout" };
  if (result.status === "cancelled") return { outcome: "infra_invalid", code: "provider_cancelled" };
  return { outcome: "infra_invalid", code: "provider_transport_failure" };
}
function turnFailureDetail(result: TurnResult): Error {
  return new Error(`${result.errorCode ?? "provider_turn_failed"}: ${result.summary}`);
}
function isRetryable(code: string | undefined): boolean { return code === "provider_timeout" || code === "provider_transport_failure"; }
function typedError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error);
  if (message.includes("budget")) return "provider_budget_stop";
  if (message.includes("auth") || message.includes("login")) return "provider_unauthenticated";
  if (message.includes("timeout")) return "provider_timeout";
  if (/transport|connect|econn|socket|app server|provider|sdk|e2big|argument list|argv|spawn/.test(message)) return "provider_transport_failure";
  return "harness_error";
}

function findCase(root: string, caseId: string): EvalCaseManifest {
  let found: EvalCaseManifest | undefined;
  visit(join(root, "eval/cases"));
  if (!found) throw new Error(`case_not_found: ${caseId}`);
  return found;
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".yaml")) {
        const value = loadYamlFile(path) as EvalCaseManifest;
        if (value.case_id === caseId) found = value;
      }
    }
  }
}
