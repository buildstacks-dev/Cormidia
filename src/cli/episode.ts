import { explainEpisode } from "../org/episode-planner/orchestrator.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

/** Read-only durable EpisodePlan explanation. Planning and delivery remain at
 * the owning entry point; this command never constructs a runtime. */
export async function cmdEpisode(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "episode");
  const [verb, episodeId, ...rest] = common.rest;
  if (verb !== "explain" || episodeId === undefined) {
    throw new Error("episode: usage: operon episode explain <episode-id> [--json]");
  }
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else throw new Error(`episode: unknown flag ${JSON.stringify(arg)}`);
  }
  const homes = await resolveOperonHomes(common);
  const explanation = await explainEpisode(homes.stateHome, episodeId);
  if (json) {
    console.log(JSON.stringify(explanation, null, 2));
    return 0;
  }
  console.log(`episode: ${explanation.episodeId}`);
  console.log(`plan: v${explanation.plan.version} ${explanation.planningSource}`);
  console.log(`workflow: ${explanation.plan.workflowClass}`);
  console.log(`budget: $${explanation.plan.estimatedBudget.totalBudgetUsd.toFixed(2)} estimated`);
  console.log(`safety route: ${explanation.plan.derivedSafetyRoute.label}`);
  for (const step of explanation.steps) {
    if (step.kind === "provider_turn") {
      console.log(
        `${step.id}: ${step.status} provider ${step.role} ` +
          `${step.assignment.harness}/${step.assignment.model}/${step.assignment.effort} ` +
          `[${step.assignmentSource}] — ${step.selectionReason}`,
      );
    } else if (step.kind === "mechanical_gate") {
      console.log(`${step.id}: ${step.status} mechanical gate ${step.gate}`);
    } else {
      console.log(`${step.id}: ${step.status} approval ${step.approvalKind} (${step.actionRef})`);
    }
  }
  return 0;
}
