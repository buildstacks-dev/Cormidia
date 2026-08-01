import { TIME_POLICY_JS } from "../report/time-policy.js";

export const OBSERVE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Operon Live UI</title>
  <link rel="stylesheet" href="/assets/observe.css">
</head>
<body>
  <a class="skip" href="#main">Skip to live overview</a>
  <header class="global-header">
    <div><span class="wordmark">OPERON</span><span class="readonly">READ ONLY</span><nav class="primary" aria-label="Primary"><a href="/" aria-current="page">Live</a><a href="/reports">Reports</a></nav></div>
    <div class="health-line" aria-live="polite">
      <span id="connection" class="status unknown">connecting</span>
      <span id="identity">Loading observer…</span>
      <span id="timezone" class="tz"></span>
      <span id="clock-skew" class="warn" role="status" hidden></span>
    </div>
    <div class="header-actions">
      <button id="tz-toggle" type="button" aria-pressed="false">UTC times</button>
      <label class="session-control">Session
        <select id="session-selector" aria-label="Choose live or historical session">
          <option value="">Live org</option>
        </select>
      </label>
      <span id="session-mode" class="pill live">live</span>
      <div id="totals" class="totals" aria-describedby="scope-statement"></div>
    </div>
    <p id="scope-statement" class="meta scope-statement"></p>
  </header>
  <nav class="filters" aria-label="Observer filters">
    <label>App <select id="app-filter"><option value="">All apps</option></select></label>
    <label>Role <select id="role-filter"><option value="">All roles</option></select></label>
    <label>Status <select id="status-filter"><option value="">All states</option></select></label>
    <button id="clear-filters" type="button">Clear filters</button>
  </nav>
  <div id="banner" class="banner" role="status" hidden></div>
  <main id="main">
    <section aria-labelledby="attention-title">
      <div class="section-heading"><h1 id="attention-title">Attention</h1><span id="attention-count" class="scope-badge"></span></div>
      <div id="attention" class="attention-grid"></div>
    </section>
    <section aria-labelledby="apps-title">
      <div class="section-heading"><h2 id="apps-title">App lifecycle</h2><span id="apps-scope" class="scope-badge"></span></div>
      <div id="apps" class="app-grid"></div>
      <section aria-labelledby="activity-history-title">
        <div class="section-heading"><h3 id="activity-history-title">Recorded activity</h3><span id="activity-history-scope" class="scope-badge"></span><button id="order-toggle" type="button" aria-pressed="false">Oldest first</button></div>
        <ol id="activity-history" class="timeline" aria-label="Recorded lifecycle and non-ticket activity"></ol>
      </section>
      <section aria-labelledby="pending-intake-title">
        <div class="section-heading"><h3 id="pending-intake-title">Pending intake</h3><span id="pending-intake-scope" class="scope-badge"></span></div>
        <ul id="pending-intake" class="inbox" aria-label="Pending company events and lifecycle states"></ul>
      </section>
    </section>
    <section aria-labelledby="delivery-title">
      <div class="section-heading"><h2 id="delivery-title">Product delivery</h2><span id="delivery-scope" class="scope-badge"></span><span>GitHub <code>op:ready</code> is the claimable queue</span></div>
      <div id="delivery" class="delivery-board"></div>
    </section>
    <section class="workspace" aria-label="Execution and activity">
      <div>
        <div class="section-heading"><h2 id="graph-title">Execution graph</h2><span id="graph-scope" class="scope-badge"></span></div>
        <div class="graph-controls">
          <label>Find trace <input id="graph-search" type="search" placeholder="trace id, app, pipeline, ticket, pass or role"></label>
          <details id="graph-legend">
            <summary>Graph legend</summary>
            <ul class="legend-list">
              <li data-legend-state="not_started"><span class="legend-swatch" aria-hidden="true"></span>not started — selected, no start instant recorded yet</li>
              <li data-legend-state="running"><span class="legend-swatch" aria-hidden="true"></span>running — a provider or mechanical turn is in flight</li>
              <li data-legend-state="completed"><span class="legend-swatch" aria-hidden="true"></span>completed — terminal, recorded as finished</li>
              <li data-legend-state="blocked"><span class="legend-swatch" aria-hidden="true"></span>blocked — terminal for now, waiting on an approval or dependency</li>
              <li data-legend-state="failed"><span class="legend-swatch" aria-hidden="true"></span>failed — terminal: failed, timed out, or cancelled</li>
              <li data-legend-state="skipped"><span class="legend-swatch" aria-hidden="true"></span>skipped by routing — a recorded routing branch that was deliberately not taken; the reason is shown on the node</li>
              <li data-legend-state="not_observed"><span class="legend-swatch" aria-hidden="true"></span>selected, not observed — the trace manifest required this pass and no record of it exists</li>
              <li data-legend-state="unknown"><span class="legend-swatch" aria-hidden="true"></span>unknown legacy evidence — recorded state is not interpretable; never inferred</li>
              <li data-legend-arrow="true"><span class="legend-swatch" aria-hidden="true">&rarr;</span>arrow (&rarr;) — recorded execution order within one trace, oldest start first. It is not a dependency edge.</li>
              <li data-legend-manifest="true"><span class="legend-swatch" aria-hidden="true"></span>a trace whose manifest was not recorded shows no expected stages at all: absent, never a grey pending row</li>
            </ul>
          </details>
        </div>
        <div id="graph" class="graph" tabindex="0"></div>
      </div>
      <div>
        <div class="section-heading"><h2 id="activity-title">Live activity</h2><span id="activity-scope" class="scope-badge"></span><span id="activity-follow" class="pill" role="status" aria-live="polite">following live</span><button id="resume-stream" type="button" aria-describedby="activity-follow-help" disabled aria-disabled="true">Resume latest (newest first)</button></div>
        <p id="activity-follow-help" class="meta">Following keeps the newest event at the top. Scrolling down pauses it. Nothing is dropped while paused.</p>
        <div id="activity-controls" class="activity-controls">
          <label>Event type <select id="event-kind-filter"><option value="">All event types</option></select></label>
          <label>Tool outcome <select id="outcome-filter"><option value="">All outcomes</option><option value="success">success</option><option value="failure">failure</option><option value="pending">pending</option><option value="unknown">unknown</option><option value="not_applicable">not applicable</option></select></label>
          <label>Trace <select id="trace-filter"><option value="">All traces</option></select></label>
          <label>Pass <select id="pass-filter"><option value="">All passes</option></select></label>
          <label>Group <select id="group-mode"><option value="none">No grouping (raw sequence)</option><option value="trace">Group by trace</option><option value="pass">Group by pass</option></select></label>
        </div>
        <div id="activity" class="activity"></div>
      </div>
    </section>
    <section aria-labelledby="history-title">
      <div class="section-heading"><h2 id="history-title">Recorded sessions and completion integrity</h2><span id="history-index-scope" class="scope-badge"></span></div>
      <p class="meta">Each row is a recorded snapshot built from durable event timestamps and envelope final state. No intermediate state is reconstructed and nothing is animated. Selecting a row is the same scope change as the Session control in the header.</p>
      <label class="history-find">Find a recorded session <input id="history-search" type="search" placeholder="task id, trace id, app, pipeline, ticket, status, approval id, role or rule"></label>
      <div id="history-index" class="history history-index"></div>
      <div class="section-heading"><h3 id="history-records-title">Completion integrity records</h3><span id="history-scope" class="scope-badge"></span></div>
      <div id="history" class="history"></div>
    </section>
    <section aria-labelledby="sources-title">
      <div class="section-heading"><h2 id="sources-title">Source health</h2><span id="sources-scope" class="scope-badge"></span></div>
      <div id="sources" class="sources"></div>
    </section>
    <section aria-labelledby="validation-campaigns-title">
      <div class="section-heading"><h2 id="validation-campaigns-title">Validation campaigns</h2><span id="validation-campaigns-scope" class="scope-badge"></span></div>
      <p class="meta">An inconclusive campaign is not a pass and is never release evidence.</p>
      <div id="validation-campaigns" class="history"></div>
    </section>
  </main>
  <aside id="drawer" class="drawer" aria-labelledby="drawer-title" aria-modal="true" role="dialog" hidden>
    <div class="drawer-head"><h2 id="drawer-title">Pass inspection</h2><button id="close-drawer" type="button" aria-label="Close pass inspection">Close</button></div>
    <div id="drawer-body"></div>
  </aside>
  <div id="drawer-backdrop" class="backdrop" hidden></div>
  <dialog id="artifact-dialog"><form method="dialog"><button aria-label="Close artifact">Close</button></form><h2 id="artifact-title">Local evidence</h2><p class="warning">Potentially sensitive local evidence. Activity logs are not transcripts.</p><pre id="artifact-content"></pre></dialog>
  <script src="/assets/observe.js" defer></script>
</body>
</html>`;

export const OBSERVE_CSS = `
:root { color-scheme: dark; --bg:#0b0e12; --panel:#121720; --panel2:#171e28; --line:#2a3543; --text:#eef4fa; --muted:#9ba9b8; --blue:#5ab0ff; --green:#57d69b; --amber:#f0bd5a; --red:#ff7272; --focus:#b9dcff; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); min-height:100vh; }
a { color:#91caff; }
button, select { font:inherit; color:var(--text); background:#202a36; border:1px solid var(--line); border-radius:5px; padding:.45rem .65rem; }
button:hover, select:hover { border-color:#65788d; }
:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
.skip { position:absolute; left:.5rem; top:-4rem; z-index:20; background:#fff; color:#000; padding:.5rem; }
.skip:focus { top:.5rem; }
.global-header { position:sticky; top:0; z-index:10; display:grid; grid-template-columns:auto 1fr auto; gap:1rem; align-items:center; padding:.75rem 1rem; background:rgba(11,14,18,.96); border-bottom:1px solid var(--line); }
.wordmark { font-weight:800; letter-spacing:.16em; }
.readonly { margin-left:.7rem; color:var(--amber); border:1px solid var(--amber); padding:.15rem .35rem; font-size:.72rem; }
.primary { display:inline-flex; gap:.3rem; margin-left:.8rem; }.primary a { text-decoration:none; border:1px solid var(--line); border-radius:4px; padding:.25rem .45rem; }.primary [aria-current] { border-color:var(--blue); }
.health-line { display:flex; justify-content:center; gap:.7rem; color:var(--muted); flex-wrap:wrap; }
.header-actions { display:flex; justify-content:flex-end; align-items:center; gap:.6rem; min-width:0; max-width:100%; flex-wrap:wrap; }
.session-control { display:flex; align-items:center; gap:.4rem; color:var(--muted); font-size:.72rem; min-width:0; }
.session-control select { max-width:min(34vw,430px); min-width:0; }
.status::before { content:'●'; margin-right:.35rem; }
.status.live,.good { color:var(--green); }.status.reconnecting,.warn { color:var(--amber); }.status.offline,.bad { color:var(--red); }.status.unknown { color:var(--muted); }
.totals { display:flex; gap:.8rem; font-size:.78rem; color:var(--muted); }
.filters { display:flex; gap:.8rem; padding:.65rem 1rem; border-bottom:1px solid var(--line); background:#0e131a; align-items:end; flex-wrap:wrap; }
.filters label { display:grid; gap:.25rem; color:var(--muted); font-size:.75rem; }
.banner { margin:.7rem 1rem 0; border:1px solid var(--amber); background:#2b2313; color:#ffe1a4; padding:.65rem; }
main { padding:0 1rem 3rem; max-width:1800px; margin:auto; }
main button, main section, main details, main li, main .trace-node { scroll-margin-top:6.5rem; }
section { padding-top:1.2rem; }
.section-heading { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; margin-bottom:.55rem; }
h1,h2,h3 { font-family:system-ui,sans-serif; margin:0; } h1,h2 { font-size:1rem; letter-spacing:.02em; } h3 { font-size:.9rem; }
.section-heading span { color:var(--muted); font-size:.75rem; }
.attention-grid,.app-grid,.sources { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:.65rem; }
.card,.source,.attention-item { background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:.75rem; overflow-wrap:anywhere; }
.attention-item.error,details.attention-item.error { border-left:4px solid var(--red); }.attention-item.warning,details.attention-item.warning { border-left:4px solid var(--amber); }
details.attention-item > summary { cursor:pointer; display:flex; flex-wrap:wrap; gap:.4rem; align-items:baseline; }
.attention-item ol { list-style:none; margin:.5rem 0 0; padding:0; }
.attention-item ol li { border-left:2px solid var(--line); padding:.35rem .55rem; margin-bottom:.3rem; display:grid; gap:.15rem; }
.tz { color:var(--muted); font-size:.72rem; }
.scope-badge { color:var(--muted); font-size:.75rem; }
.inbox { list-style:none; margin:0; padding:0; }
.inbox li { padding:.4rem .6rem .7rem; border:1px solid var(--line); border-radius:6px; margin-bottom:.35rem; }
.session-link { padding:.2rem .45rem; font-size:.72rem; }
/* A control that cannot act stays FOCUSABLE via aria-disabled so a keyboard or
   screen-reader operator can reach the stated reason. \`disabled\` would remove
   it from the tab order and hide that reason entirely. */
.session-link[disabled],.session-link[aria-disabled='true'] { opacity:.55; }
.session-link[aria-disabled='true'] { cursor:default; }
.activity-controls { display:flex; gap:.6rem; flex-wrap:wrap; align-items:end; padding:0 0 .5rem; min-width:0; }
.activity-controls label { display:grid; gap:.2rem; color:var(--muted); font-size:.72rem; min-width:0; }
.activity-controls select { max-width:100%; min-width:0; }
.section-heading { min-width:0; }
.scope-badge,.section-heading span { overflow-wrap:anywhere; min-width:0; }
.activity-group { border-top:1px solid var(--line); }
.activity-group > h3 { padding:.4rem .6rem; color:var(--muted); font-size:.75rem; }
.activity li[data-focused='true'] { border-left:4px solid var(--blue); background:#141d29; }
.trace-node[aria-current='true'] { border-color:var(--blue); border-width:2px; }
.trace-node[aria-current='true'] strong::before { content:'▸ '; }
.empty { color:var(--muted); padding:.6rem; border:1px dashed var(--line); border-radius:6px; }
.meta { color:var(--muted); font-size:.75rem; line-height:1.5; }
.pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:.12rem .45rem; font-size:.7rem; margin:.15rem .2rem .15rem 0; }
.pill.live,.pill.completed,.pill.merged { border-color:var(--green); color:var(--green); }.pill.running,.pill.ready,.pill.building,.pill.in_review { border-color:var(--blue); color:var(--blue); }.pill.blocked,.pill.blocked_on_approval,.pill.returned { border-color:var(--amber); color:var(--amber); }.pill.failed,.pill.stalled,.pill.corrupt { border-color:var(--red); color:var(--red); }
.timeline,.activity { list-style:none; margin:0; padding:0; }
.timeline li,.activity li { border-left:2px solid var(--line); margin-left:.5rem; padding:.4rem .6rem .7rem; }
.delivery-board { display:grid; grid-template-columns:repeat(6,minmax(210px,1fr)); gap:.65rem; overflow-x:auto; padding-bottom:.5rem; }
.delivery-column { min-width:210px; background:#0e131a; border:1px solid var(--line); border-radius:7px; padding:.55rem; }
.delivery-column h3 { display:flex; justify-content:space-between; margin-bottom:.5rem; }
.ticket { width:100%; text-align:left; background:var(--panel); margin-bottom:.5rem; padding:.65rem; }
.ticket strong { display:block; margin-bottom:.35rem; }
.workspace { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr); gap:1rem; }
/* Stacked trace GROUPS, each with its own horizontally scrolling node row. The
   overflow lives on \`ol.trace\`, not on #graph: a long trace must scroll inside
   its own container or it pushes the page body wide at 360px. */
.graph { min-height:220px; padding:.8rem; border:1px solid var(--line); border-radius:7px; display:grid; gap:.7rem; min-width:0; }
.graph-controls { display:flex; gap:.8rem; align-items:end; flex-wrap:wrap; padding:0 0 .5rem; min-width:0; }
.graph-controls label { display:grid; gap:.2rem; color:var(--muted); font-size:.72rem; min-width:0; }
.graph-controls input { font:inherit; color:var(--text); background:#202a36; border:1px solid var(--line); border-radius:5px; padding:.45rem .65rem; max-width:100%; min-width:0; }
.trace-group { background:#0e131a; border:1px solid var(--line); border-radius:7px; padding:.55rem; min-width:0; }
.trace-group[data-selected='true'] { border-color:var(--blue); border-width:2px; }
.trace-group[data-selected='true'] .trace-head strong::before { content:'▸ '; }
.trace-head { display:flex; flex-wrap:wrap; gap:.45rem; align-items:baseline; font-size:.8rem; font-weight:400; margin-bottom:.4rem; overflow-wrap:anywhere; min-width:0; }
.trace-head strong { font-size:.9rem; }
.trace-actions { display:flex; gap:.4rem; flex-wrap:wrap; margin-bottom:.4rem; }
.trace { display:flex; gap:.35rem; align-items:center; min-width:0; overflow-x:auto; list-style:none; margin:0; padding:0 0 .35rem; }
.trace > li { display:flex; align-items:center; flex:0 0 auto; }
.trace-node { max-width:190px; min-width:140px; text-align:left; background:var(--panel); padding:.7rem; position:relative; border:1px solid var(--line); border-radius:5px; color:var(--text); display:block; }
.trace-node.skipped { border-style:dashed; opacity:.72; }.trace-node.running.live::after { content:''; position:absolute; width:8px; height:8px; border-radius:50%; background:var(--blue); top:.4rem; right:.4rem; animation:pulse 1.4s infinite; }
.trace-node.not_started { border-style:dotted; }
.trace-node.blocked { border-left:4px solid var(--amber); }
.trace-node.failed { border-left:4px solid var(--red); }
.trace-node.completed { border-left:4px solid var(--green); }
.trace-node.running { border-left:4px solid var(--blue); }
.trace-node.not_observed { border-style:dashed; border-left:4px solid var(--red); opacity:.8; }
.trace-node.unknown { border-style:dotted; opacity:.8; }
#graph-legend { color:var(--muted); font-size:.75rem; }
#graph-legend summary { cursor:pointer; }
.legend-list { list-style:none; margin:.4rem 0 0; padding:0; display:grid; gap:.25rem; }
.legend-list li { display:flex; gap:.45rem; align-items:baseline; overflow-wrap:anywhere; min-width:0; }
.legend-swatch { flex:0 0 auto; width:1.1rem; height:.85rem; min-width:1.1rem; max-width:1.1rem; display:inline-block; border:1px solid var(--line); border-radius:3px; }
/* The swatch is a SECOND signal, never the only one: each legend row states its
   state in words, and the shape cue (solid / dotted / dashed / coloured rule)
   is what carries over to the node itself. */
[data-legend-state='not_started'] .legend-swatch { border-style:dotted; }
[data-legend-state='running'] .legend-swatch { border-left:4px solid var(--blue); }
[data-legend-state='completed'] .legend-swatch { border-left:4px solid var(--green); }
[data-legend-state='blocked'] .legend-swatch { border-left:4px solid var(--amber); }
[data-legend-state='failed'] .legend-swatch { border-left:4px solid var(--red); }
[data-legend-state='skipped'] .legend-swatch { border-style:dashed; opacity:.72; }
[data-legend-state='not_observed'] .legend-swatch { border-style:dashed; border-left:4px solid var(--red); }
[data-legend-state='unknown'] .legend-swatch { border-style:dotted; opacity:.8; }
[data-legend-arrow] .legend-swatch,[data-legend-manifest] .legend-swatch { border:0; color:var(--muted); }
.arrow { color:var(--muted); align-self:center; }
.activity { max-height:420px; overflow:auto; border:1px solid var(--line); border-radius:7px; background:#0e131a; }
.activity time { color:var(--muted); font-size:.72rem; }
.history { display:grid; gap:.6rem; }.history-row { display:grid; grid-template-columns:minmax(160px,.6fr) 1fr auto; gap:.7rem; align-items:center; min-width:0; overflow-wrap:anywhere; }
/* A selectable row is a real button: full-width, start-aligned, and its focus
   ring must survive the card background. Selection is signalled by a left rule
   AND the word "selected" — never by colour alone (invariant 7). */
button.history-row { width:100%; text-align:start; font:inherit; border-radius:7px; }
button.history-row[aria-current='true'] { border-color:var(--blue); border-left:5px solid var(--blue); }
/* A trace CLAIMED by the selected parent task. Marked with a dashed rule as
   well as a colour, and it also carries the words 'in the selected session', so
   colour is never the only signal (invariant 7). */
button.history-row[data-session-member='true'] { border-left:5px dashed var(--blue); }
.history-row.static { opacity:.85; border-style:dashed; }
.history-index { display:grid; gap:.6rem; }
.history-find { display:grid; gap:.25rem; color:var(--muted); font-size:.75rem; margin:.2rem 0 .6rem; min-width:0; }
.history-find input { font:inherit; color:var(--text); background:#202a36; border:1px solid var(--line); border-radius:5px; padding:.45rem .65rem; max-width:100%; min-width:0; }
.integrity { color:var(--muted); font-size:.75rem; }
.scope-statement { grid-column:1/-1; margin:.35rem 0 0; overflow-wrap:anywhere; min-width:0; }
[data-scope-reason] { margin:.15rem 0 .45rem; overflow-wrap:anywhere; min-width:0; }
.session-cost { color:var(--muted); font-size:.75rem; overflow-wrap:anywhere; }
.drawer { position:fixed; z-index:30; top:0; right:0; height:100vh; width:min(620px,92vw); background:var(--panel2); border-left:1px solid var(--line); padding:1rem; overflow:auto; box-shadow:-15px 0 40px #0008; }
.drawer-head { display:flex; justify-content:space-between; align-items:center; position:sticky; top:-1rem; background:var(--panel2); padding:1rem 0; z-index:1; }
.drawer section { border-top:1px solid var(--line); padding:.8rem 0; }
.drawer dl { display:grid; grid-template-columns:minmax(110px,.35fr) 1fr; gap:.4rem .8rem; }
.drawer dt { color:var(--muted); }.drawer dd { margin:0; overflow-wrap:anywhere; }
.backdrop { position:fixed; inset:0; z-index:25; background:#0008; }
.artifact-link { margin:.25rem .35rem .25rem 0; }.artifact-link[disabled] { opacity:.45; }
dialog { width:min(900px,94vw); max-height:90vh; background:var(--panel); color:var(--text); border:1px solid var(--line); } dialog::backdrop { background:#000b; } pre { white-space:pre-wrap; overflow-wrap:anywhere; }.warning { color:var(--amber); }
@keyframes pulse { 50% { transform:scale(1.5); opacity:.35; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
@media (max-width:900px) { .global-header { grid-template-columns:minmax(0,1fr); gap:.35rem; }.health-line { justify-content:flex-start; }.header-actions { justify-content:flex-start; flex-wrap:wrap; width:100%; }.session-control select { max-width:min(72vw,430px); }.totals { flex-wrap:wrap; }.workspace { grid-template-columns:minmax(0,1fr); }.delivery-board { grid-template-columns:repeat(6,78vw); }.history-row { grid-template-columns:1fr; } }
@media (max-width:420px) { .section-heading { flex-wrap:wrap; }.activity-controls { flex-direction:column; align-items:stretch; }.activity-controls select { width:100%; } main { padding:0 .65rem 2rem; }.filters { padding:.55rem .65rem; }.session-control { width:100%; display:grid; grid-template-columns:minmax(0,1fr); }.session-control select { max-width:100%; min-width:0; width:100%; }.delivery-board { grid-template-columns:repeat(6,86vw); }.app-grid,.attention-grid { grid-template-columns:1fr; }.graph { min-height:180px; }.drawer { width:100vw; }.drawer dl { grid-template-columns:1fr; gap:.15rem; }.global-header { position:static; } }
`;

export const OBSERVE_JS = String.raw`(() => {
  'use strict';
  // Filter/expansion/paging state lives here and in the URL only. Nothing is
  // persisted: no localStorage, no cookie, no server-side map (invariant 1).
  const state = {
    snapshot:null, selectedPass:null, selectedSession:'', eventSource:null, autoScroll:true, reconnects:0,
    timeMode:'local', timeModePinned:false, order:'newest_first', group:'none', eventKind:'', outcome:'',
    // There is deliberately no sessionResetReason: the out-of-window statement
    // is DERIVED from the current snapshot on every render
    // (sessionUnavailableNote), so it can neither go stale nor be cleared by the
    // next render before the operator has read it.
    passFilter:'', traceFilter:'', graphQuery:'', historyQuery:'',
    openAttentionGroups:new Set(), limits:{}, newSincePaused:0,
    // Paused-counter bookkeeping. Both hold EVENT IDS — real identity, never a
    // snapshot counter or a timestamp comparison (invariant 2).
    lastEntryIds:null, pausedIds:null,
    // Set by a control that will be destroyed by the re-render it triggers, so
    // render() can put keyboard focus back where the operator left it.
    pendingFocus:null,
  };` + TIME_POLICY_JS + String.raw`
  const q = (id) => document.getElementById(id);
  const token = new URL(location.href).searchParams.get('token') || '';
  const tokenQuery = () => '?token=' + encodeURIComponent(token);
  const node = (tag, attrs, ...children) => {
    const element = document.createElement(tag);
    for (const [key,value] of Object.entries(attrs || {})) {
      if (key === 'class') element.className = value;
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key.startsWith('aria-')) element.setAttribute(key, value);
      else if (key === 'onclick') element.addEventListener('click', value);
      else if (key === 'disabled') element.disabled = value;
      else element[key] = value;
    }
    for (const child of children.flat()) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return element;
  };
  const badge = (text, cls) => node('span',{class:'pill ' + (cls || text)},text);
  const empty = (text) => node('div',{class:'empty'},text);
  // Mirrors formatCostAggregate in src/runtime/cost.ts. 'none' is a known
  // zero; a partial total shows the recorded floor plus the unknown count so
  // the unknown component is never read as free (#88, #90).
  const formatCost = (value, quality, unknown) => {
    if (quality === 'none') return '$0.00';
    const n = Number(unknown || 0);
    const amount = (quality === 'estimated' ? '~' : '') + '$' + Number(value || 0).toFixed(2);
    if (quality === 'unavailable') return n > 0 ? 'unavailable (' + n + (n === 1 ? ' turn)' : ' turns)') : 'unavailable';
    if (n > 0) return amount + ' recorded + ' + n + ' unknown';
    return amount + (quality === 'partial' ? ' partial' : '');
  };
  // SHARED PRIMITIVE — timestamps. Every absolute instant renders through this
  // as a real <time datetime=<canonical UTC ISO>> with a visible zone token and
  // exact UTC in the title. Display mode never influences ordering.
  const stamp = (value, prefix) => timeEl(value, state.timeMode, prefix);
  const stampText = (value) => formatStamp(value, state.timeMode);
  // SHARED PRIMITIVE — truncation disclosure. A filtered or capped count is
  // never presented as a total. "capped" is false | true | string: a bare true
  // keeps the original '(delivery capped)' cause, and a string names a different
  // one — the graph's truncation is a CLIENT DISPLAY cap, and printing
  // 'delivery capped' there would state a false cause.
  const disclose = (shown, total, capped) =>
    shown >= total && !capped
      ? String(total) + ' shown'
      : 'showing ' + shown + ' of ' + total + (capped ? ' (' + (capped === true ? 'delivery capped' : capped) + ')' : '');
  // Disclosure for a section that ALSO carries a text search. The search
  // narrowing is never subtracted from the recorded total: the operator is told
  // how many records exist, how many the search matched, and how many are on
  // screen. Recomputing the denominator from the post-search array is the exact
  // lie sectionScope's doc-comment forbids.
  const discloseSearch = (shown, matched, total, capped, query) => query
    ? 'showing ' + shown + ' of ' + matched + ' matching · ' + total + ' recorded' + (capped ? ' (' + (capped === true ? 'delivery capped' : capped) + ')' : '')
    : disclose(shown, total, capped);
  // SHARED PRIMITIVE — the closed scope vocabulary. Every major section reports
  // one of exactly these five kinds, so 'which projection am I looking at' is
  // answerable without reading the code.
  const SCOPE_KINDS = {
    live_app_wide:'App-wide · live',
    filtered_app_wide:'App-wide · filtered',
    parent_task_session:'This session (parent task)',
    single_trace:'This trace only',
    app_wide_context:'App-wide (not narrowed by this selection)',
  };
  // The stated reason a section is DELIBERATELY not narrowed by the current
  // selection. 'Unaffected' is not an escape hatch: a section may only declare
  // app_wide_context if it can say why (invariant 14).
  const APP_WIDE_REASONS = {
    'apps-scope':'Monthly budget is an app-wide month-to-date fact; a session cannot narrow it.',
    'pending-intake-scope':'Pending intake carries no trace or task identity, so a session cannot include it.',
    'sources-scope':'Source health is CURRENT observer health, not health as of this session.',
    'history-index-scope':'The recorded-session index is navigation, so it is not narrowed by the current selection.',
  };
  // Session kind WINS over filters for a session-scoped section — a selected
  // trace is a narrower projection than a filter. The active filters are not
  // discarded: they still appear in the badge DETAIL through activeFacets().
  const scopeKind = (scope, options) => (options && options.appWide)
    ? 'app_wide_context'
    : scope ? (scope.kind === 'task' ? 'parent_task_session' : 'single_trace')
    : (activeFacets().length ? 'filtered_app_wide' : 'live_app_wide');
  // SHARED PRIMITIVE — section scope badge. The kind LABEL and the machine
  // readable kind are produced at one site, so badge text and data-scope-kind
  // can never drift.
  const sectionScopeText = (kind, detail, disclosure, ordering, note) =>
    [SCOPE_KINDS[kind], detail, disclosure, ordering, note].filter(Boolean).join(' · ');
  // Writes the badge, its machine-readable kind, the aria wiring, and — for an
  // intentionally app-wide section — a stated reason rendered as a ".meta" line
  // in the SECTION BODY (not inside the heading flex row, which would wrap
  // unpredictably) and joined into the list's aria-describedby.
  const renderSectionScope = (badgeId, listId, kind, text, reason) => {
    const badge = q(badgeId);
    badge.textContent = text;
    badge.dataset.scopeKind = kind;
    const list = q(listId);
    if (!list) return;
    const reasonId = badgeId + '-reason';
    let line = q(reasonId);
    if (reason) {
      if (!line) { line = node('p',{class:'meta',id:reasonId,dataset:{scopeReason:kind}}); list.parentNode.insertBefore(line, list); }
      line.dataset.scopeReason = kind;
      line.textContent = reason;
      line.hidden = false;
    } else if (line) { line.textContent = ''; line.hidden = true; }
    list.setAttribute('aria-describedby', reason && line && !line.hidden ? badgeId + ' ' + reasonId : badgeId);
  };
  // SHARED PRIMITIVE — paging. EVERY capped collection reads its cap from here,
  // so a section cannot reintroduce a bare .slice(): the cap is a named key with
  // a declared default, and the same key is what showMore raises and what the
  // URL carries.
  // EVERY key here belongs to exactly ONE section. Two sections sharing a key
  // share a cap, a URL parameter, and — because restorePendingFocus resolves a
  // pager by key — a focus target: paging one would silently re-paginate the
  // other and throw keyboard focus into it. 'history-index' (recorded sessions)
  // and 'history' (completion integrity records) are independent lists that
  // happen to live in one <section>, so they hold independent keys.
  const DEFAULT_LIMITS = {graph:20, 'history-index':30, history:30, activity:40, 'activity-undated':40, 'activity-history':40, 'pending-intake':40};
  const ATTENTION_LIMIT = 20;
  const limitFor = (key) => state.limits[key] || DEFAULT_LIMITS[key] || ATTENTION_LIMIT;
  // Each Show more names its own section, because several render at once and
  // 'Show more' alone is an ambiguous accessible name. Activating it re-renders
  // the section that owns the button, which destroys the button; pendingFocus
  // restores focus to its replacement, or to the list when nothing is left to
  // reveal, so keyboard paging never dumps the operator at <body>.
  const showMore = (key, step, label, listId) => node('button',{
    type:'button', class:'session-link', dataset:{moreKey:key},
    'aria-label':'Show more ' + label,
    onclick:()=>{ state.limits[key]=limitFor(key)+(step||40); state.pendingFocus={key,listId}; syncUrl(); },
  },'Show more');
  // Focus is restored WITHIN the list that owns the control, never by a global
  // document lookup: a global querySelector returns the first match in DOM
  // order, which lands on whichever section happens to render first rather than
  // the one the operator was working in.
  function restorePendingFocus() {
    const pending = state.pendingFocus;
    if (!pending) return;
    state.pendingFocus = null;
    const list = q(pending.listId);
    // rowId, not sessionId: several index rows legitimately navigate to the SAME
    // session (a parent task and each trace it claims), so a session id does not
    // identify the control that was activated.
    const control = list && pending.rowId
      ? list.querySelector('[data-row-id="' + CSS.escape(pending.rowId) + '"]')
      : list && pending.key
      ? list.querySelector('[data-more-key="' + CSS.escape(pending.key) + '"]')
      : null;
    const target = control || list;
    if (!target) return;
    if (target !== control && !target.hasAttribute('tabindex')) target.setAttribute('tabindex','-1');
    target.focus();
  }
  // SHARED PRIMITIVE — ordering. Reads the projection's declared sort key and
  // tie-breaker rather than hardcoding them, and NEVER reverses the tie-break:
  // 'chronological' is not [...rows].reverse().
  const orderClientRows = (rows, ordering, direction) => {
    if (!ordering) return rows;
    const sign = direction === 'newest_first' ? -1 : 1;
    const key = (row) => String(row[ordering.sort_key] || '');
    const id = (row) => String(row.id || row.filename || '');
    return [...rows].sort((a,b) => { const c = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; return c ? c*sign : (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0); });
  };
  const directionLabel = (direction) => direction === 'newest_first' ? 'Newest first' : 'Oldest first';
  const currentFilters = () => ({ app:q('app-filter').value, role:q('role-filter').value, status:q('status-filter').value });
  // SHARED PRIMITIVE — facet naming. A filter is useless as an explanation
  // unless the badge says WHAT it narrowed. 'status' filters the PASS; 'event
  // kind' and 'tool outcome' filter the EVENT; trace/pass filter the pass.
  const activeFacets = () => {
    const f = currentFilters(), parts = [];
    if (f.app) parts.push('app=' + f.app + ' (pass)');
    if (f.role) parts.push('role=' + f.role + ' (pass)');
    if (f.status) parts.push('status=' + f.status + ' (pass)');
    if (state.traceFilter) parts.push('trace=' + state.traceFilter + ' (pass)');
    if (state.passFilter) parts.push('pass=' + state.passFilter + ' (pass)');
    if (state.eventKind) parts.push('event kind=' + state.eventKind + ' (event)');
    if (state.outcome) parts.push('tool outcome=' + state.outcome + ' (event)');
    return parts;
  };
  const withFacets = (label) => { const parts = activeFacets(); return parts.length ? label + ' · filtered by ' + parts.join(', ') : label; };
  // A section-local text search is named in THAT section's label only. Putting
  // it into activeFacets() would make every other badge claim it was narrowed by
  // a search it never applied.
  const withSearch = (label, query, noun) => query ? label + ' · filtered by ' + noun + ' search=' + query : label;
  const ticketNumber = (value) => { const match=/(?:^|#)(\d+)$/.exec(String(value||'').trim()); return match?Number(match[1]):null; };
  function setConnection(value, label) { q('connection').className='status '+value; q('connection').textContent=label || value; }
  async function fetchSnapshot() {
    const response = await fetch('/api/v1/snapshot'+tokenQuery(), {cache:'no-store'});
    if (!response.ok) throw new Error('snapshot request failed: '+response.status);
    applySnapshot(await response.json());
  }
  function connect(cursor) {
    if (state.eventSource) state.eventSource.close();
    const suffix = tokenQuery() + (cursor ? '&cursor='+encodeURIComponent(cursor) : '');
    const es = new EventSource('/api/v1/events'+suffix);
    state.eventSource=es;
    es.onopen=()=>{ setConnection('live','live'); q('banner').hidden=true; };
    es.onerror=()=>{ state.reconnects++; setConnection('reconnecting','reconnecting'); q('banner').hidden=false; q('banner').textContent='Live updates disconnected; durable state is unchanged. Reconnecting…'; };
    es.addEventListener('snapshot',(event)=>applySnapshot(JSON.parse(event.data)));
    es.addEventListener('resync',async()=>{ q('banner').hidden=false; q('banner').textContent='Update cursor expired; resynchronizing from durable state.'; await fetchSnapshot(); });
    es.addEventListener('entity.upsert',(event)=>{ const payload=JSON.parse(event.data); if(payload.snapshot) applySnapshot(payload.snapshot); });
  }
  function applySnapshot(snapshot) {
    state.snapshot=snapshot;
    setConnection('live','live');
    render();
  }
  function render() {
    const s=state.snapshot; if(!s) return;
    applyTimePolicy(s);
    populateSessions(s);
    const scope=selectedSession(s);
    // "session", not "replay": nothing is animated and no intermediate state is
    // reconstructed. The word had to change here as well as in the section
    // heading, or the page would still teach the wrong model (design.md §5.5).
    q('identity').replaceChildren(document.createTextNode(s.org.name+' · '+s.org.state_home_id+' · '+(scope?'historical session · ':'')+'updated '),stamp(s.generated_at));
    q('timezone').textContent=zoneStatement(state.timeMode);
    renderClockSkew(s);
    q('session-mode').className='pill '+(scope?'unknown':'live'); q('session-mode').textContent=scope?'historical':'live';
    q('activity-title').textContent=scope?'Historical activity':'Live activity';
    const totals=scope?sessionTotals(s,scope):s.totals;
    q('totals').replaceChildren(
      node('span',{},totals.active_passes+' active'),
      node('span',{},totals.pending_approvals+' approvals'),
      node('span',{},totals.delivery_ready+' ready'),
      node('span',{},formatCost(totals.recorded_cost_usd,totals.usage_quality,totals.cost&&totals.cost.unknown_turns))
    );
    populateFilters(s);
    renderScopeStatement(s,scope);
    renderAttention(s,scope); renderApps(s,scope); renderActivityHistory(s,scope); renderPendingIntake(s,scope); renderDelivery(s,scope); renderGraph(s,scope); renderActivity(s,scope); renderHistoryIndex(s); renderHistory(s,scope); renderSources(s,scope); renderValidationCampaigns(s,scope);
    // A snapshot must never steal focus: the drawer takes focus when it OPENS,
    // not on each of the re-renders SSE drives while it is open.
    if(state.selectedPass) { const pass=s.passes.find((p)=>p.id===state.selectedPass); if(pass) renderDrawer(pass,false); else closeDrawer(); }
    restorePendingFocus();
  }
  // The read model DECLARES the default display zone; the client no longer
  // assumes one. An explicit ?tz= (or a toggle press) pins the operator's
  // choice and the declaration never overrides it.
  function applyTimePolicy(s) {
    if(state.timeModePinned) return;
    const declared=s.time_policy&&s.time_policy.display_timezone;
    const mode=declared==='UTC'?'utc':'local';
    if(mode===state.timeMode) return;
    state.timeMode=mode; syncTimeControl();
  }
  // The header total always states WHAT it covers: apps, time range, filters,
  // and trace scope. The server owns apps/range/filters (totals.scope_statement);
  // the trace scope is client-owned because session selection lives only in the
  // client. The trace is named with its app, because a bare trace id is
  // ambiguous whenever two apps share one (invariant 3).
  //
  // The two filter classes are reported SEPARATELY because they do different
  // things. A snapshot filter (operon observe --app/--ticket/--since/…) narrowed
  // what the server delivered, so the totals already exclude everything it
  // dropped; reading only activeFacets() printed 'filters: none' under
  // --ticket 42, affirmatively denying a narrowing that had occurred. A
  // display filter narrows the SECTIONS below and deliberately does not narrow
  // these totals, which are the projection's ledger-first aggregate — recomputing
  // them client-side would fork the none/unavailable rule the whole surface
  // shares (invariant 4, #89). Saying which is which is what makes both true.
  function renderScopeStatement(s,scope) {
    const statement=s.totals&&s.totals.scope_statement;
    const snapshotFilters=statement&&statement.filters?statement.filters:[];
    const displayFilters=activeFacets();
    const children=[document.createTextNode(
      'apps: '+(statement&&statement.apps.length?statement.apps.join(', '):'none')+' · time range: ')];
    if(statement&&statement.time_range.basis==='since_filter') {
      // Through the SHARED time policy like every other absolute instant: a raw
      // ISO text node carries no zone token, no hover UTC, and ignores the
      // Local/UTC toggle the rest of the page obeys.
      children.push(document.createTextNode('since '));
      children.push(stamp(statement.time_range.start_utc));
      children.push(document.createTextNode(' through '));
    } else children.push(document.createTextNode('all recorded through '));
    children.push(stamp(statement?statement.time_range.end_utc:s.generated_at));
    children.push(document.createTextNode(
      ' · snapshot filters: '+(snapshotFilters.length?snapshotFilters.join(', '):'none')+
      ' · display filters: '+(displayFilters.length?displayFilters.join(', ')+' (narrow the sections below, not these totals)':'none')+
      ' · trace: '+
      (scope?(scope.unavailable?scope.id+' (not in the delivered window)'
        :scope.kind==='task'?'parent task '+scope.task.task_id+' ('+(scope.app||'org')+')'
        :scope.trace.trace_id+' ('+scope.trace.app+')'):'none')));
    q('scope-statement').replaceChildren(...children);
  }
  function syncTimeControl() { q('tz-toggle').setAttribute('aria-pressed',String(state.timeMode==='utc')); }
  function syncOrderControl() { q('order-toggle').setAttribute('aria-pressed',String(state.order==='chronological')); }
  function renderClockSkew(s) {
    const skew=s.time_policy&&s.time_policy.skew, element=q('clock-skew');
    if(!skew) { element.hidden=true; element.textContent=''; return; }
    element.hidden=false;
    // A warning, never a negative duration: the value is how far AHEAD the
    // furthest recorded instant is of this observer's clock.
    element.textContent='clock skew · '+skew.future_instants+' instant(s) up to '+Math.round(Math.max(0,skew.max_future_ms)/1000)+'s ahead of the observer clock';
  }
  function populateFilters(s) {
    const app=q('app-filter'), role=q('role-filter'), status=q('status-filter');
    syncOptions(app,s.apps.map((v)=>v.name)); syncOptions(role,[...new Set(s.passes.map((v)=>v.role))]); syncOptions(status,[...new Set([...s.passes.map((v)=>v.status),...s.delivery.map((v)=>v.state)])]);
    // Default is ALL kinds: narrowing by default would silently hide evidence.
    syncOptions(q('event-kind-filter'),[...new Set(s.passes.flatMap((v)=>v.events.map((e)=>e.kind)))]);
    q('event-kind-filter').value=state.eventKind;
    // Trace and pass are FILTERS, not decoration, so they get real controls.
    // Option VALUES are the projection's composite identities ('trace:app:id',
    // 'pass:app:runId') — never a bare trace id or run id, which are not
    // globally unique (invariant 3).
    syncOptionPairs(q('trace-filter'),s.traces.map((v)=>[v.id,v.app+' · '+v.trace_id+' · '+v.pipeline]),state.traceFilter);
    syncOptionPairs(q('pass-filter'),s.passes.map((v)=>[v.id,v.app+' · '+v.run_id+' · '+v.role+'/'+v.pass]),state.passFilter);
  }
  function syncOptions(select, values) {
    const current=select.value, existing=new Set([...select.options].map((o)=>o.value));
    for(const value of values.sort()) if(value&&!existing.has(value)) select.append(node('option',{value},value));
    select.value=current;
  }
  // A selected value that has left the window stays selectable and is marked as
  // such, rather than silently resetting to 'all' and widening what the
  // operator is looking at without telling them.
  function syncOptionPairs(select, pairs, selected) {
    const seen=new Set([...select.options].map((o)=>o.value));
    for(const [value,label] of [...pairs].sort((a,b)=>a[1]<b[1]?-1:a[1]>b[1]?1:0)) if(value&&!seen.has(value)) { select.append(node('option',{value},label)); seen.add(value); }
    if(selected&&!seen.has(selected)) select.append(node('option',{value:selected},selected+' — not in current window'));
    select.value=selected;
  }
  function sessions(s) {
    const claimed=new Set();
    const tasks=s.parent_tasks.map((task)=>{
      const taskTraces=s.traces.filter((trace)=>(trace.parent_task_id===task.task_id||task.trace_ids.includes(trace.trace_id))&&(!task.app||trace.app===task.app));
      const traceKeys=new Set(taskTraces.map((trace)=>trace.id)), passIds=new Set(taskTraces.flatMap((trace)=>trace.pass_ids));
      for(const id of traceKeys) claimed.add(id);
      return { id:'task:'+task.task_id, kind:'task', task, traceKeys, passIds, app:task.app, startedAt:task.started_at, finishedAt:task.ended_at, status:task.status, label:task.task_id+' · '+(task.app||'org')+' · '+task.status+' · '+stampText(task.started_at) };
    });
    const traces=s.traces.filter((trace)=>!claimed.has(trace.id)).map((trace)=>({ id:trace.id, kind:'trace', trace, traceKeys:new Set([trace.id]), passIds:new Set(trace.pass_ids), app:trace.app, startedAt:trace.started_at, finishedAt:trace.finished_at, status:trace.status, label:trace.trace_id+' · '+trace.app+' · '+trace.pipeline+' · '+stampText(trace.started_at) }));
    return [...tasks,...traces].sort((a,b)=>{ const x=a.startedAt||'', y=b.startedAt||''; return x<y?1:x>y?-1:(a.id<b.id?-1:a.id>b.id?1:0); });
  }
  function populateSessions(s) {
    const select=q('session-selector'), available=sessions(s), current=state.selectedSession;
    const optionFor=(v)=>{ const option=node('option',{value:v.id},v.label); const iso=v.startedAt?new Date(v.startedAt).toISOString():''; if(iso) option.setAttribute('title',iso); return option; };
    const taskOptions=available.filter((v)=>v.kind==='task').map(optionFor);
    const traceOptions=available.filter((v)=>v.kind==='trace').map(optionFor);
    select.replaceChildren(node('option',{value:''},'Live org'),...(taskOptions.length?[node('optgroup',{label:'Parent tasks'},...taskOptions)]:[]),...(traceOptions.length?[node('optgroup',{label:'Standalone traces'},...traceOptions)]:[]));
    // A ?session= naming a record that has left the delivered window KEEPS the
    // selection, exactly as syncOptionPairs keeps an out-of-window trace or pass
    // filter. A historical view must not jump back to live until the operator
    // picks 'Live org' (invariant 15): silently widening the scope hands the
    // operator org-wide numbers under a link that promised one session, and the
    // reset also destroyed the shared link's meaning.
    if(current&&!available.some((v)=>v.id===current)) select.append(node('option',{value:current},current+' — not in current window'));
    select.value=current;
  }
  // Where a recorded id can actually be NAVIGATED to. available is the set of
  // selectable sessions; claimedBy maps a trace a session COVERS but that is
  // not itself selectable onto the session that claims it. Both are read from
  // sessions() — the one correlation the Session control uses — so a row and the
  // dropdown can never disagree about whether a record is reachable.
  //
  // A trace claimed only through a parent task's recorded refs.traces has a null
  // parent_task_id and therefore a null parent_session_id. Resolving through
  // parent_session_id alone reported such a trace as "not in the current window"
  // while its claiming session was sitting in the dropdown — a false statement
  // about durable state, and the correlation is a real recorded reference, not
  // an inference (invariant 2).
  function sessionTargets(s) {
    const all=sessions(s), available=new Set(all.map((v)=>v.id)), claimedBy=new Map();
    for(const session of all) for(const traceKey of session.traceKeys) if(traceKey!==session.id) claimedBy.set(traceKey,session.id);
    return { available, claimedBy, resolve:(id)=>available.has(id)?id:(claimedBy.get(id)||null) };
  }
  // The selection is honoured even when the delivered window no longer contains
  // it. The returned scope carries NO records rather than falling through to the
  // whole org, so every section reports an honest empty projection for the
  // session the operator asked for.
  function selectedSession(s) {
    if(!state.selectedSession) return null;
    const found=sessions(s).find((v)=>v.id===state.selectedSession);
    if(found) return found;
    const isTask=state.selectedSession.indexOf('task:')===0;
    return { id:state.selectedSession, kind:isTask?'task':'trace', unavailable:true,
      task:null, trace:null, traceKeys:new Set(), passIds:new Set(), app:null,
      startedAt:'', finishedAt:'', status:'unknown', label:state.selectedSession };
  }
  // The stated reason, DERIVED from the current snapshot on every render. A
  // stored one-shot string is wrong in both directions: never cleared it lies
  // about the present, and cleared by the next render it disappears before the
  // operator reads it.
  function sessionUnavailableNote(s) {
    if(!s||!state.selectedSession) return '';
    const scope=selectedSession(s);
    return scope&&scope.unavailable
      ? 'Selected session '+scope.id+' is not in the delivered window, so no records for it are available. It stays selected until you choose "Live org".'
      : '';
  }
  function sessionPasses(s,scope) { return scope?s.passes.filter((pass)=>scope.passIds.has(pass.id)):s.passes; }
  function sessionTraces(s,scope) { return scope?s.traces.filter((trace)=>scope.traceKeys.has(trace.id)):s.traces; }
  function sessionTicketKeys(s,scope) {
    if(!scope) return null; const keys=new Set();
    for(const pass of sessionPasses(s,scope)) { const number=ticketNumber(pass.ticket); if(number!==null) keys.add(pass.app+'#'+number); }
    if(scope.kind==='task'&&scope.task) for(const ref of scope.task.ticket_refs) { const number=ticketNumber(ref); if(number!==null&&scope.task.app) keys.add(scope.task.app+'#'+number); }
    return keys;
  }
  // Cost, quality and active-pass counts are READ from the selected entity's
  // projected, ledger-first aggregate — the client no longer keeps a second
  // implementation of the none-vs-unavailable rule (invariant 4), and the header
  // under a selection is settled-ledger-first exactly like snapshot.totals, so
  // the two can no longer disagree about the same passes (#89).
  //
  // Approvals and delivery readiness stay client-derived: they depend on ticket
  // key resolution only the client performs.
  function sessionTotals(s,scope) {
    // A selection outside the delivered window has NO recorded aggregate. The
    // cost renders 'unavailable', never $0.00: an authoritative zero for records
    // that were simply not delivered is the none/unavailable conflation
    // invariant 4 forbids.
    if(scope.unavailable) return { active_passes:0, pending_approvals:0, delivery_ready:0,
      recorded_cost_usd:0, usage_quality:'unavailable', cost:{unknown_turns:0} };
    const entity=entityCost(scope), tickets=sessionTicketKeys(s,scope);
    const approvals=s.approvals.filter((approval)=>approval.ticket_ref&&tickets.has(approval.app+'#'+ticketNumber(approval.ticket_ref)));
    const delivery=s.delivery.filter((ticket)=>tickets.has(ticket.app+'#'+ticket.issue_number));
    return {
      active_passes:entity.active_passes||0,
      pending_approvals:approvals.filter((approval)=>approval.status==='pending').length,
      delivery_ready:delivery.filter((ticket)=>ticket.state==='ready').length,
      recorded_cost_usd:entity.recorded_cost_usd,
      usage_quality:entity.usage_quality,
      cost:entity.cost,
    };
  }
  function visibleApp(value,scope) { const f=currentFilters(); return (!scope||scope.app===null||value===scope.app||sessionPasses(state.snapshot,scope).some((pass)=>pass.app===value))&&(!f.app||value===f.app); }
  function renderAttention(s,scope) {
    const entities=scope?new Set([...sessionPasses(s,scope).map((pass)=>pass.id),...(scope.kind==='task'&&scope.task?['task:'+scope.task.task_id]:[]),...[...sessionTicketKeys(s,scope)].map((key)=>'ticket:'+key.replace('#',':'))]):null;
    // Occurrence-level scope filtering, using the SAME predicate the flat list
    // used. A group with zero visible occurrences is hidden entirely.
    const visible=(v)=>scope?(v.kind==='source_health'||(v.entity_id&&entities.has(v.entity_id))):(v.app===null||visibleApp(v.app,scope));
    const groups=(s.attention_groups||[]).map((g)=>{
      const occurrences=g.occurrences.filter((o)=>visible({kind:g.kind,app:o.app,entity_id:o.entity_id}));
      return { g, occurrences };
    }).filter((entry)=>entry.occurrences.length>0);
    const items=s.attention.filter(visible);
    const kind=scopeKind(scope);
    // The count line keeps its id and its 'group(s)' / 'most severe first'
    // tokens; it simply becomes the section's scope badge rather than a second,
    // kind-less status string.
    renderSectionScope('attention-count','attention',kind,sectionScopeText(kind,
      withFacets(scope?'this session':'all visible apps'),
      groups.length?groups.length+' group(s) · '+items.length+' item(s)':'clear',
      'most severe first'));
    // Rendered in the order the PROJECTION delivered. Any client-side sort here
    // would reintroduce the instability the ordering contract forbids.
    q('attention').replaceChildren(...(groups.length?groups.map(attentionGroup):[empty('No conditions require interpretation.') ]));
  }
  function attentionGroup(entry) {
    const g=entry.g, shown=entry.occurrences, key='attention:'+g.id, limit=limitFor(key);
    const capped=g.occurrences_truncated;
    const scoped=shown.length!==g.occurrence_count;
    const rows=shown.slice(0,limit);
    const details=node('details',{class:'attention-item '+g.severity,dataset:{group:g.id}},
      node('summary',{},
        node('strong',{},g.title),
        badge(g.severity,g.severity),
        badge(g.kind,g.severity),
        node('span',{class:'meta'},g.occurrence_count+' occurrence'+(g.occurrence_count===1?'':'s')),
      ),
      node('p',{class:'meta'},g.detail),
      node('p',{class:'meta'},scoped||capped?'showing '+shown.length+' of '+g.occurrence_count+(capped?' (delivery capped)':''):disclose(shown.length,g.occurrence_count,capped)),
      ...affectedLines(g.affected),
      node('ol',{},...rows.map((o)=>node('li',{},
        node('span',{},o.summary),
        node('span',{class:'meta'},o.entity_id||'no entity id'),
        stamp(o.occurred_at),
        node('span',{class:'meta'},o.evidence_refs.map((r)=>r.source+': '+r.ref).join(' · ')||'no durable reference recorded'),
        o.detail?node('div',{class:'meta'},o.detail):'',
      ))),
      rows.length<shown.length?showMore(key,ATTENTION_LIMIT,g.title+' occurrences','attention'):'',
    );
    // Expansion is a view affordance, not a filter, so it lives in memory and
    // is restored across every SSE-driven re-render rather than in the URL.
    details.open=state.openAttentionGroups.has(g.id);
    // writeUrl, not syncUrl: this must record the expansion without re-rendering
    // the element the operator is mid-interaction with.
    details.addEventListener('toggle',()=>{ if(details.open) state.openAttentionGroups.add(g.id); else state.openAttentionGroups.delete(g.id); writeUrl(); });
    return details;
  }
  // The concise affected-pass/trace summary (#91). Each line NAMES its facet,
  // because 'builder/implement' is a role/pass label and 'pass:alpha:run-1' is
  // a pass id — printing either under a single 'affected:' heading mislabels
  // one of them. Every value here is a real identity emitted by the projection.
  const AFFECTED_FACETS = [['labels','role/pass'],['passes','pass'],['traces','trace'],['tickets','ticket']];
  function affectedLines(affected) {
    if(!affected) return [];
    const lines=[];
    for(const [field,label] of AFFECTED_FACETS) {
      const values=(affected[field]||[]).filter(Boolean);
      if(!values.length) continue;
      const head=values.slice(0,6);
      lines.push(node('p',{class:'meta'},'affected '+label+(values.length===1?'':'s')+': '+head.join(', ')+(values.length>head.length?' · '+disclose(head.length,values.length,false):'')));
    }
    return lines;
  }
  // App lifecycle is DELIBERATELY not rescoped by a session. The monthly budget
  // is an app-wide month-to-date fact, and a session cannot narrow it: silently
  // rescoping it would present a smaller number that looks like the same one,
  // and blanking it would falsify an app that genuinely has spend (invariant
  // 14). It is narrowed only by the explicit app filter.
  function renderApps(s,scope) {
    const f=currentFilters();
    const apps=s.apps.filter((v)=>!f.app||v.name===f.app);
    const kind=scopeKind(scope,{appWide:Boolean(scope)});
    renderSectionScope('apps-scope','apps',kind,sectionScopeText(kind,
      withFacets('month-to-date · app-wide'),disclose(apps.length,apps.length,false)),
      scope?APP_WIDE_REASONS['apps-scope']:'');
    // Under a selection the SESSION figure is rendered as a second, separately
    // labelled line read from the selected entity's projected ledger-first cost,
    // so the two numbers are never left sitting side by side unexplained.
    const sessionCost=scope?entityCost(scope):null;
    q('apps').replaceChildren(...apps.map((v)=>node('article',{class:'card'},
      node('h3',{},v.name),
      badge(v.lifecycle,v.lifecycle),
      node('p',{class:'meta'},v.repo),
      node('p',{class:'meta'},'month-to-date · app-wide: '+formatCost(v.recorded_monthly_cost_usd,v.usage_quality,v.cost&&v.cost.unknown_turns)+' / $'+v.budget_usd_month.toFixed(0)+' monthly'),
      node('p',{class:'meta'},'window '+(v.cost_window?v.cost_window.start_utc.slice(0,10)+' → now (UTC month)':'month to date')),
      sessionCost&&scope.app===v.name?node('p',{class:'session-cost'},'this session: '+formatCost(sessionCost.recorded_cost_usd,sessionCost.usage_quality,sessionCost.cost&&sessionCost.cost.unknown_turns)):'',
      ...v.channel_gates.map((g)=>node('div',{class:'meta warn'},g)))));
  }
  // The selected session's own projected entity. Cost, quality and active-pass
  // counts are read straight off it: the client no longer maintains a second
  // implementation of the none-vs-unavailable rule (invariant 4), and the header
  // total is ledger-first exactly like snapshot.totals (#89).
  function entityCost(scope) { return scope.kind==='task'?scope.task:scope.trace; }
  function renderActivityHistory(s,scope) {
    const section=s.activity_history, ordering=section.scope.ordering;
    const scopedTraces=scope?new Set(sessionTraces(s,scope).map((trace)=>trace.app+'\u0000'+trace.trace_id)):null;
    // Membership is proved by a real identity: the row's trace is one of the
    // session's traces, or its parent_task_id IS the selected task's id.
    //
    // Comparing parent_task_id against a scope.kind==='task' conditional
    // compared it against null in the TRACE case, so under a single-trace
    // session every same-app row with no parent task was admitted while the
    // badge asserted 'This trace only'. A null parent_task_id is the ABSENCE
    // of a correlation, never a match (invariant 2).
    const inScope=(v)=>{
      if(!scope) return true;
      if(v.trace_id&&scopedTraces.has(v.app+'\u0000'+v.trace_id)) return true;
      return scope.kind==='task'&&Boolean(scope.task)&&v.parent_task_id!==null&&v.parent_task_id===scope.task.task_id;
    };
    const filtered=section.rows.filter((v)=>visibleApp(v.app,scope)&&inScope(v));
    const ordered=orderClientRows(filtered,ordering,state.order);
    const limit=limitFor('activity-history'), rows=ordered.slice(0,limit);
    const kind=scopeKind(scope);
    renderSectionScope('activity-history-scope','activity-history',kind,sectionScopeText(kind,
      withFacets(scope?'this session':'all visible apps'),
      disclose(rows.length,section.scope.total,section.scope.truncated),
      directionLabel(state.order)+' · ties by '+(ordering?ordering.tie_breaker:'id_asc')));
    const targets=sessionTargets(s);
    q('activity-history').replaceChildren(...(rows.length?[...rows.map((v)=>node('li',{},
      node('strong',{},v.summary),
      badge(v.status,v.status),
      node('div',{class:'meta'},v.trigger_label+' · '+v.source_label),
      stamp(v.occurred_at),
      sessionLink(v,targets),
      node('div',{class:'meta'},v.kind+' · '+v.pipeline),
      v.quality_reason?node('div',{class:'meta warn'},v.quality_reason):'',
    )),...(rows.length<ordered.length?[node('li',{},showMore('activity-history',40,'recorded activity','activity-history'))]:[])]:[empty('No recorded non-ticket activity in this view.')]));
  }
  // Navigation reuses the existing read-only session machinery: it sets URL
  // state and re-renders. It adds no route and issues no request.
  function sessionLink(row,targets) {
    const ref=row.session_ref;
    if(!ref) return node('span',{class:'meta'},'no correlated session recorded');
    // Resolved through the SAME claim map the recorded-session index uses, so a
    // trace claimed only by a parent task's refs.traces navigates to that task
    // instead of being declared unreachable.
    const target=targets.resolve(ref.id);
    // aria-disabled, NOT disabled: the button keeps its place in the tab order
    // so the stated reason is reachable, and it carries no aria-label so its
    // accessible name IS its visible text (WCAG 2.5.3).
    if(!target) return node('button',{class:'session-link',type:'button','aria-disabled':'true'},'session '+ref.id+' not selectable — not in current window');
    const label=target===ref.id?'View session '+target:'View recorded session '+target;
    return node('button',{class:'session-link',type:'button',dataset:{sessionTarget:target},'aria-label':label,onclick:()=>{ selectSession(target); }},label);
  }
  function renderPendingIntake(s,scope) {
    const section=s.pending_intake, counts=section.counts;
    if(scope) {
      // Pending items carry no trace/task identity, so a session scope cannot
      // include them. Say so rather than rendering a misleading empty list.
      renderSectionScope('pending-intake-scope','pending-intake','app_wide_context',
        sectionScopeText('app_wide_context','org-wide',section.scope.total+' pending'),
        APP_WIDE_REASONS['pending-intake-scope']);
      q('pending-intake').replaceChildren(node('li',{class:'meta'},'Pending intake is org-wide and not part of this session.'));
      return;
    }
    const filtered=section.rows.filter((v)=>visibleApp(v.app,scope));
    const limit=limitFor('pending-intake'), rows=filtered.slice(0,limit);
    const kind=scopeKind(scope);
    renderSectionScope('pending-intake-scope','pending-intake',kind,sectionScopeText(kind,
      withFacets(counts.pending+' waiting · '+counts.corrupt+' corrupt · '+counts.awaiting_promotion+' awaiting promotion'),
      disclose(rows.length,section.scope.total,section.scope.truncated)),'');
    q('pending-intake').replaceChildren(...(rows.length?[...rows.map((v)=>node('li',{},
      node('strong',{},v.title),
      // State is TEXT, never colour alone.
      badge(v.state_label,v.state==='corrupt'?'failed':v.state==='pending'?'blocked':'unknown'),
      node('div',{class:'meta'},v.trigger_label+' · '+v.source_label),
      // A received time is labelled as such and never implies an event time.
      v.timestamp_basis==='occurred'?stamp(v.occurred_at)
        :v.timestamp_basis==='discovered'?stamp(v.discovered_at,'discovered')
        :node('span',{class:'meta'},'no time recorded'),
      v.quality_reason?node('div',{class:'meta warn'},v.quality_reason):'',
    )),...(rows.length<filtered.length?[node('li',{},showMore('pending-intake',40,'pending intake','pending-intake'))]:[])]:[empty('No pending company events or lifecycle states.')]));
  }
  function renderDelivery(s,scope) {
    const defs=[['ready','Ready'],['building','Building'],['in_review','Reviewing'],['blocked_on_approval','Waiting approval'],['returned','Returned'],['merged','Recently completed']];
    const sessionTickets=sessionTicketKeys(s,scope); const tickets=s.delivery.filter((v)=>visibleApp(v.app,scope)&&(!sessionTickets||sessionTickets.has(v.app+'#'+v.issue_number)));
    const kind=scopeKind(scope);
    renderSectionScope('delivery-scope','delivery',kind,sectionScopeText(kind,
      withFacets(scope?'tickets correlated to this session':'all visible apps'),
      disclose(tickets.length,tickets.length,false)),'');
    // Six columns each reading 'None' is indistinguishable from 'this app has no
    // work'. When a selection correlates to no ticket at all, say exactly that
    // once instead of implying an empty queue six times.
    if(scope&&sessionTickets&&sessionTickets.size===0) {
      q('delivery').replaceChildren(empty('This session has no correlated GitHub tickets. The app-wide delivery queue is hidden by the current selection.'));
      return;
    }
    q('delivery').replaceChildren(...defs.map(([key,label])=>{ const rows=tickets.filter((v)=>v.state===key); return node('section',{class:'delivery-column','aria-label':label},node('h3',{},label,node('span',{class:'meta'},String(rows.length))),...(rows.length?rows.map(ticketCard):[empty('None') ])); }));
  }
  function ticketCard(ticket) {
    return node('button',{class:'ticket',type:'button',onclick:()=>selectTicket(ticket)},node('strong',{},'#'+ticket.issue_number+' '+ticket.title),node('span',{class:'meta'},ticket.app+' · '+(ticket.priority?'p'+ticket.priority:'no priority')+' · '+(ticket.tier||'tier unknown')),ticket.dependency_blocked?node('span',{class:'pill blocked'},'dependency blocked'):'',...ticket.pull_requests.flatMap((p)=>[node('span',{class:'pill'},'PR #'+p.number),badge('review '+p.review_integrity,p.review_integrity==='fresh_approved'?'completed':p.review_integrity==='stale_approval'||p.review_integrity==='changes_requested'?'failed':'unknown'),badge('checks '+p.check_integrity,p.check_integrity==='green'?'completed':p.check_integrity==='red'?'failed':p.check_integrity==='pending'?'blocked':'unknown')]));
  }
  function selectTicket(ticket) { const pass=state.snapshot.passes.find((p)=>p.app===ticket.app&&Number(String(p.ticket||'').replace('#',''))===ticket.issue_number); if(pass) openDrawer(pass.id); }
  // Plain-language state words. Colour is never the only signal: every node
  // renders its state as TEXT drawn from the same closed vocabulary the legend
  // and the stylesheet read (invariant 7).
  const GRAPH_STATE_WORDS={not_started:'not started',running:'running',completed:'completed',blocked:'blocked',failed:'failed',skipped:'skipped by routing',not_observed:'selected, not observed',unknown:'unknown legacy evidence'};
  function humanDuration(ms) {
    const seconds=Math.round(ms/1000);
    if(seconds<60) return seconds+'s';
    const minutes=Math.floor(seconds/60);
    if(minutes<60) return minutes+'m '+(seconds%60)+'s';
    return Math.floor(minutes/60)+'h '+(minutes%60)+'m';
  }
  // A duration is either a real measurement or the verbatim recorded reason it
  // is not one. Never a negative number and never a clock read (invariant 11).
  const durationText=(duration)=>!duration?'duration not recorded':duration.ms===null?duration.unknown_reason:humanDuration(duration.ms);
  // Search matches PROJECTED IDENTITY ONLY — trace id, app, pipeline, ticket,
  // and pass/role names. Never prompt text, previews, branch names, verdicts, or
  // timestamps (invariant 2), and it never touches the network.
  function traceMatchesQuery(trace,query) {
    if(!query) return true;
    const needle=query.toLowerCase();
    const fields=[trace.trace_id,trace.app,trace.pipeline,trace.ticket||''];
    for(const graphNode of trace.graph_nodes||[]) { fields.push(graphNode.pass); fields.push(graphNode.role||''); }
    return fields.some((value)=>String(value).toLowerCase().includes(needle));
  }
  function renderGraph(s,scope) {
    // The graph is a CAPPED collection like every other one, so it goes through
    // the shared scope/paging primitives. Printing the pre-cap total next to a
    // silently sliced list is an affirmative false claim about what is on
    // screen — worse than a bare slice, which at least claims nothing.
    const visible=sessionTraces(s,scope).filter((v)=>visibleApp(v.app,scope));
    const matched=visible.filter((v)=>traceMatchesQuery(v,state.graphQuery));
    const limit=limitFor('graph'), traces=matched.slice(0,limit);
    const capped=traces.length<matched.length?'display capped':false;
    const kind=scopeKind(scope);
    // The DENOMINATOR is THIS section's own pre-search collection — the traces
    // in scope after the session selection and app filter, before the graph
    // search and the display cap. Quoting the org-wide traces_scope.total
    // instead turned every narrowing into a false truncation claim: a
    // single-trace session rendered 'showing 1 of 4' with no pager, telling the
    // operator that three traces had been withheld from a section that withheld
    // nothing. A deliberate scope narrowing is declared by the scope KIND (and
    // by the session/filter detail beside it); truncation is a different fact
    // and only the cap and the projection's delivery limit may assert it.
    //
    // Server-side delivery truncation is still surfaced, as its own named cause,
    // whenever this section is showing the org-wide set the projection capped.
    const deliveryCapped=!scope&&!currentFilters().app&&s.traces_scope&&s.traces_scope.truncated;
    renderSectionScope('graph-scope','graph',kind,sectionScopeText(kind,
      withSearch(withFacets((scope?'this session':'all visible apps')+' · trace(s)'),state.graphQuery,'graph'),
      discloseSearch(traces.length,matched.length,visible.length,capped||(deliveryCapped?'delivery capped':false),state.graphQuery),
      s.traces_scope&&s.traces_scope.ordering?s.traces_scope.ordering.label+' · ties by '+s.traces_scope.ordering.tie_breaker:'Newest start first · ties by trace id'));
    const graph=q('graph');
    graph.replaceChildren(...(traces.length
      ? [...traces.map((trace)=>traceGroup(s,trace)),...(traces.length<matched.length?[showMore('graph',DEFAULT_LIMITS.graph,'execution graph traces','graph')]:[])]
      : [empty(state.graphQuery?'No trace matches this search in the current scope.':'No correlated trace evidence for the selected filters.')]));
  }
  function traceGroup(s,trace) {
    const selected=Boolean(state.passFilter)&&(trace.graph_nodes||[]).some((graphNode)=>graphNode.pass_id===state.passFilter);
    const counts=trace.pass_counts||{observed:trace.pass_ids.length,skipped:0,missing:0,required:null};
    const items=[];
    (trace.graph_nodes||[]).forEach((graphNode,index)=>{
      if(index) items.push(node('li',{class:'arrow','aria-hidden':'true'},'→'));
      items.push(node('li',{},graphNodeElement(s,graphNode)));
    });
    return node('section',{class:'trace-group',dataset:{traceId:trace.id,selected:String(selected)},'aria-label':'Trace '+trace.trace_id+' in '+trace.app},
      // Everything an operator needs to identify the trace is rendered as TEXT.
      // Putting the id only into an aria-label — the original defect — made it
      // invisible to the sighted operator reading the graph.
      node('h3',{class:'trace-head'},
        node('strong',{},trace.trace_id),
        node('span',{class:'meta'},trace.app+' · '+trace.pipeline+' · '+(trace.ticket||'no ticket')),
        badge(trace.status,trace.status),
        stamp(trace.started_at,'started'),
        node('span',{class:'meta'},'duration '+durationText(trace.duration)),
        node('span',{class:'meta'},counts.observed+' observed · '+counts.skipped+' skipped · '+counts.missing+' not observed'),
        node('span',{class:'meta'},formatCost(trace.recorded_cost_usd,trace.usage_quality,trace.cost&&trace.cost.unknown_turns)),
        trace.manifest==='not_recorded'?node('span',{class:'meta warn'},'Trace manifest not recorded — expected stages unknown'):'',
        selected?node('span',{class:'meta'},'selected'):'',
      ),
      node('div',{class:'trace-actions'},
        // Reuses the landed ?trace= filter end to end. The COMPOSITE identity is
        // written, never the bare trace_id: two apps routinely share one, and a
        // bare id fails to resolve through s.traces.find(t => t.id === …)
        // (invariant 3).
        node('button',{class:'session-link',type:'button',dataset:{traceFilter:trace.id},'aria-label':'Filter activity to trace '+trace.trace_id+' in '+trace.app,
          onclick:()=>{ state.traceFilter=trace.id; q('trace-filter').value=trace.id; syncUrl(); }},'Filter activity to this trace'),
      ),
      node('ol',{class:'trace'},...items));
  }
  function graphNodeElement(s,graphNode) {
    const word=GRAPH_STATE_WORDS[graphNode.state_token]||graphNode.state_token;
    if(graphNode.kind!=='pass') {
      // Non-interactive: there is no pass record to inspect. The routing reason
      // is assigned as TEXT, never innerHTML (invariant 5).
      return node('div',{class:'trace-node '+graphNode.state_token,dataset:{nodeState:graphNode.state_token},'aria-label':word+' '+graphNode.pass},
        node('strong',{},graphNode.pass),
        node('div',{},word),
        graphNode.reason?node('div',{class:'meta'},graphNode.reason):'',
        badge(word,graphNode.state_token==='skipped'?'unknown':'failed'));
    }
    const pass=s.passes.find((p)=>p.id===graphNode.pass_id);
    return node('button',{class:'trace-node '+graphNode.state_token+(graphNode.liveness?' '+graphNode.liveness:''),type:'button',
      dataset:{passId:graphNode.pass_id,nodeState:graphNode.state_token},
      'aria-current':String(state.passFilter===graphNode.pass_id),
      onclick:()=>{ if(pass) openDrawer(graphNode.pass_id); selectPass(graphNode.pass_id,false); },
      'aria-label':(graphNode.role||'role unrecorded')+' '+graphNode.pass+' '+word},
      node('strong',{},graphNode.role||'role unrecorded'),
      node('div',{},graphNode.pass),
      node('div',{class:'meta'},(graphNode.runtime||'?')+'/'+(graphNode.model||'?')),
      badge(word,graphNode.state_token),
      graphNode.state_token==='running'&&graphNode.liveness?badge(graphNode.liveness,graphNode.liveness):'');
  }
  // The projection owns the total order; the client owns filtering, grouping,
  // paging and focus. No ts comparison happens here — only order_key.
  function activityEntries(s,scope) {
    const f=currentFilters();
    // Trace and pass are real FILTERS, not highlights. The trace filter resolves
    // through the projection's own trace record and then matches on (app,
    // trace_id) — never on the bare trace_id, which is not globally unique
    // (invariant 3) — and never on branch text or timing (invariant 2). An
    // unresolvable selection narrows to nothing and the badge says so, rather
    // than silently widening back to every pass.
    const trace=state.traceFilter?s.traces.find((t)=>t.id===state.traceFilter)||null:null;
    const passInScope=(p)=>
      (!state.passFilter||p.id===state.passFilter)&&
      (!state.traceFilter||(trace!==null&&p.app===trace.app&&p.trace_id===trace.trace_id));
    return sessionPasses(s,scope)
      .filter((p)=>visibleApp(p.app,scope)&&(!f.role||p.role===f.role)&&(!f.status||p.status===f.status)&&passInScope(p))
      .flatMap((p)=>p.events.map((e)=>({p,e})))
      .filter(({e})=>(!state.eventKind||e.kind===state.eventKind)&&(!state.outcome||e.outcome===state.outcome))
      .sort((a,b)=>a.e.order_key<b.e.order_key?1:a.e.order_key>b.e.order_key?-1:0);
  }
  const unresolvedTraceFilter=(s)=>Boolean(state.traceFilter)&&!s.traces.some((t)=>t.id===state.traceFilter);
  const unresolvedPassFilter=(s)=>Boolean(state.passFilter)&&!s.passes.some((p)=>p.id===state.passFilter);
  // Collapses only ADJACENT runs of the same coalesce_key, so an interleaved
  // pass.failed is never swallowed. Freshness always reads
  // PassView.last_heartbeat_at / activity.latest_heartbeat_at, which this never
  // touches.
  function coalesce(entries) {
    const out=[];
    for(const entry of entries) {
      const previous=out[out.length-1];
      if(previous&&entry.e.coalesce_key&&previous.e.coalesce_key===entry.e.coalesce_key) { previous.count+=1; continue; }
      out.push({p:entry.p,e:entry.e,count:1});
    }
    return out;
  }
  function renderActivity(s,scope) {
    const meta=s.activity||{total_events:0,tie_break:'',completeness:'complete',incomplete_reasons:[]};
    const list=q('activity');
    const previousScroll=list.scrollTop;
    const all=activityEntries(s,scope);
    const dated=all.filter(({e})=>e.ts_utc!==null), undated=all.filter(({e})=>e.ts_utc===null);
    const coalesced=coalesce(dated);
    const limit=limitFor('activity'), undatedLimit=limitFor('activity-undated');
    const shown=coalesced.slice(0,limit);
    const undatedShown=undated.slice(0,undatedLimit);
    // ONE disclosure covering BOTH buckets. Counting only the dated set would
    // leave undated entries uncounted anywhere in the UI — the same silent
    // truncation, relocated into a new section.
    let label=withFacets(scope?'this session':'all visible passes');
    if(unresolvedTraceFilter(s)) label+=' · selected trace is not in the current window';
    if(unresolvedPassFilter(s)) label+=' · selected pass is not in the current window';
    const kind=scopeKind(scope);
    renderSectionScope('activity-scope','activity',kind,sectionScopeText(kind,
      label,
      disclose(shown.length+undatedShown.length,meta.total_events,meta.completeness==='partial'),
      'newest first · '+meta.tie_break));
    const graphPasses=new Set(sessionTraces(s,scope).filter((v)=>visibleApp(v.app,scope)).flatMap((trace)=>trace.pass_ids));
    const rows=shown.map((entry)=>activityRow(entry,graphPasses));
    let children;
    if(state.group==='none') {
      children=rows.length?[node('ol',{class:'activity-list'},...rows)]:[empty('No structured activity in this view.')];
    } else {
      // Grouping keys on REAL identity only: (app, trace_id) or the pass id
      // (already app:runId). A trace_id-only key would merge two apps.
      const buckets=new Map();
      shown.forEach((entry,index)=>{
        const key=state.group==='trace'?entry.p.app+'\u0000'+entry.p.trace_id:entry.p.id;
        const label=state.group==='trace'?entry.p.app+' · '+entry.p.trace_id:entry.p.app+' · '+entry.p.run_id+' · '+entry.p.role+'/'+entry.p.pass;
        const bucket=buckets.get(key)||{key,label,rows:[],max:'',first:null,last:null};
        bucket.rows.push(rows[index]);
        if(entry.e.order_key>bucket.max) bucket.max=entry.e.order_key;
        if(bucket.first===null||(entry.e.ts_utc&&entry.e.ts_utc<bucket.first)) bucket.first=entry.e.ts_utc;
        if(bucket.last===null||(entry.e.ts_utc&&entry.e.ts_utc>bucket.last)) bucket.last=entry.e.ts_utc;
        buckets.set(key,bucket);
      });
      // Ordered by the MAXIMUM member order_key, so group order is
      // deterministic and newest-first rather than insertion-dependent.
      const groups=[...buckets.values()].sort((a,b)=>a.max<b.max?1:a.max>b.max?-1:(a.key<b.key?-1:1));
      children=groups.length?groups.map((bucket)=>node('section',{class:'activity-group',dataset:{groupKind:state.group,groupKey:bucket.key}},
        node('h3',{},bucket.label+' · '+bucket.rows.length+' entr'+(bucket.rows.length===1?'y':'ies')),
        node('div',{class:'meta'},'first ',stamp(bucket.first),' · last ',stamp(bucket.last)),
        node('ol',{class:'activity-list'},...bucket.rows),
      )):[empty('No structured activity in this view.')];
    }
    if(shown.length<coalesced.length) children=[...children,node('div',{},showMore('activity',60,'live activity entries','activity'))];
    if(undated.length) {
      // The undated tail discloses and pages exactly like the dated set: it has
      // its own limit key and its own Show more, so it can never become an
      // unreachable bucket.
      children=[...children,node('section',{class:'activity-group',dataset:{groupKind:'undated'}},
        node('h3',{},'Undated · '+disclose(undatedShown.length,undated.length,false)),
        node('ol',{class:'activity-list'},...undatedShown.map((entry)=>activityRow({...entry,count:1},graphPasses))),
        ...(undatedShown.length<undated.length?[showMore('activity-undated',40,'undated activity entries','activity')]:[]))];
    }
    if(meta.completeness==='partial'&&meta.incomplete_reasons.length) children=[...children,node('div',{class:'meta warn'},'incomplete: '+meta.incomplete_reasons.join(' · '))];
    list.replaceChildren(...children);
    // The paused counter is derived from EVENT IDS captured at the moment of
    // pausing, so it is exact and cannot drift: it counts entries the operator
    // has not seen, not snapshots delivered.
    state.lastEntryIds=new Set(all.map(({e})=>e.id));
    if(state.autoScroll) state.newSincePaused=0;
    else if(state.pausedIds) { let fresh=0; for(const id of state.lastEntryIds) if(!state.pausedIds.has(id)) fresh++; state.newSincePaused=fresh; }
    updateFollow();
    // Following pins the newest event at the top; paused restores the exact
    // prior position so nothing the operator was reading moves under them.
    if(state.autoScroll) list.scrollTop=0; else list.scrollTop=previousScroll;
    const focusRow=state.passFilter?list.querySelector('li[data-focused="true"]'):null;
    if(focusRow&&state.autoScroll) focusRow.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function activityRow(entry,graphPasses) {
    const p=entry.p, e=entry.e, skewed=(state.snapshot.activity&&state.snapshot.activity.clock_skew_event_ids||[]).includes(e.id);
    const inGraph=graphPasses.has(p.id);
    return node('li',{dataset:{entryId:e.id,orderKey:e.order_key,passId:p.id,kind:e.kind,outcome:e.outcome,focused:String(state.passFilter===p.id)}},
      stamp(e.ts_utc),
      node('div',{},(entry.count>1?entry.count+' heartbeats — latest ':'')+e.event+' · '+p.app+' · '+p.role+'/'+p.pass),
      node('div',{class:'meta'},e.kind+' · '+e.outcome+(e.tool_name?' · '+e.tool_name:'')),
      node('div',{class:'meta'},summarizeDetail(e.detail)),
      skewed?badge('future timestamp - clock skew','failed'):'',
      e.error_code?badge(e.error_code,'failed'):'',
      inGraph
        ? node('button',{class:'session-link',type:'button',dataset:{targetPass:p.id},onclick:()=>selectPass(p.id,true)},'Show in graph')
        : node('button',{class:'session-link',type:'button','aria-disabled':'true',dataset:{targetPass:p.id}},'pass not in current scope'),
    );
  }
  function selectPass(id,moveFocus) {
    state.passFilter=id; q('pass-filter').value=id; syncUrl();
    if(!moveFocus) return;
    const target=q('graph').querySelector('[data-pass-id="'+CSS.escape(id)+'"]');
    if(target) target.focus();
  }
  function updateFollow() {
    const following=state.autoScroll;
    // The follow pill is the ONLY live region for the stream. #activity itself
    // is rebuilt wholesale by replaceChildren on every snapshot, so an aria-live
    // list re-announces every visible entry each time — with grouping on, every
    // heading and 'first/last' line too. The completeness fact an operator needs
    // is the count, and it is announced here, once per change.
    q('activity-follow').textContent=following?'following live':'paused - '+state.newSincePaused+' new since paused';
    q('resume-stream').disabled=following;
    q('resume-stream').setAttribute('aria-disabled',String(following));
  }
  function summarizeDetail(detail) { return Object.entries(detail||{}).map(([k,v])=>k+'='+String(v)).join(' · '); }
  // Completion integrity is exactly the section where a dropped row is
  // indistinguishable from a clean run, so it caps and discloses through the
  // shared primitives like every other collection. The cap is applied to the
  // combined source list BEFORE any node is built, so the disclosure and the
  // DOM can never disagree.
  // The NAVIGABLE session index. Deliberately NOT rescoped by the current
  // selection: rescoping it would collapse the list to the one session already
  // selected, leaving the header dropdown as the only way to reach another —
  // which is the bug, not the fix. Because that is a deliberate exception, the
  // badge STATES it rather than leaving the operator to infer it (design.md
  // §5.5, invariant 14).
  function historyIndexRows(s) {
    const targets=sessionTargets(s), available=targets.available;
    const rows=[];
    for(const task of s.parent_tasks) rows.push({
      rowId:'task:'+task.task_id, target:available.has('task:'+task.task_id)?'task:'+task.task_id:null,
      kind:'task', title:task.task_id, app:task.app||'org', pipeline:'parent task', status:task.status,
      ticket:(task.ticket_refs||[]).join(' '), startedAt:task.started_at, duration:task.duration,
      counts:(task.trace_count||0)+' trace'+(task.trace_count===1?'':'s')+' · '+(task.pass_count||0)+' pass'+(task.pass_count===1?'':'es'),
      cost:task.cost, recorded:task.recorded_cost_usd, quality:task.usage_quality, note:'',
    });
    for(const trace of s.traces) {
      // A trace CLAIMED by a parent task is not itself a selectable session:
      // sessions() emits no standalone entry for it, and navigating to its own
      // composite id would be silently reset to Live org. It navigates to its
      // recorded parent session and says so.
      const own=available.has(trace.id)?trace.id:null;
      const recorded=trace.parent_session_id&&available.has(trace.parent_session_id)?trace.parent_session_id:null;
      const parent=recorded||targets.claimedBy.get(trace.id)||null;
      rows.push({
        rowId:trace.id, target:own||parent, kind:'trace', title:trace.trace_id, app:trace.app,
        pipeline:trace.pipeline, status:trace.status, ticket:trace.ticket||'', startedAt:trace.started_at,
        duration:trace.duration,
        counts:(trace.pass_counts?trace.pass_counts.observed:trace.pass_ids.length)+' passes'+(trace.pass_counts&&trace.pass_counts.skipped?' · '+trace.pass_counts.skipped+' skipped':''),
        cost:trace.cost, recorded:trace.recorded_cost_usd, quality:trace.usage_quality,
        note:own?'':parent?'part of recorded session '+parent:'not selectable — this record is not in the current window',
      });
    }
    // started_at descending with an always-ascending identity tie-break, mirroring
    // orderRows: 'newest first' is never [...rows].reverse(), which would reverse
    // ties too. Dated rows sort before undated ones.
    const key=(row)=>row.startedAt?'1\u0000'+row.startedAt:'0';
    return rows.sort((a,b)=>{ const x=key(a), y=key(b); return x<y?1:x>y?-1:(a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0); });
  }
  // Identity fields ONLY. A search over a parent task's objective or a pass
  // preview would let user-typed text imply a relationship the projection never
  // recorded, and would index model-produced content (invariants 2 and 5).
  const rowMatchesQuery=(row,query)=>!query||[row.title,row.app,row.pipeline,row.status,row.ticket,row.rowId].some((v)=>String(v||'').toLowerCase().includes(query.toLowerCase()));
  function renderHistoryIndex(s) {
    const all=historyIndexRows(s);
    const matched=all.filter((row)=>rowMatchesQuery(row,state.historyQuery));
    // 'history-index', NOT 'history': the Completion integrity records list below
    // owns 'history'. Sharing the key coupled the two caps, made ?more=history=N
    // unable to express them independently, and sent the pager's restored focus
    // to whichever list rendered first.
    const limit=limitFor('history-index'), rows=matched.slice(0,limit);
    const capped=rows.length<matched.length?'display capped':false;
    // The index reports app_wide_context exactly when something ELSE on the page
    // IS narrowed and this list deliberately is not. With nothing narrowing it,
    // claiming an exemption would be noise.
    const narrowed=Boolean(state.selectedSession)||activeFacets().length>0;
    const kind=narrowed?'app_wide_context':'live_app_wide';
    const reasons=narrowed?[APP_WIDE_REASONS['history-index-scope']]:[];
    // DERIVED each render from the live snapshot, never a stored flag: a stored
    // one-shot message is either shown forever or cleared by whichever render
    // happens to run next.
    const outOfWindow=sessionUnavailableNote(state.snapshot);
    if(outOfWindow) reasons.push(outOfWindow);
    renderSectionScope('history-index-scope','history-index',kind,
      sectionScopeText(kind,withSearch('all recorded sessions',state.historyQuery,'session'),
        discloseSearch(rows.length,matched.length,all.length,capped,state.historyQuery),
        'Newest start first · ties by composite session id ascending',
        narrowed?'not narrowed by the current selection':''),
      reasons.join(' '));
    q('history-index').replaceChildren(...(rows.length
      ? [...rows.map((row)=>historyIndexRow(row)),...(rows.length<matched.length?[showMore('history-index',DEFAULT_LIMITS['history-index'],'recorded sessions','history-index')]:[])]
      : [empty(state.historyQuery?'No recorded session matches this search.':'No recorded sessions.')]));
  }
  function historyIndexRow(row) {
    const cells=[
      node('div',{},node('strong',{},row.title),node('div',{class:'meta'},row.app+' · '+row.pipeline+(row.ticket?' · '+row.ticket:'')),stamp(row.startedAt,'started')),
      node('div',{class:'integrity'},
        node('span',{class:'duration-cell'},durationText(row.duration)),' · ',
        node('span',{},row.counts),' · ',
        // The ONE cost renderer, so an unavailable aggregate can never render as
        // $0.00 through a second toFixed(2) path (invariant 4).
        node('span',{class:'cost-cell'},formatCost(row.recorded,row.quality,row.cost&&row.cost.unknown_turns)),
        row.note?node('div',{class:'meta'},row.note):''),
      badge(row.status,row.status),
    ];
    if(!row.target) return node('article',{class:'card history-row static',dataset:{notSelectable:'true',rowId:row.rowId}},...cells);
    // A row is CURRENT when the session it navigates to is the selected one.
    // Keying this on rowId alone left a claimed trace visibly unselected after
    // the operator activated it — the row selects its parent task, so its own
    // composite id is never the selected session. aria-current still marks
    // exactly one row (the session's own), while a claimed trace is marked as a
    // MEMBER, in text as well as in data, so 'current' keeps one meaning.
    const isSession=state.selectedSession===row.rowId;
    const isMember=!isSession&&Boolean(state.selectedSession)&&state.selectedSession===row.target;
    return node('button',{class:'card history-row',type:'button',
      dataset:{sessionId:row.target,rowId:row.rowId,sessionMember:String(isMember)},
      'aria-current':String(isSession),
      'aria-label':(isSession?'Selected recorded session ':isMember?'Part of the selected recorded session ':'Select recorded session ')+row.target,
      // The existing selectSession(): filter reset, drawer close, URL rewrite and
      // re-render are inherited unchanged rather than forked.
      // pendingFocus carries the ROW id: several rows share one session id, so a
      // session id would restore focus to whichever of them renders first.
      onclick:()=>{ state.pendingFocus={key:null,listId:'history-index',rowId:row.rowId}; selectSession(row.target); }},
      ...cells,
      isMember?node('span',{class:'meta'},'in the selected session'):'');
  }
  function renderHistory(s,scope) {
    const tasks=s.parent_tasks.filter((v)=>(!v.app||visibleApp(v.app,scope))&&(!scope||Boolean(scope.task)&&v.task_id===scope.task.task_id));
    const traces=sessionTraces(s,scope).filter((v)=>visibleApp(v.app,scope));
    const approvals=s.approvals.filter((approval)=>approval.execution_state&&visibleApp(approval.app,scope));
    const source=[
      ...approvals.map((v)=>({kind:'approval',v})),
      ...(tasks.length?tasks.map((v)=>({kind:'task',v})):traces.map((v)=>({kind:'trace',v}))),
    ];
    const limit=limitFor('history'), rows=source.slice(0,limit);
    const kind=scopeKind(scope);
    renderSectionScope('history-scope','history',kind,sectionScopeText(kind,
      withFacets((scope?'this session':'all visible apps')+' · record(s)'),
      disclose(rows.length,source.length,false),
      'Approval deliveries first, then '+(tasks.length?'parent tasks':'traces')+' newest start first'),'');
    const card=(entry)=>entry.kind==='approval'
      ? node('article',{class:'card history-row'},node('div',{},node('strong',{},'Approval '+entry.v.approval_id),node('div',{class:'meta'},entry.v.app+' · '+entry.v.role+' · '+entry.v.rule)),node('div',{class:'integrity'},'attempt '+entry.v.execution_attempts+' · actor '+(entry.v.execution_actor||'unrecorded')+' · result '+(entry.v.execution_result||'unrecorded')+' · next '+(entry.v.execution_next_action||'unrecorded')+(entry.v.execution_remote_ref?' · remote '+entry.v.execution_remote_ref:'')),badge(entry.v.execution_state,entry.v.execution_state==='executed'?'completed':entry.v.execution_state==='failed'||entry.v.execution_state==='ambiguous'?'failed':'blocked'))
      : entry.kind==='task'
      ? node('article',{class:'card history-row'},node('div',{},node('strong',{},entry.v.task_id),node('div',{class:'meta'},entry.v.objective)),node('div',{class:'integrity'},entry.v.completion_integrity.reasons.length?entry.v.completion_integrity.reasons.join(' · '):'All recorded integrity requirements satisfied'),badge(entry.v.status,entry.v.status))
      : node('article',{class:'card history-row'},node('div',{},node('strong',{},entry.v.trace_id),node('div',{class:'meta'},entry.v.app+' · '+entry.v.pipeline)),node('div',{class:'integrity'},entry.v.completion_integrity.reasons.join(' · ')||'Recorded trace complete'),badge(entry.v.status,entry.v.status));
    q('history').replaceChildren(...(rows.length
      ? [...rows.map(card),...(rows.length<source.length?[showMore('history',DEFAULT_LIMITS.history,'completion integrity records','history')]:[])]
      : [empty('No parent-task or trace history recorded.') ]));
  }
  // Source health is CURRENT observer health, ALWAYS. Under a historical
  // selection its values are untouched — filtering, blanking, or rewriting
  // observed_at to the trace's start time would each imply an org-wide
  // point-in-time snapshot that does not exist (invariant 14, design.md §5).
  // Only the LABEL changes.
  function renderSources(s,scope) {
    // Source health is narrowed by NOTHING — not by a session and not by the app
    // or role filters — so it declares the exemption whenever anything else on
    // the page is narrowed, and states why.
    const narrowed=Boolean(scope)||activeFacets().length>0;
    const kind=narrowed?'app_wide_context':'live_app_wide';
    renderSectionScope('sources-scope','sources',kind,
      sectionScopeText(kind,'current observer health',disclose(s.sources.length,s.sources.length,false)),
      narrowed?APP_WIDE_REASONS['sources-scope']:'');
    renderSourceCards(s);
  }
  function renderSourceCards(s) { q('sources').replaceChildren(...s.sources.map((v)=>node('article',{class:'source'},node('h3',{},v.id+' '),badge(v.status,v.status==='healthy'?'completed':v.status==='degraded'?'blocked':'failed'),node('p',{class:'meta'},v.detail),node('p',{class:'meta'},'observed ',stamp(v.observed_at))))); }
  function renderValidationCampaigns(s,scope) {
    const evidence=s.validation_campaigns||{reports:[],corrupt:[]};
    const reports=evidence.reports.filter((campaign)=>campaign.target.apps.length===0||campaign.target.apps.some((app)=>visibleApp(app,scope)));
    const narrowed=Boolean(scope)||activeFacets().length>0;
    const kind=narrowed?'app_wide_context':'live_app_wide';
    renderSectionScope('validation-campaigns-scope','validation-campaigns',kind,
      sectionScopeText(kind,'durable triggered-validation evidence',disclose(reports.length+evidence.corrupt.length,evidence.reports.length+evidence.corrupt.length,false)),
      narrowed?'Campaign evidence is target-scoped, not part of a recorded product session.':'');
    const cards=reports.map((campaign)=>{
      const inconclusive=campaign.outcome.verdict==='inconclusive';
      const verdict=inconclusive?'INCONCLUSIVE — NOT A PASS; NOT RELEASE EVIDENCE':campaign.outcome.verdict.toUpperCase();
      const state=campaign.outcome.verdict==='pass'?'completed':campaign.outcome.verdict==='fail'?'failed':'blocked';
      return node('article',{class:'card history-row'},
        node('div',{},node('strong',{},campaign.campaign_id),node('div',{class:'meta'},campaign.lane+' · '+campaign.campaign_kind+' · '+campaign.target.apps.join(', '))),
        node('div',{class:'integrity'},'completeness '+campaign.outcome.completeness+' · cases '+campaign.coverage.collected_case_ids.length+'/'+campaign.coverage.required_case_ids.length+' · spend '+campaign.spend.observed_provider_turns+'/'+campaign.spend.max_provider_turns+' turns'),
        badge(verdict,state));
    });
    cards.push(...evidence.corrupt.map((item)=>node('article',{class:'card history-row'},
      node('div',{},node('strong',{},item.campaign_id),node('div',{class:'meta'},item.detail)),
      node('div',{class:'integrity'},'Campaign evidence is incomplete until this report is repaired.'),
      badge('CORRUPT','failed'))));
    if(cards.length) cards.push(node('p',{class:'meta'},'Triage: docs/qualification/validation-triage.md'));
    q('validation-campaigns').replaceChildren(...(cards.length?cards:[empty('No validation campaign evidence recorded.') ]));
  }
  function openDrawer(id) { state.selectedPass=id; const pass=state.snapshot.passes.find((p)=>p.id===id); if(pass) renderDrawer(pass,true); }
  // The drawer declares aria-modal, so the background must actually BE
  // unreachable — 'inert' is what makes that true for Tab, pointer, and the
  // accessibility tree alike. The backdrop is left interactive so click-to-close
  // still works, and the artifact dialog is left alone because it is opened from
  // inside the drawer.
  const INERT_EXEMPT=new Set(['drawer','drawer-backdrop','artifact-dialog']);
  function setBackgroundInert(on) {
    for(const element of document.body.children) {
      if(INERT_EXEMPT.has(element.id)||element.tagName==='SCRIPT') continue;
      if(on) element.setAttribute('inert',''); else element.removeAttribute('inert');
    }
  }
  function renderDrawer(pass,moveFocus) {
    q('drawer').hidden=false; q('drawer-backdrop').hidden=false; document.body.style.overflow='hidden'; setBackgroundInert(true);
    const artifactButtons=pass.artifacts.map((a)=>node('button',{class:'artifact-link',type:'button',disabled:!a.available,onclick:()=>openArtifact(a)},a.label+(a.available?'':a.expired?' — expired by retention':' — not available')));
    q('drawer-body').replaceChildren(
      drawerSection('Identity', [['Pass identity',pass.app+' / '+pass.run_id],['Trace',pass.trace_id],['Parent task',pass.parent_task_id||'not recorded'],['Ticket',pass.ticket||'not recorded'],['Pipeline / pass / role',pass.pipeline+' / '+pass.pass+' / '+pass.role],['Runtime / model / effort',(pass.runtime||'?')+' / '+(pass.model||'?')+' / '+(pass.effort||'?')],['Authority',pass.authority?pass.authority.version+' · sha256:'+pass.authority.sha256:'not recorded'],['Native session',pass.session?pass.session.transcript_note:'not recorded']]),
      drawerSection('Progress', [['Status',pass.status],['Liveness',pass.liveness+' — '+pass.liveness_reason],['Role/app lock',pass.lock?node('span',{},'pid '+pass.lock.pid+' · '+(pass.lock.fresh?'fresh':'stale')+' at ',stamp(pass.lock.heartbeat_at)):'not recorded'],['Started',stamp(pass.started_at)],['Finished',stamp(pass.finished_at)],['Latest heartbeat',stamp(pass.last_heartbeat_at)],['Terminal reason',pass.terminal_reason||'none recorded']]),
      node('section',{},node('h3',{},'Input and evidence'),node('p',{class:'warning'},'Exact L3 evidence is local and may contain sensitive text.'),...artifactButtons),
      drawerSection('Output and verdict', [['Verdict',pass.verdict_summary||'not recorded'],['Previews',Object.entries(pass.previews).map(([k,v])=>k+': '+v).join(' · ')||'none'],['Result refs',pass.result_refs.map((r)=>r.source+': '+r.ref).join(' · ')||'none']]),
      drawerSection('Usage', [['Tokens in / out',String(pass.usage.tokens_in)+' / '+String(pass.usage.tokens_out)],['Cache read / write',String(pass.usage.cache_read_tokens)+' / '+String(pass.usage.cache_write_tokens)],['Cost',formatCost(pass.usage.cost_usd,pass.usage.quality)],['Quality',pass.usage.quality+(pass.usage.settled?' · ledger settled':' · not settled')],['Tools / subagents / escalations',pass.tool_calls+' / '+pass.subagents+' / '+pass.escalations]]),
      node('section',{},node('h3',{},'Gates'),...(pass.gates.length?pass.gates.map((g)=>node('div',{class:'card'},badge(g.status,g.status),node('strong',{},g.gate),node('p',{class:'meta'},g.detail||'no detail'))):[node('p',{class:'meta'},'No gate result recorded')]))
    ); if(moveFocus) q('close-drawer').focus();
  }
  function drawerSection(title, rows) { const dl=node('dl',{}); for(const [key,value] of rows) dl.append(node('dt',{},key),node('dd',{},value instanceof Node?value:String(value))); return node('section',{},node('h3',{},title),dl); }
  function closeDrawer() { state.selectedPass=null; q('drawer').hidden=true; q('drawer-backdrop').hidden=true; document.body.style.overflow=''; setBackgroundInert(false); }
  async function openArtifact(artifact) {
    if(!artifact.available||!artifact.href) return; q('artifact-title').textContent=artifact.label; q('artifact-content').textContent='Loading…'; q('artifact-dialog').showModal();
    try { const response=await fetch(artifact.href+tokenQuery(),{cache:'no-store'}); q('artifact-content').textContent=response.ok?await response.text():'Artifact request failed: '+response.status; } catch(error) { q('artifact-content').textContent=String(error); }
  }
  function replaceSessionUrl(value) { const url=new URL(location.href); if(value) url.searchParams.set('session',value); else url.searchParams.delete('session'); history.replaceState({},'',url); }
  // Choosing a session is a SCOPE change, not a filter. Trace and pass filters
  // name identities that belong to the session being left, so carrying them
  // across would narrow the new scope to nothing; they are cleared, and the URL
  // is rewritten so the link still reproduces exactly what is on screen.
  function selectSession(value) {
    state.selectedSession=value; q('session-selector').value=value;
    state.passFilter=''; state.traceFilter='';
    q('pass-filter').value=''; q('trace-filter').value='';
    closeDrawer(); replaceSessionUrl(value); syncUrl();
  }
  // ONE URL-sync path, written in a fixed canonical order so identical filter
  // state always yields a byte-identical shareable link (invariant 8).
  // 'gq' and 'hq' are DECLARED here in a fixed position, not appended ad hoc, so
  // two operators looking at the same view still produce a byte-identical link.
  const URL_KEYS=['app','role','status','order','tz','ev','outcome','trace','pass','gq','hq','group','more','open'];
  function writeUrl() {
    const url=new URL(location.href), f=currentFilters();
    const values={app:f.app,role:f.role,status:f.status,
      order:state.order==='newest_first'?'':'chronological',
      tz:state.timeModePinned?state.timeMode:'',
      ev:state.eventKind,outcome:state.outcome,trace:state.traceFilter,pass:state.passFilter,
      gq:state.graphQuery,hq:state.historyQuery,
      group:state.group==='none'?'':state.group,
      // Paging and expansion are part of what the sender was looking at, so a
      // handed-over link reproduces them too (invariant 8). Both are written in
      // a fixed sorted order, so identical view state is a byte-identical link.
      more:Object.keys(state.limits).sort().map((key)=>key+'='+state.limits[key]).join(','),
      open:[...state.openAttentionGroups].sort().join(',')};
    for(const key of URL_KEYS) {
      if(values[key]) url.searchParams.set(key,values[key]); else url.searchParams.delete(key);
    }
    history.replaceState({},'',url);
  }
  function syncUrl() { writeUrl(); render(); }
  q('session-selector').addEventListener('change',()=>{ selectSession(q('session-selector').value); });
  for(const id of ['app-filter','role-filter','status-filter']) q(id).addEventListener('change',syncUrl);
  q('clear-filters').addEventListener('click',()=>{ q('app-filter').value=''; q('role-filter').value=''; q('status-filter').value=''; state.eventKind=''; state.outcome=''; state.passFilter=''; state.traceFilter=''; state.group='none'; state.graphQuery=''; state.historyQuery=''; q('graph-search').value=''; q('history-search').value=''; q('event-kind-filter').value=''; q('outcome-filter').value=''; q('trace-filter').value=''; q('pass-filter').value=''; q('group-mode').value='none'; syncUrl(); });
  // Both toggles keep a FIXED label naming the state they turn on, with
  // aria-pressed reporting whether that state is currently active. A label that
  // named the next action while aria-pressed named the current one announced a
  // contradiction ("Show UTC, not pressed").
  q('tz-toggle').addEventListener('click',()=>{ state.timeMode=state.timeMode==='utc'?'local':'utc'; state.timeModePinned=true; syncTimeControl(); syncUrl(); });
  q('order-toggle').addEventListener('click',()=>{ state.order=state.order==='newest_first'?'chronological':'newest_first'; syncOrderControl(); syncUrl(); });
  q('event-kind-filter').addEventListener('change',()=>{ state.eventKind=q('event-kind-filter').value; syncUrl(); });
  q('outcome-filter').addEventListener('change',()=>{ state.outcome=q('outcome-filter').value; syncUrl(); });
  q('trace-filter').addEventListener('change',()=>{ state.traceFilter=q('trace-filter').value; syncUrl(); });
  q('pass-filter').addEventListener('change',()=>{ state.passFilter=q('pass-filter').value; syncUrl(); });
  q('group-mode').addEventListener('change',()=>{ state.group=q('group-mode').value; syncUrl(); });
  // Both searches are pure client-side narrowing over data already delivered:
  // they issue no request and are persisted nowhere but the URL (invariant 1).
  q('graph-search').addEventListener('input',()=>{ state.graphQuery=q('graph-search').value; syncUrl(); });
  q('history-search').addEventListener('input',()=>{ state.historyQuery=q('history-search').value; syncUrl(); });
  q('close-drawer').addEventListener('click',closeDrawer); q('drawer-backdrop').addEventListener('click',closeDrawer); document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!q('drawer').hidden) closeDrawer(); });
  // Exactly scrollTop === 0 is "following". The inherited wasBottom heuristic
  // is deleted: it is correct for an oldest-first list and inverted for this
  // newest-first one.
  // Pausing snapshots the event ids the operator has already been shown, so the
  // 'N new since paused' count is exact rather than a counter nothing increments.
  q('activity').addEventListener('scroll',()=>{
    const following=q('activity').scrollTop===0;
    if(following!==state.autoScroll) {
      state.autoScroll=following;
      state.newSincePaused=0;
      state.pausedIds=following?null:new Set(state.lastEntryIds||[]);
    }
    updateFollow();
  });
  q('resume-stream').addEventListener('click',()=>{ state.autoScroll=true; state.newSincePaused=0; state.pausedIds=null; q('activity').scrollTop=0; updateFollow(); });
  const params=new URL(location.href).searchParams;
  state.selectedSession=params.get('session')||'';
  state.timeModePinned=params.get('tz')==='utc'||params.get('tz')==='local';
  state.timeMode=params.get('tz')==='utc'?'utc':'local';
  state.order=params.get('order')==='chronological'?'chronological':'newest_first';
  state.group=['trace','pass'].includes(params.get('group'))?params.get('group'):'none';
  state.eventKind=params.get('ev')||''; state.outcome=params.get('outcome')||'';
  state.passFilter=params.get('pass')||''; state.traceFilter=params.get('trace')||'';
  state.graphQuery=params.get('gq')||''; state.historyQuery=params.get('hq')||'';
  q('graph-search').value=state.graphQuery; q('history-search').value=state.historyQuery;
  // 'more' restores paging. Keys may contain ':' (attention:<group id>), so the
  // split is on the LAST '=' and the value is clamped: a hand-edited link must
  // not be able to ask the client to build an unbounded list.
  for(const part of (params.get('more')||'').split(',')) {
    const index=part.lastIndexOf('=');
    if(index<=0) continue;
    const key=part.slice(0,index), value=Number(part.slice(index+1));
    if(Number.isFinite(value)&&value>0) state.limits[key]=Math.min(Math.floor(value),2000);
  }
  for(const id of (params.get('open')||'').split(',')) if(id) state.openAttentionGroups.add(id);
  syncTimeControl(); syncOrderControl();
  q('group-mode').value=state.group; q('outcome-filter').value=state.outcome;
  for(const key of ['app','role','status']) if(params.get(key)) q(key+'-filter').dataset.initial=params.get(key);
  updateFollow();
  fetchSnapshot().then(()=>{ for(const key of ['app','role','status']) { const value=q(key+'-filter').dataset.initial; if(value) q(key+'-filter').value=value; } render(); connect(state.snapshot.cursor); }).catch((error)=>{ setConnection('offline','offline'); q('banner').hidden=false; q('banner').textContent=String(error); });
})();`;
