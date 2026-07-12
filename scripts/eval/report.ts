import type { Qualification } from "./core.js";

export function renderQualificationHtml(qualification: Qualification): string {
  const data = safeJson(qualification);
  const title = `Operon eval ${escapeHtml(qualification.campaign_id)}`;
  const reasons = qualification.reasons.length === 0 ? "<li>None</li>" : qualification.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  const counts = Object.entries(qualification.counts).map(([name, count]) => `<tr><th>${escapeHtml(name)}</th><td>${count}</td></tr>`).join("");
  const attempts = qualification.attempt_ids.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>body{font:15px system-ui;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#17202a}code{background:#eef2f5;padding:.1rem .3rem}table{border-collapse:collapse}th,td{border:1px solid #ccd3d8;padding:.35rem .6rem;text-align:left}.qualified{color:#176b36}.not_qualified,.invalid,.incomplete{color:#9b2c2c}</style></head><body><h1>${title}</h1><p>Outcome: <strong class="${escapeHtml(qualification.outcome)}">${escapeHtml(qualification.outcome)}</strong></p><p>Campaign fingerprint: <code>${escapeHtml(qualification.campaign_sha256)}</code></p><p>Immutable attempts: ${qualification.attempts}</p><h2>Attempts</h2><ul>${attempts}</ul><h2>Attempt outcomes</h2><table>${counts}</table><h2>Reasons and exclusions</h2><ul>${reasons}</ul><script type="application/json" id="qualification-data">${data}</script></body></html>\n`;
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function safeJson(value: unknown): string { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" })[char]!); }
