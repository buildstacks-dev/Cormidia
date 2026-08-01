import type { ReportSnapshotV1 } from "./types.js";

export function renderReportTerminal(report: ReportSnapshotV1): string {
  const scope = report.scope.kind === "org" ? `org ${report.org.name}` : `app ${report.scope.app}`;
  const lines = [
    `Operon report — ${scope}`,
    `${report.range.from_inclusive.slice(0, 10)} through ${new Date(new Date(report.range.to_exclusive).getTime() - 1).toISOString().slice(0, 10)} UTC · as of ${report.generated_at}`,
    "",
    `Known tokens  in ${formatInt(report.headline.known_input_tokens)} · out ${formatInt(report.headline.known_output_tokens)} · total ${formatInt(report.headline.known_total_tokens)}`,
    `Recorded equivalent cost  $${report.headline.recorded_equivalent_cost_usd.toFixed(2)} (reported $${report.headline.provider_reported_cost_usd.toFixed(2)} · estimated $${report.headline.operon_estimated_cost_usd.toFixed(2)} · partial $${report.headline.partial_recorded_cost_usd.toFixed(2)})`,
    `Activity  ${report.headline.provider_turns} settled provider turn(s) · ${report.headline.sessions} session(s) · ${report.headline.completed_sessions} completed`,
  ];
  if (report.scope.kind === "app" && report.apps[0] !== undefined) {
    const app = report.apps[0];
    lines.push(`Current month budget  $${app.current_month_spend_usd.toFixed(2)} / $${app.monthly_budget_usd.toFixed(2)} (${app.budget_percent.toFixed(1)}%, ${app.budget_status}, ${app.budget_paused ? "PAUSED" : "active"})`);
  } else {
    const warn = report.apps.filter((app) => app.budget_status !== "ok");
    lines.push(`Current month budgets  ${warn.length} app(s) warning or exceeded`);
  }
  if (report.quality.notices.length > 0) {
    lines.push("", "Data quality", ...report.quality.notices.slice(0, 5).map((notice) => `  - ${notice}`));
  }
  if (report.validation_campaigns.reports.length > 0 || report.validation_campaigns.corrupt.length > 0) {
    lines.push("", "Validation campaigns");
    for (const campaign of report.validation_campaigns.reports) {
      const verdict = campaign.outcome.verdict === "inconclusive"
        ? "INCONCLUSIVE (NOT A PASS; NOT RELEASE EVIDENCE)"
        : campaign.outcome.verdict.toUpperCase();
      lines.push(
        `  ${campaign.campaign_id} · ${campaign.lane} · ${verdict} · completeness ${campaign.outcome.completeness} · ` +
        `${campaign.coverage.collected_case_ids.length}/${campaign.coverage.required_case_ids.length} cases`,
      );
    }
    for (const corrupt of report.validation_campaigns.corrupt) {
      lines.push(`  ${corrupt.campaign_id} · CORRUPT (EVIDENCE INCOMPLETE) · ${corrupt.detail}`);
    }
    lines.push("  Triage: docs/qualification/validation-triage.md");
  }
  lines.push("", "Efficiency evidence");
  for (const [name, metric] of Object.entries(report.efficiency.metrics)) {
    lines.push(
      `  ${name}  ${metric.numerator}/${metric.denominator} · ${metric.status}` +
        (metric.value === null ? "" : ` · ${(metric.value * 100).toFixed(1)}%`),
      `    excluded: ${metric.excluded_ids.join(", ") || "none"}`,
      `    missing: ${metric.missing_inputs.join(", ") || "none"}`,
    );
  }
  lines.push(
    `  repeated_work_cost_usd  ${report.efficiency.repeated_work_cost_usd === null ? "invalid measurement" : `$${report.efficiency.repeated_work_cost_usd.toFixed(2)}`}`,
    `  context_by_category  ${report.efficiency.context_by_category.map((row) => `${row.category}=${row.rendered_bytes}B/${row.components}`).join(" · ") || "none"}`,
  );
  for (const episode of report.efficiency.episodes) {
    lines.push(
      `  ${episode.episode_id}  route ${episode.planned_route ?? "missing"} -> ${episode.current_route ?? "missing"} -> ${episode.final_route ?? "missing"} · ${episode.provider_turns} provider / ${episode.mechanical_steps} mechanical · ${episode.route_variances} variance(s) · ${episode.terminal_status ?? "incomplete"}`,
      ...(episode.issues.length === 0 ? [] : [`    issues: ${episode.issues.join(", ")}`]),
    );
  }
  for (const [name, ids] of Object.entries(report.efficiency.issues)) {
    if (ids.length > 0) lines.push(`  ${name}: ${ids.join(", ")}`);
  }
  const allocation = (report.scope.kind === "org" ? report.breakdowns.by_app : report.breakdowns.by_role).slice(0, 5);
  if (allocation.length > 0) {
    lines.push("", `Top ${report.scope.kind === "org" ? "apps" : "roles"}`);
    for (const row of allocation) lines.push(`  ${row.label.padEnd(28)} ${formatInt(row.known_total_tokens).padStart(12)} tokens  $${row.recorded_equivalent_cost_usd.toFixed(2).padStart(8)}  ${row.turns} turn(s)`);
  }
  if (report.sessions.items.length > 0) {
    lines.push("", "Recent sessions");
    for (const session of report.sessions.items.slice(0, 5)) lines.push(`  ${session.id} · ${session.outcome} · ${session.provider_turns} turn(s) · $${session.recorded_equivalent_cost_usd.toFixed(2)}`);
  }
  return lines.join("\n");
}

function formatInt(value: number): string { return Math.round(value).toLocaleString("en-US"); }
