import { createHash } from "node:crypto";
import type { ReportBreakdownV1, ReportSessionDetailV1, ReportSnapshotV1 } from "./types.js";

export function renderReportHtml(report: ReportSnapshotV1): string {
  const json = safeJson(report);
  const styleHash = hash(CSS);
  const scriptHash = hash(JS);
  const scope = report.scope.kind === "org" ? report.org.name : `${report.org.name} / ${report.scope.app}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${styleHash}'; script-src 'sha256-${scriptHash}'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>Cormidia report — ${esc(scope)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>
<header><div><strong class="wordmark">CORMIDIA REPORTS</strong><span class="marker">READ ONLY · TOKEN FREE · AS OF</span></div><p>${esc(scope)} · ${esc(report.generated_at)}</p></header>
<main id="main" class="scroll">
<p class="confidential"><strong>Confidential operational metadata.</strong> Portable local projection; no external requests. Equivalent cost is not a provider invoice.</p>
${quality(report)}
${validationCampaigns(report)}
${roadmapExplanation(report)}
<section aria-labelledby="headline"><h1 id="headline">Usage overview</h1><div class="metrics">${metric("Known input", formatInt(report.headline.known_input_tokens))}${metric("Known output", formatInt(report.headline.known_output_tokens))}${metric("Known total", formatInt(report.headline.known_total_tokens))}${metric("Equivalent cost", money(report.headline.recorded_equivalent_cost_usd), `reported ${money(report.headline.provider_reported_cost_usd)} · estimated ${money(report.headline.cormidia_estimated_cost_usd)} · partial ${money(report.headline.partial_recorded_cost_usd)}`)}${metric("Provider turns", String(report.headline.provider_turns), `${report.headline.unknown_usage_turns} unknown usage`)}${metric("Sessions", String(report.headline.sessions), `${report.headline.completed_sessions} completed`)}</div></section>
${efficiency(report)}
${budget(report)}
${trend(report)}
${allocations(report)}
${health(report)}
${portfolio(report)}
<section aria-labelledby="sessions"><div class="heading"><h2 id="sessions">Sessions</h2><label>Filter <input id="session-filter" type="search" autocomplete="off" placeholder="ID, app, role, model, status"></label></div><p id="session-count" aria-live="polite"></p><div id="session-list">${report.session_details.map(sessionHtml).join("\n") || `<p class="empty">No correlated sessions in this range.</p>`}</div></section>
${report.unattributed_turns.length === 0 ? "" : `<section><h2>Unattributed turns</h2><p>Legacy ledger rows remain in org accounting but cannot be assigned to a presentation session.</p>${turnTable(report.unattributed_turns)}</section>`}
<section><h2>Report contract</h2><dl><dt>Range</dt><dd>${esc(report.range.from_inclusive)} to ${esc(report.range.to_exclusive)} (exclusive), UTC</dd><dt>Bucket</dt><dd>${esc(report.range.bucket)}</dd><dt>Schema</dt><dd>ReportSnapshotV${report.schema_version}</dd><dt>Fingerprint</dt><dd><code>${esc(report.source_fingerprint)}</code></dd><dt>Regenerate</dt><dd><code>${esc(regenerationCommand(report))}</code></dd></dl></section>
</main>
<script id="report-data" type="application/json">${json}</script>
<script>${JS}</script>
</body></html>\n`;
}

function roadmapExplanation(report: ReportSnapshotV1): string {
  if (report.roadmap_explanation.apps.length === 0) return "";
  return report.roadmap_explanation.apps.map((app) => {
    const batches = app.batches.map((batch) =>
      `<tr><td><code>${esc(batch.batch_id)}</code></td><td>${batch.complete}</td><td>${batch.every_unit_success === null ? "unknown" : batch.every_unit_success}</td><td>${esc(batch.authority.durable_ref)}</td></tr>`,
    ).join("");
    const units = app.delivery_units.map((unit) =>
      `<tr><td><code>${esc(unit.unit_id)}</code><br><small>${esc(unit.kind)}</small></td><td>${esc(unit.artifact_authority.validation_contract?.durable_ref ?? "unavailable")}</td><td>${esc(unit.fast_path.reason)}<br><small>workflow bypass: ${unit.fast_path.workflow_bypassed ?? "unknown"}</small></td><td>${esc(unit.cache_evidence.measurement)}<br><small>cost-affinity only; unknown is not zero</small></td><td>${unit.routing_exclusion.excluded ?? "unknown"}<br><small>${esc(unit.routing_exclusion.reasons.join(", ") || "none")}</small></td><td>${esc(unit.recovery.state)}</td><td>projection only: ${esc(unit.label_projection.labels.join(", ") || "none")}</td></tr>`,
    ).join("");
    return `<section class="quality" aria-labelledby="roadmap-${esc(app.app)}"><h1 id="roadmap-${esc(app.app)}">Roadmap / validation / delivery · ${esc(app.app)}</h1><p><strong>Source ${esc(app.source.status)}.</strong> ${esc(app.source.detail)}${app.source.affected_claims.length === 0 ? "" : ` Affected claims: ${esc(app.source.affected_claims.join(", "))}.`}</p><p>Roadmap authority: <code>${esc(app.roadmap_plan?.durable_ref ?? "unavailable")}</code>. Labels below are projections, never authority.</p><h2>Batches</h2><div class="scroll"><table><thead><tr><th>Batch</th><th>Complete</th><th>Every unit successful</th><th>Authority</th></tr></thead><tbody>${batches}</tbody></table></div><h2>Delivery units</h2><div class="scroll"><table><thead><tr><th>Unit</th><th>Validation authority</th><th>Fast path</th><th>Cache evidence</th><th>Routing exclusion</th><th>Recovery</th><th>Labels</th></tr></thead><tbody>${units}</tbody></table></div></section>`;
  }).join("");
}

function efficiency(report: ReportSnapshotV1): string {
  const metrics = Object.entries(report.efficiency.metrics).map(([name, value]) =>
    `<tr><th>${esc(name)}</th><td>${value.numerator} / ${value.denominator}</td><td>${value.value === null ? "—" : `${(value.value * 100).toFixed(1)}%`}</td><td>${esc(value.status)}</td><td>${esc(value.excluded_ids.join(", ") || "none")}</td><td>${esc(value.missing_inputs.join(", ") || "none")}</td></tr>`,
  ).join("");
  const episodes = report.efficiency.episodes.map((episode) =>
    `<tr><td><code>${esc(episode.episode_id)}</code><br><small>${esc(episode.evidence)}</small></td><td>${esc(episode.planned_route ?? "missing")} → ${esc(episode.current_route ?? "missing")} → ${esc(episode.final_route ?? "missing")}</td><td>${episode.route_variances}</td><td>${episode.provider_turns} / ${episode.mechanical_steps}</td><td>${esc(episode.terminal_status ?? "incomplete")}</td><td>${esc(episode.issues.join(", ") || "none")}</td></tr>`,
  ).join("");
  const context = report.efficiency.context_by_category.map((row) =>
    `<tr><td>${esc(row.category)}</td><td>${formatInt(row.rendered_bytes)}</td><td>${row.components}</td><td>${esc(row.run_ids.join(", "))}</td></tr>`,
  ).join("");
  const issueRows = Object.entries(report.efficiency.issues)
    .filter(([, ids]) => ids.length > 0)
    .map(([name, ids]) => `<dt>${esc(name)}</dt><dd>${esc(ids.join(", "))}</dd>`)
    .join("");
  return `<section aria-labelledby="efficiency"><h2 id="efficiency">Efficiency and invariant evidence</h2><p>Repeated-work cost: <strong>${report.efficiency.repeated_work_cost_usd === null ? "invalid measurement" : money(report.efficiency.repeated_work_cost_usd)}</strong>. Missing evidence is named and never treated as zero.</p><div class="scroll"><table><thead><tr><th>Metric</th><th>Numerator / denominator</th><th>Value</th><th>Status</th><th>Excluded identities</th><th>Missing inputs</th></tr></thead><tbody>${metrics}</tbody></table></div><h3>Episodes and route variance</h3><div class="scroll"><table><thead><tr><th>Episode</th><th>Planned → current → final</th><th>Variances</th><th>Provider / mechanical</th><th>Terminal</th><th>Issues</th></tr></thead><tbody>${episodes}</tbody></table></div><h3>Context attribution</h3><div class="scroll"><table><thead><tr><th>Category</th><th>Rendered bytes</th><th>Components</th><th>Run identities</th></tr></thead><tbody>${context}</tbody></table></div>${issueRows === "" ? "" : `<details><summary>Named incomplete and invalid evidence</summary><dl>${issueRows}</dl></details>`}</section>`;
}

function quality(report: ReportSnapshotV1): string {
  const items = report.quality.notices.length > 0 ? report.quality.notices : ["No source-quality issue was detected; provider invoice agreement is still not implied."];
  return `<section class="quality" aria-labelledby="quality"><h1 id="quality">Data quality · ${esc(report.quality.overall)}</h1><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><details><summary>Diagnostics and coverage</summary><dl><dt>Observable / provider turns</dt><dd>${report.quality.observable_turns} / ${report.headline.provider_turns}</dd><dt>Duplicates</dt><dd>${report.quality.duplicate_rows}</dd><dt>Corrupt / torn</dt><dd>${report.quality.corrupt_lines} / ${report.quality.torn_tails}</dd><dt>Missing run detail</dt><dd>${report.quality.missing_envelopes}</dd><dt>Unsettled passes</dt><dd>${report.quality.unsettled_passes}</dd><dt>Retained ledger range</dt><dd>${esc(report.quality.retained_from ?? "none")} – ${esc(report.quality.retained_to ?? "none")}</dd></dl></details></section>`;
}

function validationCampaigns(report: ReportSnapshotV1): string {
  const campaigns = report.validation_campaigns.reports;
  const corrupt = report.validation_campaigns.corrupt;
  if (campaigns.length === 0 && corrupt.length === 0) return "";
  const rows = campaigns.map((campaign) => {
    const verdict = campaign.outcome.verdict === "inconclusive"
      ? "INCONCLUSIVE — NOT A PASS; NOT RELEASE EVIDENCE"
      : campaign.outcome.verdict.toUpperCase();
    return `<tr><td><code>${esc(campaign.campaign_id)}</code></td><td>${esc(campaign.lane)}</td><td><strong>${esc(verdict)}</strong></td><td>${esc(campaign.outcome.completeness)}</td><td>${campaign.coverage.collected_case_ids.length} / ${campaign.coverage.required_case_ids.length}</td><td>${campaign.spend.observed_provider_turns} / ${campaign.spend.max_provider_turns} turns · ${money(campaign.spend.observed_equiv_usd)} / ${money(campaign.spend.max_equiv_usd)}</td></tr>`;
  });
  rows.push(...corrupt.map((item) =>
    `<tr><td><code>${esc(item.campaign_id)}</code></td><td>—</td><td><strong>CORRUPT — EVIDENCE INCOMPLETE</strong></td><td>incomplete</td><td>—</td><td>${esc(item.detail)}</td></tr>`,
  ));
  return `<section class="quality" aria-labelledby="validation-campaigns"><h1 id="validation-campaigns">Validation campaigns</h1><p>An inconclusive campaign is not a pass and is never release evidence. Triage: <code>docs/qualification/validation-triage.md</code>.</p><div class="scroll"><table><thead><tr><th>Campaign</th><th>Lane</th><th>Verdict</th><th>Completeness</th><th>Cases</th><th>Spend / evidence</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></section>`;
}

function trend(report: ReportSnapshotV1): string {
  const maximum = Math.max(1, ...report.trend.map((row) => (row.known_input_tokens ?? 0) + (row.known_output_tokens ?? 0)));
  const bars = report.trend.map((row) => {
    const total = (row.known_input_tokens ?? 0) + (row.known_output_tokens ?? 0);
    return `<div class="bar-row"><span>${esc(row.start.slice(0, 10))}</span><progress max="${maximum}" value="${Math.max(0, total)}">${Math.max(0, total)}</progress><span>${row.source_quality === "gap" ? "source gap" : formatInt(total)}</span></div>`;
  }).join("");
  const table = `<table><thead><tr><th>Bucket UTC</th><th>Input</th><th>Output</th><th>Reported</th><th>Estimated</th><th>Partial</th><th>Turns</th><th>Quality</th></tr></thead><tbody>${report.trend.map((row) => `<tr><td>${esc(row.start)} – ${esc(row.end)}</td><td>${nullable(row.known_input_tokens)}</td><td>${nullable(row.known_output_tokens)}</td><td>${nullableMoney(row.provider_reported_cost_usd)}</td><td>${nullableMoney(row.cormidia_estimated_cost_usd)}</td><td>${nullableMoney(row.partial_recorded_cost_usd)}</td><td>${row.provider_turns}</td><td>${row.source_quality}</td></tr>`).join("")}</tbody></table>`;
  return `<section><h2>Usage over time</h2><div class="chart" role="img" aria-label="Known input plus output tokens by ${esc(report.range.bucket)}">${bars || `<p class="empty">No buckets.</p>`}</div><details><summary>Accessible trend data table</summary><div class="scroll">${table}</div></details></section>`;
}

function allocations(report: ReportSnapshotV1): string {
  const sets: Array<[string, ReportBreakdownV1[]]> = [
    ...(report.scope.kind === "org" ? [["App", report.breakdowns.by_app] as [string, ReportBreakdownV1[]]] : []),
    ["Role", report.breakdowns.by_role], ["Runtime / model", report.breakdowns.by_runtime_model], ["Pipeline / pass", report.breakdowns.by_pipeline_pass], ["Trigger", report.breakdowns.by_trigger], ["Status", report.breakdowns.by_status], ["Usage quality", report.breakdowns.by_usage_quality],
  ];
  return `<section><h2>Allocation</h2><div class="allocation">${sets.map(([title, rows]) => `<div><h3>${esc(title)}</h3>${breakdownTable(rows)}</div>`).join("")}</div></section>`;
}

function breakdownTable(rows: ReportBreakdownV1[]): string { return `<div class="scroll"><table><thead><tr><th>Value</th><th>Known tokens</th><th>Equivalent cost</th><th>Turns</th><th>Sessions</th><th>Token share</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.label)}</td><td>${formatInt(row.known_total_tokens)}</td><td>${money(row.recorded_equivalent_cost_usd)}</td><td>${row.turns}</td><td>${row.sessions}</td><td>${row.known_token_share === null ? "—" : `${(row.known_token_share * 100).toFixed(1)}%`}</td></tr>`).join("")}</tbody></table></div>`; }

function health(report: ReportSnapshotV1): string { const h = report.health; return `<section><h2>Operating health evidence</h2><div class="metrics">${metric("Turn wall time", percentile(h.provider_turn_wall_ms))}${metric("Turn cost", percentile(h.provider_turn_cost_usd, true))}${metric("Completed session cost", percentile(h.completed_session_cost_usd, true))}${metric("Gate results", `${h.gate_passes} pass / ${h.gate_failures} fail`)}${metric("Escalations", String(h.escalations))}${metric("Interrupted turns", String(h.interrupted_turns))}</div><div class="allocation"><div><h3>Session outcomes</h3>${simpleDistribution(h.session_outcomes.map((v) => [v.status, v.sessions]))}</div><div><h3>Pass outcomes</h3>${simpleDistribution(h.pass_outcomes.map((v) => [v.status, v.passes]))}</div><div><h3>Completion integrity</h3>${simpleDistribution(h.completion_integrity.map((v) => [v.status, v.sessions]))}</div></div></section>`; }

function portfolio(report: ReportSnapshotV1): string { if (report.apps.length === 0) return ""; return `<section><h2>${report.scope.kind === "org" ? "Org portfolio" : "App budget and coverage"}</h2><div class="scroll"><table><thead><tr><th>App</th><th>Lifecycle</th><th>Known tokens</th><th>Range cost</th><th>Turns</th><th>Sessions</th><th>Current month / budget</th><th>Usage coverage</th></tr></thead><tbody>${report.apps.map((app) => `<tr><td>${esc(app.app)}<br><small>${esc(app.repo)}</small></td><td>${esc(app.lifecycle)}</td><td>${formatInt(app.known_tokens)}</td><td>${money(app.recorded_equivalent_cost_usd)}</td><td>${app.provider_turns}</td><td>${app.sessions}</td><td>${money(app.current_month_spend_usd)} / ${money(app.monthly_budget_usd)} (${app.budget_percent.toFixed(1)}%, ${app.budget_status}, ${app.budget_paused ? "PAUSED" : "active"})</td><td>${app.usage_coverage === null ? "—" : `${(app.usage_coverage * 100).toFixed(1)}%`}</td></tr>`).join("")}</tbody></table></div></section>`; }

function budget(report: ReportSnapshotV1): string { if (report.scope.kind !== "app" || report.apps[0] === undefined) return ""; const app = report.apps[0]; return `<p class="budget"><strong>Current calendar month:</strong> ${money(app.current_month_spend_usd)} of ${money(app.monthly_budget_usd)} (${app.budget_percent.toFixed(1)}%, ${app.budget_status}, ${app.budget_paused ? "PAUSED" : "active"}). This monthly cap is separate from the selected ${esc(report.range.preset)} range.</p>`; }

function sessionHtml(session: ReportSessionDetailV1): string { const s = session.summary; const searchable = [s.id, s.label, ...s.apps, s.outcome, s.usage_quality, ...session.activities.flatMap((turn) => [turn.role, turn.model ?? "", turn.pipeline ?? "", turn.pass ?? "", turn.status])].join(" ").toLowerCase(); return `<details class="session" data-search="${esc(searchable)}"><summary><span><strong>${esc(s.label)}</strong><small>${esc(s.id)} · ${esc(s.apps.join(", ") || "unattributed")} · ${esc(s.outcome)} · ${s.provider_turns} provider / ${s.mechanical_passes} mechanical</small></span><span>${formatInt(s.known_input_tokens + s.known_output_tokens)} tokens · ${money(s.recorded_equivalent_cost_usd)}</span></summary>${s.objective_preview === null ? "" : `<p>${esc(s.objective_preview)}</p>`}${s.warnings.length === 0 ? "" : `<ul class="warnings">${s.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>`}${turnTable(session.activities)}</details>`; }

function turnTable(turns: ReportSessionDetailV1["activities"]): string { return `<div class="scroll"><table class="turns"><thead><tr><th>Activity</th><th>Identity</th><th>Role / model</th><th>Pipeline / pass</th><th>Status</th><th>UTC time</th><th>Tokens in / out</th><th>Cache read / create</th><th>Cost / quality</th><th>Evidence</th></tr></thead><tbody>${turns.map((turn) => `<tr><td>${esc(turn.activity_type)}</td><td><code>${esc(turn.app ?? "?")}/${esc(turn.run_id ?? "legacy")}</code><br><small>${esc(turn.trace_id ?? "no trace")}</small>${planEvidence(turn)}</td><td>${esc(turn.role)}<br><small>${esc(turn.runtime ?? "unknown")} / ${esc(turn.model ?? "unknown")}</small></td><td>${esc(turn.pipeline ?? "unknown")} / ${esc(turn.pass ?? "unknown")}</td><td>${esc(turn.status)}</td><td>${esc(turn.started_at ?? turn.settled_at ?? "unknown")}</td><td>${nullable(turn.tokens_in)} / ${nullable(turn.tokens_out)}</td><td>${nullable(turn.cache_read_tokens)} / ${nullable(turn.cache_creation_tokens)}</td><td>${turn.cost_usd === null ? "unavailable" : money(turn.cost_usd)}<br><small>${esc(turn.usage_quality)}${turn.cost_estimated ? " · estimated" : ""}</small></td><td>${turn.envelope_available ? "envelope" : "retained ledger only"}${turn.warnings.length ? `<br><small>${esc(turn.warnings.join(" · "))}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>`; }
function planEvidence(turn: ReportSessionDetailV1["activities"][number]): string {
  const values = [
    turn.plan_version === undefined ? undefined : `plan v${turn.plan_version}`,
    turn.plan_step_id === undefined ? undefined : `step ${turn.plan_step_id}`,
    turn.assignment_source === undefined ? undefined : `assignment ${turn.assignment_source}`,
  ].filter((value): value is string => value !== undefined);
  return values.length === 0 ? "" : `<br><small>${esc(values.join(" · "))}</small>`;
}

function metric(label: string, value: string, note = ""): string { return `<div class="metric"><small>${esc(label)}</small><strong>${esc(value)}</strong>${note ? `<span>${esc(note)}</span>` : ""}</div>`; }
function simpleDistribution(rows: Array<[string, number]>): string { return `<table><tbody>${rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${value}</td></tr>`).join("")}</tbody></table>`; }
function percentile(value: { median: number | null; p90: number | null; n: number }, moneyValue = false): string { const render = (v: number | null) => v === null ? "—" : moneyValue ? money(v) : `${Math.round(v)} ms`; return `median ${render(value.median)} · p90 ${render(value.p90)} · n=${value.n}`; }
function regenerationCommand(report: ReportSnapshotV1): string { const scope = report.scope.app === null ? "" : ` --app ${shellQuote(report.scope.app)}`; return `cormidia report${scope} --since ${report.range.from_inclusive.slice(0, 10)} --until ${new Date(new Date(report.range.to_exclusive).getTime() - 1).toISOString().slice(0, 10)} --bucket ${report.range.bucket} --html report.html`; }
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function safeJson(value: unknown): string { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" })[char]!); }
function esc(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function hash(value: string): string { return createHash("sha256").update(value).digest("base64"); }
function money(value: number): string { return `$${value.toFixed(2)}`; }
function formatInt(value: number): string { return Math.round(value).toLocaleString("en-US"); }
function nullable(value: number | null): string { return value === null ? "—" : formatInt(value); }
function nullableMoney(value: number | null): string { return value === null ? "—" : money(value); }

const CSS = `:root{color-scheme:light dark;--bg:#fbfbf8;--panel:#fff;--ink:#15202b;--muted:#607080;--line:#d7dde2;--blue:#1769aa;--amber:#8a5a00;--focus:#005fcc;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:14px;line-height:1.45}header,main{max-width:1280px;margin:auto;padding:1rem}.wordmark{letter-spacing:.12em}.marker{margin-left:1rem;color:var(--amber);font-size:.72rem}header{display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}header p{margin:0;color:var(--muted)}section{margin:1.2rem 0;padding-top:.8rem;border-top:1px solid var(--line)}h1,h2{font-size:1.15rem}h3{font-size:1rem}.confidential,.quality,.budget{border:1px solid var(--line);border-left:5px solid var(--amber);padding:.8rem;background:var(--panel)}.quality{margin-top:.5rem}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem}.metric{display:grid;gap:.15rem;background:var(--panel);border:1px solid var(--line);padding:.7rem}.metric strong{font-size:1.25rem}.metric small,.metric span,small{color:var(--muted)}.allocation{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:1rem}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:var(--panel)}th,td{text-align:left;padding:.4rem .55rem;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:650}td:nth-child(n+2){font-variant-numeric:tabular-nums}.chart{display:grid;gap:.25rem}.bar-row{display:grid;grid-template-columns:7rem 1fr 7rem;gap:.5rem;align-items:center}.bar-row progress{width:100%;height:.8rem;accent-color:var(--blue)}.heading,summary{display:flex;justify-content:space-between;gap:1rem;align-items:center}.session{border:1px solid var(--line);background:var(--panel);margin:.5rem 0}.session>summary{cursor:pointer;padding:.7rem}.session>summary span{display:grid}.session>p,.session>.warnings{margin:.7rem}.turns{font-size:.82rem}.empty{color:var(--muted)}dl{display:grid;grid-template-columns:minmax(10rem,auto) 1fr;gap:.25rem 1rem}dd{margin:0}.skip{position:absolute;left:-9999px}.skip:focus{left:.5rem;top:.5rem;background:#fff;color:#000;padding:.5rem}:focus-visible{outline:3px solid var(--focus);outline-offset:2px}@media(prefers-color-scheme:dark){:root{--bg:#0f1419;--panel:#151c23;--ink:#edf3f8;--muted:#aab6c2;--line:#35424f;--blue:#62b2f4;--amber:#ffc65c}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}@media(max-width:480px){header,.heading,summary{align-items:flex-start;flex-direction:column}.marker{display:block;margin:.3rem 0}.allocation{grid-template-columns:1fr}.bar-row{grid-template-columns:5.5rem 1fr}.bar-row span:last-child{grid-column:2}main,header{padding:.7rem}dl{grid-template-columns:1fr}}@media print{:root{color-scheme:light}body{background:#fff;color:#000;font-size:10pt}header{position:static}.skip,input{display:none!important}section{break-inside:avoid}.session{break-inside:auto}.session[open]>.scroll{display:block}details.session:not([open])>*:not(summary){display:block}table{background:#fff}thead{display:table-header-group}.scroll{overflow:visible}.confidential,.quality,.budget{border-color:#333}}`;

const JS = `(()=>{'use strict';const input=document.getElementById('session-filter');const list=document.getElementById('session-list');const count=document.getElementById('session-count');if(!input||!list||!count)return;const rows=[...list.querySelectorAll('.session')];const render=()=>{const query=input.value.trim().toLowerCase();let visible=0;for(const row of rows){const show=!query||String(row.dataset.search||'').includes(query);row.hidden=!show;if(show)visible++;}count.textContent=visible+' of '+rows.length+' sessions shown';};input.addEventListener('input',render);addEventListener('beforeprint',()=>rows.forEach(row=>row.open=true));render();})();`;
