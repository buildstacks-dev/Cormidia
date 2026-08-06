import {
  explainEpisode,
  type EpisodeExplanation,
  type ExplainedEpisodeStep,
} from "../org/episode-planner/orchestrator.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

/** Read-only durable EpisodePlan explanation. Planning and delivery remain at
 * the owning entry point; this command never constructs a runtime.
 *
 * The explainer is total: degraded evidence is rendered and annotated rather
 * than aborting the whole report (ISSUE-025). An incomplete explanation is
 * still a failure for automation, so it exits non-zero. */
export async function cmdEpisode(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "episode");
  const [verb, episodeId, ...rest] = common.rest;
  if (verb !== "explain" || episodeId === undefined) {
    throw new Error("episode: usage: cormidia episode explain <episode-id> [--json]");
  }
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else throw new Error(`episode: unknown flag ${JSON.stringify(arg)}`);
  }
  const homes = await resolveCormidiaHomes(common);
  const explanation = await explainEpisode(homes.stateHome, episodeId);
  if (json) {
    console.log(JSON.stringify(explanation, null, 2));
    return explanation.complete ? 0 : 1;
  }
  renderExplanation(explanation);
  return explanation.complete ? 0 : 1;
}

function renderExplanation(explanation: EpisodeExplanation): void {
  console.log(`episode: ${explanation.episodeId}`);
  console.log(`evidence: ${explanation.evidenceDir}`);
  const plan = explanation.plan;
  if (plan === null) {
    console.log("plan: none (no accepted durable EpisodePlan)");
  } else {
    console.log(`plan: v${plan.version} ${explanation.planningSource}`);
    console.log(`workflow: ${plan.workflowClass}`);
    console.log(`budget: $${plan.estimatedBudget.totalBudgetUsd.toFixed(2)} estimated`);
    console.log(`safety route: ${plan.derivedSafetyRoute.label}`);
  }
  const route = explanation.route;
  if (route !== null) {
    const terminal = route.terminal === null ? "active" : `terminal ${route.terminal.status}`;
    console.log(`route: ${route.current_route} ${terminal}`);
  }
  if (explanation.journal !== null) {
    console.log(`execution: ${explanation.journal.status}`);
  }
  const latestReplan = explanation.replanJournal?.records.at(-1);
  if (latestReplan !== undefined) {
    console.log(
      `replan: ${latestReplan.trigger.id} ${latestReplan.status}` +
        (latestReplan.revisionVersion === null ? "" : ` -> v${latestReplan.revisionVersion}`) +
        (latestReplan.reason === null ? "" : ` — ${latestReplan.reason}`),
    );
  }
  for (const step of explanation.steps) console.log(renderStep(step));
  if (explanation.executionSteps.length > 0) {
    console.log(`durable execution steps (${explanation.executionSteps.length}):`);
    for (const record of explanation.executionSteps) {
      const assignment =
        record.assignment === null
          ? record.kind
          : `${record.assignment.harness}/${record.assignment.model}/${record.assignment.effort}`;
      const planRef = record.planStepId === null ? "" : ` plan v${record.planVersion ?? "?"}/${record.planStepId}`;
      console.log(`  ${record.startedAt} ${record.status} ${record.operation} ${assignment}${planRef}`);
    }
  }
  if (explanation.problems.length > 0) {
    console.log(`incomplete explanation (${explanation.problems.length} unresolved):`);
    for (const problem of explanation.problems) {
      const where = problem.stepId === null ? "" : ` [${problem.stepId}]`;
      console.log(`  ${problem.code}${where}: ${problem.message}`);
    }
  }
}

function renderStep(step: ExplainedEpisodeStep): string {
  if (step.kind === "mechanical_gate") {
    return `${step.id}: ${step.status} mechanical gate ${step.gate}`;
  }
  if (step.kind === "approval") {
    return `${step.id}: ${step.status} approval ${step.approvalKind} (${step.actionRef})`;
  }
  const annotation =
    step.authorizationDetail === null ? "" : ` (assignment ${step.authorizationStatus}: ${step.authorizationDetail})`;
  return (
    `${step.id}: ${step.status} provider ${step.role} ` +
    `${step.assignment.harness}/${step.assignment.model}/${step.assignment.effort} ` +
    `[${step.assignmentSource}] — ${step.selectionReason}${annotation}`
  );
}
