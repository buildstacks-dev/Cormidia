import { formatStatusRows, readStatusRows } from "../runtime/runlog/status.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolve } from "node:path";
import { approvalLifecycleState, ApprovalStore } from "../org/approvals.js";
import { listTicketClaimStates } from "../loop/rehydrate.js";
import { rearmCommand } from "../loop/claim-recovery.js";
import { readEfficiencyEvidence } from "../loop/efficiency.js";
import { readEpisodeReplanJournal } from "../loop/episode-replan.js";
import { isOverlayPaused, rollupBudgets } from "../org/budget.js";
import { readValidationCampaignReports } from "../org/validation-campaign.js";
import { readRoadmapExplanation } from "../org/roadmap-explanation.js";
import { listPlannerPublications } from "../org/planner-publication.js";

export async function cmdStatus(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "status");
  const parsed = parseArgs(common.rest);
  const homes = common.orgHome !== undefined || common.stateHome === undefined
    ? await resolveCormidiaHomes(common)
    : undefined;
  const stateHome = common.stateHome ? resolve(common.stateHome) : homes!.stateHome;
  const rows = await readStatusRows(stateHome, {
    ...(parsed.app !== undefined ? { app: parsed.app } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  });
  const approvals = (await new ApprovalStore(stateHome).listDecidedReadOnly())
    .filter((item) => item.execution !== undefined)
    .filter((item) => parsed.app === undefined || item.app === parsed.app);
  const approvalDelivery = approvals.map((item) => ({
    id: item.id,
    app: item.app,
    state: approvalLifecycleState(item),
    attempts: item.execution!.attempts,
    actor: item.execution!.actor ?? null,
    attemptedAt: item.execution!.attemptedAt ?? null,
    result: item.execution!.result ?? null,
    failureCause: item.execution!.failureCause ?? null,
    nextAction: item.execution!.nextAction,
  }));
  const claimRecovery = listTicketClaimStates(stateHome, parsed.app).filter((entry) => {
    const latest = entry.state.events?.at(-1);
    return entry.state.active !== undefined || entry.state.continuation !== undefined ||
      latest?.kind === "automatic_recovery" || latest?.kind === "manual_rearm";
  }).map((entry) => {
    const state = entry.state;
    const latest = state.events?.at(-1);
    const mode = state.active !== undefined
      ? `active:${state.active.phase}`
      : state.continuation !== undefined
        ? `approval:${state.continuation.status}`
        : latest?.kind ?? "idle";
    const needsExplicitRearm = latest?.detail.includes("explicit") === true;
    const allowance = state.claimAllowance ?? state.claims;
    return {
      app: entry.app,
      issueNumber: entry.issueNumber,
      mode,
      claims: state.claims,
      allowance: state.claimAllowance ?? null,
      next: latest?.detail ?? "inspect ticket state",
      rearmCommand: needsExplicitRearm
        ? rearmCommand({ app: entry.app, issueNumber: entry.issueNumber, allowance })
        : null,
    };
  });
  const episodeReplans = (await Promise.all(
    (await readEfficiencyEvidence(stateHome))
      .filter((episode) =>
        episode.route !== null &&
        (parsed.app === undefined || episode.route.app === parsed.app))
      .map(async (episode) => {
        const route = episode.route!;
        const journal = await readEpisodeReplanJournal(stateHome, route.episode_id);
        if (journal === undefined) return undefined;
        const latest = journal.records.at(-1);
        if (latest === undefined) return undefined;
        return {
          app: route.app,
          episodeId: route.episode_id,
          kind: latest.trigger.kind,
          status: latest.status,
          revisionVersion: latest.revisionVersion,
          reason: latest.reason,
          updatedAt: journal.updatedAt,
        };
      }),
  )).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.episodeId.localeCompare(right.episodeId));
  const budget = homes === undefined ? [] : await Promise.all(
    (await rollupBudgets(stateHome, homes.appsFile)).map(async (row) => ({
      ...row,
      paused: await isOverlayPaused(stateHome, row.app),
    })),
  );
  const validationCampaigns = await readValidationCampaignReports(stateHome);
  const roadmapExplanation = await readRoadmapExplanation(
    stateHome,
    parsed.app !== undefined
      ? [parsed.app]
      : homes?.appsFile.apps.map((app) => app.name) ?? [],
  );
  const plannerPublications = await listPlannerPublications(stateHome, parsed.app);
  const report = {
    schema_version: 1,
    kind: "status",
    stateHome,
    filters: { app: parsed.app ?? null, limit: parsed.limit ?? null },
    runCount: rows.length,
    runs: rows,
    approvalDelivery,
    claimRecovery,
    episodeReplans,
    budget,
    validationCampaigns,
    roadmapExplanation,
    plannerPublications,
  } as const;
  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatStatusRows(report.runs));
  if (report.approvalDelivery.length > 0) {
    console.log("\nAPPROVAL DELIVERY");
    for (const item of report.approvalDelivery) {
      console.log(
        `${item.id} ${item.app} ${item.state} ` +
        `attempt=${item.attempts} actor=${item.actor ?? "-"} ` +
        `at=${item.attemptedAt ?? "-"} result=${item.result ?? "-"} ` +
        `cause=${item.failureCause ?? "-"} next=${item.nextAction}`,
      );
    }
  }
  if (report.plannerPublications.length > 0) {
    console.log("\nPLANNER PUBLICATION");
    for (const publication of report.plannerPublications) {
      console.log(
        `${publication.publication_id} ${publication.app} ${publication.state} ` +
        `${publication.branch_created ? `${publication.branch}@${publication.commit}` : "read-only"}`,
      );
      if (publication.error !== null) {
        console.log(`  ${publication.error.code}: ${publication.error.message}`);
      }
      if (publication.state !== "published") console.log(`  ${publication.recovery.command}`);
    }
  }
  if (report.claimRecovery.length > 0) {
    console.log("\nCLAIM RECOVERY");
    for (const entry of report.claimRecovery) {
      console.log(
        `${entry.app}#${entry.issueNumber} ${entry.mode} claims=${entry.claims} ` +
        `allowance=${entry.allowance ?? "route-policy"} next=${entry.next}`,
      );
      if (entry.rearmCommand !== null) console.log(`  ${entry.rearmCommand}`);
    }
  }
  if (report.episodeReplans.length > 0) {
    console.log("\nEPISODE REPLANS");
    for (const entry of report.episodeReplans) {
      console.log(
        `${entry.app} ${entry.episodeId} ${entry.status} ${entry.kind} ` +
        `revision=${entry.revisionVersion ?? "-"} at=${entry.updatedAt} ` +
        `reason=${entry.reason ?? "-"}`,
      );
    }
  }
  if (report.budget.length > 0) {
    console.log("\nBUDGET ADMISSION");
    for (const row of report.budget) {
      console.log(
        `${row.app} ${row.status.toUpperCase()} spent=$${row.spentUsd.toFixed(2)} ` +
        `budget=$${row.budgetUsd.toFixed(2)} admission=${row.paused ? "PAUSED" : "active"}`,
      );
    }
  }
  if (report.validationCampaigns.reports.length > 0 || report.validationCampaigns.corrupt.length > 0) {
    console.log("\nVALIDATION CAMPAIGNS");
    for (const campaign of report.validationCampaigns.reports) {
      const verdict = campaign.outcome.verdict === "inconclusive"
        ? "INCONCLUSIVE (NOT A PASS; NOT RELEASE EVIDENCE)"
        : campaign.outcome.verdict.toUpperCase();
      console.log(
        `${campaign.campaign_id} ${campaign.lane} ${verdict} ` +
        `completeness=${campaign.outcome.completeness} cases=${campaign.coverage.collected_case_ids.length}/${campaign.coverage.required_case_ids.length} ` +
        `spend=${campaign.spend.observed_provider_turns}/${campaign.spend.max_provider_turns} turns $${campaign.spend.observed_equiv_usd.toFixed(2)}/$${campaign.spend.max_equiv_usd.toFixed(2)}`,
      );
    }
    for (const corrupt of report.validationCampaigns.corrupt) {
      console.log(`${corrupt.campaign_id} CORRUPT (EVIDENCE INCOMPLETE) ${corrupt.detail}`);
    }
    console.log("Triage: docs/qualification/validation-triage.md");
  }
  if (report.roadmapExplanation.apps.length > 0) {
    console.log("\nROADMAP / VALIDATION / DELIVERY");
    for (const app of report.roadmapExplanation.apps) {
      console.log(`${app.app} source=${app.source.status} roadmap=${app.roadmap_plan?.durable_ref ?? "unavailable"}`);
      if (app.source.affected_claims.length > 0) {
        console.log(`  affected=${app.source.affected_claims.join(",")} detail=${app.source.detail}`);
      }
      for (const batch of app.batches) {
        console.log(`  batch=${batch.batch_id} complete=${batch.complete} every-unit-success=${batch.every_unit_success ?? "unknown"}`);
      }
      for (const unit of app.delivery_units) {
        console.log(
          `  unit=${unit.unit_id} kind=${unit.kind} validation=${unit.artifact_authority.validation_contract?.durable_ref ?? "unavailable"} ` +
          `fast-path=${unit.fast_path.reason} cache=${unit.cache_evidence.measurement} ` +
          `routing-excluded=${unit.routing_exclusion.excluded ?? "unknown"} recovery=${unit.recovery.state} labels=projection-only`,
        );
      }
    }
  }
  return 0;
}

interface ParsedStatusArgs {
  app?: string;
  limit?: number;
  json: boolean;
}

function parseArgs(args: string[]): ParsedStatusArgs {
  const out: ParsedStatusArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--limit") out.limit = parseLimit(needValue(args, ++i, "--limit"));
    else if (arg === "--json") out.json = true;
    else throw new Error(`status: unknown argument "${arg}"`);
  }
  return out;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("status: --limit must be a positive integer");
  return parsed;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`status: ${flag} requires a value`);
  return value;
}
