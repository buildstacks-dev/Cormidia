import { TIME_POLICY_JS } from "./time-policy.js";

export const REPORT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Operon Reports</title>
  <link rel="stylesheet" href="/assets/report.css">
</head>
<body>
  <a class="skip" href="#report-main">Skip to report</a>
  <header>
    <div><strong>OPERON</strong><span class="marker">READ ONLY · TOKEN FREE · AS OF</span></div>
    <nav aria-label="Primary"><a href="/">Live</a><a href="/reports" aria-current="page">Reports</a></nav>
    <p id="identity">Loading report…</p>
    <p id="timezone" class="tz"></p>
  </header>
  <main id="report-main">
    <form id="controls">
      <label>Scope <select id="app"><option value="">All apps</option></select></label>
      <label>Period <select id="period"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d" selected>Last 90 days</option><option value="1y">Last year</option><option value="all">All retained</option><option value="custom">Custom</option></select></label>
      <label>Since <input id="since" type="date"></label>
      <label>Until <input id="until" type="date"></label>
      <label>Bucket <select id="bucket"><option value="auto">Auto</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
      <button type="submit">Refresh</button>
      <a id="json-export" class="button" href="#">Export JSON</a>
      <a id="html-export" class="button" href="#">Export HTML</a>
    </form>
    <div id="status" role="status" aria-live="polite"></div>
    <div id="report"></div>
    <form id="session-controls">
      <label>Filter sessions <input id="session-filter" type="search" placeholder="objective, role, model, ref"></label>
      <label>Sort <select id="session-sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="cost">Cost</option><option value="tokens">Known tokens</option><option value="status">Status</option><option value="app">App</option></select></label>
      <button type="submit">Apply</button>
      <button id="session-prev" type="button">Previous</button>
      <button id="session-next" type="button">Next</button>
    </form>
    <div id="sessions"></div>
  </main>
  <script src="/assets/report.js" defer></script>
</body>
</html>`;

export const REPORT_CSS = `
:root { color-scheme:dark; --bg:#0b0e12; --panel:#121720; --line:#2a3543; --text:#eef4fa; --muted:#9ba9b8; --blue:#5ab0ff; --amber:#f0bd5a; --red:#ff7272; --focus:#b9dcff; font-family:ui-monospace,monospace; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-size:14px; }
a { color:#91caff; }
header { display:grid; grid-template-columns:auto auto 1fr; gap:1rem; align-items:center; padding:.8rem 1rem; border-bottom:1px solid var(--line); position:sticky; top:0; background:#0b0e12f5; z-index:2; }
header nav { display:flex; gap:.35rem; }
header nav a,.button { border:1px solid var(--line); padding:.4rem .65rem; border-radius:5px; text-decoration:none; }
header nav [aria-current] { border-color:var(--blue); }
header p { color:var(--muted); text-align:right; }
.marker { margin-left:.7rem; color:var(--amber); font-size:.72rem; }
.tz { color:var(--muted); font-size:.72rem; text-align:right; margin:.2rem 0 0; }
main { max-width:1500px; margin:auto; padding:1rem; }
form { display:flex; gap:.6rem; align-items:end; flex-wrap:wrap; border-bottom:1px solid var(--line); padding:0 0 1rem; }
#session-controls { padding-top:1rem; border-top:1px solid var(--line); }
label { display:grid; gap:.25rem; color:var(--muted); font-size:.75rem; }
button,select,input { font:inherit; background:#202a36; color:var(--text); border:1px solid var(--line); padding:.45rem; border-radius:5px; }
.quality { border:1px solid var(--amber); border-left:5px solid var(--amber); padding:.7rem; background:#2b2313; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:.6rem; }
.metric,.panel,.session { border:1px solid var(--line); background:var(--panel); padding:.7rem; }
.metric { display:grid; gap:.2rem; }
.metric strong { font-size:1.3rem; }
.metric small,.muted { color:var(--muted); }
section { padding-top:1rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:.8rem; }
.scroll { overflow:auto; }
table { border-collapse:collapse; width:100%; }
th,td { text-align:left; padding:.4rem; border-bottom:1px solid var(--line); }
.bars { display:grid; gap:.25rem; }
.bar { display:grid; grid-template-columns:7rem 1fr 6rem; gap:.4rem; }
.bar progress { width:100%; height:.8rem; accent-color:var(--blue); }
.session { margin:.5rem 0; }
.session summary { cursor:pointer; display:flex; justify-content:space-between; gap:1rem; }
.error { border:1px solid var(--red); padding:.7rem; color:#ffd1d1; }
.skip { position:absolute; left:-9999px; }
.skip:focus { left:.5rem; top:.5rem; }
:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
@media(prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
@media(max-width:600px) { header { grid-template-columns:1fr; position:static; } header p { text-align:left; margin:0; } .marker { display:block; margin:.3rem 0; } .grid { grid-template-columns:1fr; } .bar { grid-template-columns:5rem 1fr; } .bar span:last-child { grid-column:2; } .session summary { flex-direction:column; } }
@media print { header nav,form,.button { display:none!important; } header { position:static; } .session>* { display:block!important; } thead { display:table-header-group; } }
`;

export const REPORT_JS = String.raw`
(() => {
  'use strict';
  const q = (id) => document.getElementById(id);` + TIME_POLICY_JS + String.raw`
  const node = (tag, attrs, ...children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') element.className = value;
      else element.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  };
  const money = (value) => '$' + Number(value || 0).toFixed(2);
  const num = (value) => Number(value || 0).toLocaleString();
  const params = new URL(location.href).searchParams;
  let currentCursor = null;
  let nextCursor = null;
  const previous = [];

  function query() {
    const out = new URLSearchParams();
    const period = q('period').value;
    if (q('app').value) out.set('app', q('app').value);
    if (period === 'custom') {
      if (q('since').value) out.set('since', q('since').value);
      if (q('until').value) out.set('until', q('until').value);
    } else out.set('period', period);
    out.set('bucket', q('bucket').value);
    return out;
  }

  async function load(forceRefresh = false) {
    q('status').className = '';
    q('status').textContent = 'Building as-of snapshot…';
    const reportQuery = query();
    history.replaceState({}, '', location.pathname + '?' + reportQuery);
    q('json-export').href = '/api/v1/reports/export.json?' + reportQuery;
    q('html-export').href = '/api/v1/reports/export.html?' + reportQuery;
    const sessionQuery = new URLSearchParams(reportQuery);
    if (forceRefresh) reportQuery.set('refresh', '1');
    sessionQuery.set('limit', '25');
    sessionQuery.set('sort', q('session-sort').value);
    if (q('session-filter').value) sessionQuery.set('filter', q('session-filter').value);
    if (currentCursor) sessionQuery.set('cursor', currentCursor);
    try {
      const [summaryResponse, sessionsResponse] = await Promise.all([
        fetch('/api/v1/reports/summary?' + reportQuery, { cache: 'no-store' }),
        fetch('/api/v1/reports/sessions?' + sessionQuery, { cache: 'no-store' }),
      ]);
      if (!summaryResponse.ok) throw new Error((await summaryResponse.json()).error || summaryResponse.status);
      if (!sessionsResponse.ok) throw new Error((await sessionsResponse.json()).error || sessionsResponse.status);
      const report = await summaryResponse.json();
      const sessions = await sessionsResponse.json();
      render(report);
      renderSessions(sessions);
      q('status').replaceChildren(
        document.createTextNode('Snapshot generated '),
        timeEl(report.generated_at, 'local'),
        document.createTextNode(' · explicit Refresh updates it.'),
      );
      q('timezone').textContent = zoneStatement('local');
    } catch (error) {
      q('status').className = 'error';
      q('status').textContent = 'Report failed: ' + String(error);
    }
  }

  function render(report) {
    q('identity').replaceChildren(
      document.createTextNode(report.org.name + ' · ' + report.org.state_home_id + ' · '),
      timeEl(report.generated_at, 'local'),
    );
    if (q('app').options.length === 1) {
      for (const app of report.apps) q('app').append(node('option', { value: app.app }, app.app));
    }
    if (report.server_scope) {
      q('app').replaceChildren(node('option', { value: report.server_scope }, report.server_scope));
      q('app').value = report.server_scope;
      q('app').disabled = true;
    }
    const headline = report.headline;
    const quality = node('section', { class: 'quality' },
      node('h1', {}, 'Data quality · ' + report.quality.overall),
      node('ul', {}, ...(report.quality.notices.length ? report.quality.notices : ['No source-quality issue detected; invoice agreement is not implied.']).map((value) => node('li', {}, value))),
    );
    const metrics = node('section', {}, node('h2', {}, 'Usage overview'), node('div', { class: 'metrics' },
      metric('Known input', num(headline.known_input_tokens)),
      metric('Known output', num(headline.known_output_tokens)),
      metric('Known total', num(headline.known_total_tokens)),
      metric('Equivalent cost', money(headline.recorded_equivalent_cost_usd), 'reported ' + money(headline.provider_reported_cost_usd) + ' · estimated ' + money(headline.operon_estimated_cost_usd) + ' · partial ' + money(headline.partial_recorded_cost_usd)),
      metric('Provider turns', headline.provider_turns, headline.unknown_usage_turns + ' unknown usage'),
      metric('Sessions', headline.sessions, headline.completed_sessions + ' completed'),
    ));
    const evidence = report.efficiency;
    const issueCount = Object.values(evidence.issues).reduce((sum, values) => sum + values.length, 0);
    const efficiency = node('section', {},
      node('h2', {}, 'Efficiency and invariant evidence'),
      node('div', { class: 'metrics' },
        evidenceMetric('Episode terminal integrity', evidence.metrics.terminal_integrity),
        evidenceMetric('Step terminal integrity', evidence.metrics.execution_step_terminal_integrity),
        evidenceMetric('Ledger coverage', evidence.metrics.ledger_coverage),
        evidenceMetric('Productive provider turns', evidence.metrics.productive_pass_ratio),
        metric('Repeated-work cost', evidence.repeated_work_cost_usd === null ? 'unknown' : money(evidence.repeated_work_cost_usd)),
        metric('Evidence issues', num(issueCount), evidence.episodes.length + ' episodes'),
      ),
      node('div', { class: 'grid' },
        breakdownContext('Context by category', evidence.context_by_category),
        issuePanel(evidence.issues),
      ),
    );
    const maximum = Math.max(1, ...report.trend.map((value) => (value.known_input_tokens || 0) + (value.known_output_tokens || 0)));
    const trend = node('section', {}, node('h2', {}, 'Token trend'),
      node('div', { class: 'bars' }, ...report.trend.map((value) => node('div', { class: 'bar' },
        value.start.slice(0, 10),
        node('progress', { max: maximum, value: (value.known_input_tokens || 0) + (value.known_output_tokens || 0) }, String((value.known_input_tokens || 0) + (value.known_output_tokens || 0))),
        value.source_quality === 'gap' ? 'gap' : num((value.known_input_tokens || 0) + (value.known_output_tokens || 0)),
      ))), trendData(report.trend));
    const allocations = node('section', {}, node('h2', {}, 'Allocation'), node('div', { class: 'grid' },
      breakdown('By app', report.breakdowns.by_app),
      breakdown('By role', report.breakdowns.by_role),
      breakdown('By runtime/model', report.breakdowns.by_runtime_model),
      breakdown('By pipeline/pass', report.breakdowns.by_pipeline_pass),
    ));
    q('report').replaceChildren(quality, metrics, efficiency, trend, allocations);
  }

  function trendData(rows) {
    const headings = ['Bucket UTC', 'Input', 'Output', 'Reported', 'Estimated', 'Partial', 'Quality'];
    return node('details', {}, node('summary', {}, 'Accessible trend data table'), node('div', { class: 'scroll' }, node('table', {},
      node('thead', {}, node('tr', {}, ...headings.map((value) => node('th', {}, value)))),
      node('tbody', {}, ...rows.map((value) => node('tr', {},
        node('td', {}, value.start + ' – ' + value.end),
        node('td', {}, value.known_input_tokens === null ? '—' : num(value.known_input_tokens)),
        node('td', {}, value.known_output_tokens === null ? '—' : num(value.known_output_tokens)),
        node('td', {}, value.provider_reported_cost_usd === null ? '—' : money(value.provider_reported_cost_usd)),
        node('td', {}, value.operon_estimated_cost_usd === null ? '—' : money(value.operon_estimated_cost_usd)),
        node('td', {}, value.partial_recorded_cost_usd === null ? '—' : money(value.partial_recorded_cost_usd)),
        node('td', {}, value.source_quality),
      ))),
    )));
  }

  function renderSessions(page) {
    nextCursor = page.next_cursor;
    q('session-next').disabled = !nextCursor;
    q('session-prev').disabled = previous.length === 0;
    q('sessions').replaceChildren(node('section', {},
      node('h2', {}, 'Sessions · ' + page.returned + ' of ' + page.total),
      ...(page.items.length ? page.items.map(session) : [node('p', { class: 'muted' }, 'No sessions in range')]),
    ));
  }

  function metric(label, value, note) {
    return node('div', { class: 'metric' }, node('small', {}, label), node('strong', {}, value), note ? node('span', { class: 'muted' }, note) : '');
  }

  function evidenceMetric(label, value) {
    const display = value.status === 'valid' && value.value !== null ? (value.value * 100).toFixed(1) + '%' : 'invalid';
    const note = value.numerator + '/' + value.denominator + (value.missing_inputs.length ? ' · ' + value.missing_inputs.length + ' missing inputs' : '');
    return metric(label, display, note);
  }

  function breakdownContext(title, rows) {
    const body = node('tbody', {}, ...rows.map((value) => node('tr', {},
      node('td', {}, value.category),
      node('td', {}, num(value.rendered_bytes)),
      node('td', {}, num(value.components)),
      node('td', {}, num(value.run_ids.length)),
    )));
    return node('div', { class: 'panel scroll' }, node('h3', {}, title), node('table', {},
      node('thead', {}, node('tr', {}, ...['Category', 'Bytes', 'Components', 'Runs'].map((value) => node('th', {}, value)))),
      body,
    ));
  }

  function issuePanel(issues) {
    const rows = Object.entries(issues).filter(([, values]) => values.length > 0);
    return node('div', { class: 'panel scroll' }, node('h3', {}, 'Named evidence issues'),
      rows.length
        ? node('table', {}, node('thead', {}, node('tr', {}, node('th', {}, 'Kind'), node('th', {}, 'Count'))),
            node('tbody', {}, ...rows.map(([kind, values]) => node('tr', {}, node('td', {}, kind), node('td', {}, values.length)))))
        : node('p', { class: 'muted' }, 'No efficiency evidence issue detected.'),
    );
  }

  function breakdown(title, rows) {
    const body = node('tbody', {}, ...rows.slice(0, 20).map((value) => node('tr', {}, node('td', {}, value.label), node('td', {}, num(value.known_total_tokens)), node('td', {}, money(value.recorded_equivalent_cost_usd)), node('td', {}, value.turns))));
    return node('div', { class: 'panel scroll' }, node('h3', {}, title), node('table', {}, node('thead', {}, node('tr', {}, ...['Value', 'Tokens', 'Cost', 'Turns'].map((value) => node('th', {}, value)))), body));
  }

  function session(item) {
    const summary = item.summary;
    const rows = node('tbody', {}, ...item.activities.map((value) => {
      const plan = [
        value.plan_version === undefined ? '' : 'plan v' + value.plan_version,
        value.plan_step_id === undefined ? '' : 'step ' + value.plan_step_id,
        value.assignment_source === undefined ? '' : 'assignment ' + value.assignment_source,
      ].filter(Boolean).join(' · ');
      return node('tr', {},
        node('td', {}, value.activity_type),
        node('td', {}, (value.app || '?') + '/' + (value.run_id || 'legacy'), plan ? node('small', {}, plan) : ''),
        node('td', {}, value.role + ' / ' + (value.model || '?')),
        node('td', {}, (value.pipeline || '?') + '/' + (value.pass || '?')),
        node('td', {}, value.status),
        node('td', {}, value.tokens_in === null ? 'unknown' : value.tokens_in + ' / ' + value.tokens_out),
        node('td', {}, value.cost_usd === null ? 'unknown' : money(value.cost_usd) + ' ' + value.usage_quality),
      );
    }));
    const liveHref = summary.kind === 'orphan_run' ? '/' : '/?session=' + encodeURIComponent(summary.id);
    return node('details', { class: 'session' },
      node('summary', {}, node('span', {}, node('a', { href: liveHref }, summary.label), ' · ' + summary.outcome), node('span', {}, num(summary.known_input_tokens + summary.known_output_tokens) + ' tokens · ' + money(summary.recorded_equivalent_cost_usd))),
      summary.objective_preview ? node('p', {}, summary.objective_preview) : '',
      node('div', { class: 'scroll' }, node('table', {}, node('thead', {}, node('tr', {}, ...['Type', 'Run', 'Role/model', 'Pipeline/pass', 'Status', 'Tokens', 'Cost/quality'].map((value) => node('th', {}, value)))), rows)),
    );
  }

  q('controls').addEventListener('submit', (event) => { event.preventDefault(); currentCursor = null; previous.length = 0; load(true); });
  q('session-controls').addEventListener('submit', (event) => { event.preventDefault(); currentCursor = null; previous.length = 0; load(); });
  q('session-next').addEventListener('click', () => { if (!nextCursor) return; previous.push(currentCursor); currentCursor = nextCursor; load(); });
  q('session-prev').addEventListener('click', () => { currentCursor = previous.pop() || null; load(); });
  for (const id of ['app', 'period', 'since', 'until', 'bucket']) {
    const value = params.get(id);
    if (value) q(id).value = value;
  }
  load();
})();`;
