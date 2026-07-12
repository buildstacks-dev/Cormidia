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
    </div>
    <div class="header-actions">
      <label class="session-control">Session
        <select id="session-selector" aria-label="Choose live or historical session">
          <option value="">Live org</option>
        </select>
      </label>
      <span id="session-mode" class="pill live">live</span>
      <div id="totals" class="totals"></div>
    </div>
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
      <div class="section-heading"><h1 id="attention-title">Attention</h1><span id="attention-count"></span></div>
      <div id="attention" class="attention-grid"></div>
    </section>
    <section aria-labelledby="apps-title">
      <div class="section-heading"><h2 id="apps-title">App lifecycle and intake</h2></div>
      <div id="apps" class="app-grid"></div>
      <ol id="intake" class="timeline" aria-label="Onboarding and non-ticket activity"></ol>
    </section>
    <section aria-labelledby="delivery-title">
      <div class="section-heading"><h2 id="delivery-title">Product delivery</h2><span>GitHub <code>op:ready</code> is the claimable queue</span></div>
      <div id="delivery" class="delivery-board"></div>
    </section>
    <section class="workspace" aria-label="Execution and activity">
      <div>
        <div class="section-heading"><h2>Execution graph</h2><span id="graph-scope"></span></div>
        <div id="graph" class="graph" tabindex="0"></div>
      </div>
      <div>
        <div class="section-heading"><h2 id="activity-title">Live activity</h2><button id="resume-stream" type="button" hidden>Resume latest</button></div>
        <ol id="activity" class="activity" aria-live="polite" aria-relevant="additions"></ol>
      </div>
    </section>
    <section aria-labelledby="history-title">
      <div class="section-heading"><h2 id="history-title">Historical replay and completion integrity</h2></div>
      <div id="history" class="history"></div>
    </section>
    <section aria-labelledby="sources-title">
      <div class="section-heading"><h2 id="sources-title">Source health</h2></div>
      <div id="sources" class="sources"></div>
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
.health-line { display:flex; justify-content:center; gap:.7rem; color:var(--muted); }
.header-actions { display:flex; justify-content:flex-end; align-items:center; gap:.6rem; min-width:0; max-width:100%; }
.session-control { display:flex; align-items:center; gap:.4rem; color:var(--muted); font-size:.72rem; min-width:0; }
.session-control select { max-width:min(34vw,430px); min-width:0; }
.status::before { content:'●'; margin-right:.35rem; }
.status.live,.good { color:var(--green); }.status.reconnecting,.warn { color:var(--amber); }.status.offline,.bad { color:var(--red); }.status.unknown { color:var(--muted); }
.totals { display:flex; gap:.8rem; font-size:.78rem; color:var(--muted); }
.filters { display:flex; gap:.8rem; padding:.65rem 1rem; border-bottom:1px solid var(--line); background:#0e131a; align-items:end; flex-wrap:wrap; }
.filters label { display:grid; gap:.25rem; color:var(--muted); font-size:.75rem; }
.banner { margin:.7rem 1rem 0; border:1px solid var(--amber); background:#2b2313; color:#ffe1a4; padding:.65rem; }
main { padding:0 1rem 3rem; max-width:1800px; margin:auto; }
section { padding-top:1.2rem; }
.section-heading { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; margin-bottom:.55rem; }
h1,h2,h3 { font-family:system-ui,sans-serif; margin:0; } h1,h2 { font-size:1rem; letter-spacing:.02em; } h3 { font-size:.9rem; }
.section-heading span { color:var(--muted); font-size:.75rem; }
.attention-grid,.app-grid,.sources { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:.65rem; }
.card,.source,.attention-item { background:var(--panel); border:1px solid var(--line); border-radius:7px; padding:.75rem; overflow-wrap:anywhere; }
.attention-item.error { border-left:4px solid var(--red); }.attention-item.warning { border-left:4px solid var(--amber); }
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
.graph { min-height:220px; padding:.8rem; border:1px solid var(--line); border-radius:7px; overflow:auto; display:flex; gap:.5rem; align-items:flex-start; }
.trace { display:flex; gap:.35rem; align-items:center; min-width:max-content; }
.trace-node { max-width:190px; min-width:140px; text-align:left; background:var(--panel); padding:.7rem; position:relative; }
.trace-node.skipped { border-style:dashed; opacity:.72; }.trace-node.running.live::after { content:''; position:absolute; width:8px; height:8px; border-radius:50%; background:var(--blue); top:.4rem; right:.4rem; animation:pulse 1.4s infinite; }
.arrow { color:var(--muted); align-self:center; }
.activity { max-height:420px; overflow:auto; border:1px solid var(--line); border-radius:7px; background:#0e131a; }
.activity time { color:var(--muted); font-size:.72rem; }
.history { display:grid; gap:.6rem; }.history-row { display:grid; grid-template-columns:minmax(160px,.6fr) 1fr auto; gap:.7rem; align-items:center; }
.integrity { color:var(--muted); font-size:.75rem; }
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
@media (max-width:420px) { main { padding:0 .65rem 2rem; }.filters { padding:.55rem .65rem; }.session-control { width:100%; display:grid; grid-template-columns:minmax(0,1fr); }.session-control select { max-width:100%; min-width:0; width:100%; }.delivery-board { grid-template-columns:repeat(6,86vw); }.app-grid,.attention-grid { grid-template-columns:1fr; }.graph { min-height:180px; }.drawer { width:100vw; }.drawer dl { grid-template-columns:1fr; gap:.15rem; }.global-header { position:static; } }
`;

export const OBSERVE_JS = String.raw`(() => {
  'use strict';
  const state = { snapshot:null, selectedPass:null, selectedSession:'', eventSource:null, autoScroll:true, reconnects:0 };
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
  const formatCost = (value, quality) => quality === 'unavailable' ? 'unavailable' : (quality === 'estimated' ? '~' : '') + '$' + Number(value || 0).toFixed(2) + (quality === 'partial' ? ' partial' : '');
  const shortTime = (value) => value ? new Date(value).toLocaleString() : 'not recorded';
  const currentFilters = () => ({ app:q('app-filter').value, role:q('role-filter').value, status:q('status-filter').value });
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
    populateSessions(s);
    const scope=selectedSession(s);
    q('identity').textContent=s.org.name+' · '+s.org.state_home_id+' · '+(scope?'historical replay · ':'')+'updated '+shortTime(s.generated_at);
    q('session-mode').className='pill '+(scope?'unknown':'live'); q('session-mode').textContent=scope?'historical':'live';
    q('activity-title').textContent=scope?'Historical activity':'Live activity';
    const totals=scope?sessionTotals(s,scope):s.totals;
    q('totals').replaceChildren(
      node('span',{},totals.active_passes+' active'),
      node('span',{},totals.pending_approvals+' approvals'),
      node('span',{},totals.delivery_ready+' ready'),
      node('span',{},formatCost(totals.recorded_cost_usd,totals.usage_quality))
    );
    populateFilters(s);
    renderAttention(s,scope); renderApps(s,scope); renderDelivery(s,scope); renderGraph(s,scope); renderActivity(s,scope); renderHistory(s,scope); renderSources(s);
    if(state.selectedPass) { const pass=s.passes.find((p)=>p.id===state.selectedPass); if(pass) renderDrawer(pass); else closeDrawer(); }
  }
  function populateFilters(s) {
    const app=q('app-filter'), role=q('role-filter'), status=q('status-filter');
    syncOptions(app,s.apps.map((v)=>v.name)); syncOptions(role,[...new Set(s.passes.map((v)=>v.role))]); syncOptions(status,[...new Set([...s.passes.map((v)=>v.status),...s.delivery.map((v)=>v.state)])]);
  }
  function syncOptions(select, values) {
    const current=select.value, existing=new Set([...select.options].map((o)=>o.value));
    for(const value of values.sort()) if(value&&!existing.has(value)) select.append(node('option',{value},value));
    select.value=current;
  }
  function sessions(s) {
    const claimed=new Set();
    const tasks=s.parent_tasks.map((task)=>{
      const taskTraces=s.traces.filter((trace)=>(trace.parent_task_id===task.task_id||task.trace_ids.includes(trace.trace_id))&&(!task.app||trace.app===task.app));
      const traceKeys=new Set(taskTraces.map((trace)=>trace.id)), passIds=new Set(taskTraces.flatMap((trace)=>trace.pass_ids));
      for(const id of traceKeys) claimed.add(id);
      return { id:'task:'+task.task_id, kind:'task', task, traceKeys, passIds, app:task.app, startedAt:task.started_at, finishedAt:task.ended_at, status:task.status, label:task.task_id+' · '+(task.app||'org')+' · '+task.status+' · '+shortTime(task.started_at) };
    });
    const traces=s.traces.filter((trace)=>!claimed.has(trace.id)).map((trace)=>({ id:trace.id, kind:'trace', trace, traceKeys:new Set([trace.id]), passIds:new Set(trace.pass_ids), app:trace.app, startedAt:trace.started_at, finishedAt:trace.finished_at, status:trace.status, label:trace.trace_id+' · '+trace.app+' · '+trace.pipeline+' · '+shortTime(trace.started_at) }));
    return [...tasks,...traces].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  function populateSessions(s) {
    const select=q('session-selector'), available=sessions(s), current=state.selectedSession;
    const taskOptions=available.filter((v)=>v.kind==='task').map((v)=>node('option',{value:v.id},v.label));
    const traceOptions=available.filter((v)=>v.kind==='trace').map((v)=>node('option',{value:v.id},v.label));
    select.replaceChildren(node('option',{value:''},'Live org'),...(taskOptions.length?[node('optgroup',{label:'Parent tasks'},...taskOptions)]:[]),...(traceOptions.length?[node('optgroup',{label:'Standalone traces'},...traceOptions)]:[]));
    if(current&&available.some((v)=>v.id===current)) select.value=current;
    else if(current) { state.selectedSession=''; select.value=''; replaceSessionUrl(''); }
  }
  function selectedSession(s) { return state.selectedSession?sessions(s).find((v)=>v.id===state.selectedSession)||null:null; }
  function sessionPasses(s,scope) { return scope?s.passes.filter((pass)=>scope.passIds.has(pass.id)):s.passes; }
  function sessionTraces(s,scope) { return scope?s.traces.filter((trace)=>scope.traceKeys.has(trace.id)):s.traces; }
  function sessionTicketKeys(s,scope) {
    if(!scope) return null; const keys=new Set();
    for(const pass of sessionPasses(s,scope)) { const number=ticketNumber(pass.ticket); if(number!==null) keys.add(pass.app+'#'+number); }
    if(scope.kind==='task') for(const ref of scope.task.ticket_refs) { const number=ticketNumber(ref); if(number!==null&&scope.task.app) keys.add(scope.task.app+'#'+number); }
    return keys;
  }
  function sessionTotals(s,scope) {
    const passes=sessionPasses(s,scope), tickets=sessionTicketKeys(s,scope), ranks={complete:0,estimated:1,partial:2,unavailable:3};
    const quality=passes.length?passes.map((pass)=>pass.usage.quality).reduce((worst,value)=>ranks[value]>ranks[worst]?value:worst,'complete'):'unavailable';
    const approvals=s.approvals.filter((approval)=>approval.ticket_ref&&tickets.has(approval.app+'#'+ticketNumber(approval.ticket_ref)));
    const delivery=s.delivery.filter((ticket)=>tickets.has(ticket.app+'#'+ticket.issue_number));
    return { active_passes:passes.filter((pass)=>pass.status==='running').length, pending_approvals:approvals.filter((approval)=>approval.status==='pending').length, delivery_ready:delivery.filter((ticket)=>ticket.state==='ready').length, recorded_cost_usd:passes.reduce((total,pass)=>total+Number(pass.usage.cost_usd||0),0), usage_quality:quality };
  }
  function visibleApp(value,scope) { const f=currentFilters(); return (!scope||scope.app===null||value===scope.app||sessionPasses(state.snapshot,scope).some((pass)=>pass.app===value))&&(!f.app||value===f.app); }
  function renderAttention(s,scope) {
    const entities=scope?new Set([...sessionPasses(s,scope).map((pass)=>pass.id),...(scope.kind==='task'?['task:'+scope.task.task_id]:[]),...[...sessionTicketKeys(s,scope)].map((key)=>'ticket:'+key.replace('#',':'))]):null;
    const items=s.attention.filter((v)=>(!scope?v.app===null||visibleApp(v.app,scope):v.kind==='source_health'||(v.entity_id&&entities.has(v.entity_id)))); q('attention-count').textContent=items.length ? items.length+' item(s)' : 'clear';
    q('attention').replaceChildren(...(items.length?items.map((v)=>node('article',{class:'attention-item '+v.severity},node('h3',{},v.title),node('p',{class:'meta'},v.detail),badge(v.kind,v.severity))):[empty('No conditions require interpretation.') ]));
  }
  function renderApps(s,scope) {
    const apps=s.apps.filter((v)=>visibleApp(v.name,scope));
    q('apps').replaceChildren(...apps.map((v)=>node('article',{class:'card'},node('h3',{},v.name),badge(v.lifecycle,v.lifecycle),node('p',{class:'meta'},v.repo),node('p',{class:'meta'},formatCost(v.recorded_monthly_cost_usd,v.usage_quality)+' / $'+v.budget_usd_month.toFixed(0)+' monthly'),...v.channel_gates.map((g)=>node('div',{class:'meta warn'},g)))));
    const scopedTraces=scope?new Set(sessionTraces(s,scope).map((trace)=>trace.app+'\u0000'+trace.trace_id)):null;
    const intake=s.intake.filter((v)=>visibleApp(v.app,scope)&&(!scope||(v.trace_id&&scopedTraces.has(v.app+'\u0000'+v.trace_id))||v.parent_task_id===(scope.kind==='task'?scope.task.task_id:null))).slice(0,40);
    q('intake').replaceChildren(...(intake.length?intake.map((v)=>node('li',{},node('strong',{},v.title+' '),badge(v.status,v.status),node('div',{class:'meta'},v.kind+' · '+(v.trigger||'no trigger recorded')+' · '+shortTime(v.latest_at||v.started_at)),v.quality_reason?node('div',{class:'meta warn'},v.quality_reason):'')):[empty('No onboarding or non-ticket activity in this view.') ]));
  }
  function renderDelivery(s,scope) {
    const defs=[['ready','Ready'],['building','Building'],['in_review','Reviewing'],['blocked_on_approval','Waiting approval'],['returned','Returned'],['merged','Recently completed']];
    const sessionTickets=sessionTicketKeys(s,scope); const tickets=s.delivery.filter((v)=>visibleApp(v.app,scope)&&(!sessionTickets||sessionTickets.has(v.app+'#'+v.issue_number)));
    q('delivery').replaceChildren(...defs.map(([key,label])=>{ const rows=tickets.filter((v)=>v.state===key); return node('section',{class:'delivery-column','aria-label':label},node('h3',{},label,node('span',{class:'meta'},String(rows.length))),...(rows.length?rows.map(ticketCard):[empty('None') ])); }));
  }
  function ticketCard(ticket) {
    return node('button',{class:'ticket',type:'button',onclick:()=>selectTicket(ticket)},node('strong',{},'#'+ticket.issue_number+' '+ticket.title),node('span',{class:'meta'},ticket.app+' · '+(ticket.priority?'p'+ticket.priority:'no priority')+' · '+(ticket.tier||'tier unknown')),ticket.dependency_blocked?node('span',{class:'pill blocked'},'dependency blocked'):'',...ticket.pull_requests.flatMap((p)=>[node('span',{class:'pill'},'PR #'+p.number),badge('review '+p.review_integrity,p.review_integrity==='fresh_approved'?'completed':p.review_integrity==='stale_approval'||p.review_integrity==='changes_requested'?'failed':'unknown'),badge('checks '+p.check_integrity,p.check_integrity==='green'?'completed':p.check_integrity==='red'?'failed':p.check_integrity==='pending'?'blocked':'unknown')]));
  }
  function selectTicket(ticket) { const pass=state.snapshot.passes.find((p)=>p.app===ticket.app&&Number(String(p.ticket||'').replace('#',''))===ticket.issue_number); if(pass) openDrawer(pass.id); }
  function renderGraph(s,scope) {
    const f=currentFilters(), traces=sessionTraces(s,scope).filter((v)=>visibleApp(v.app,scope)); q('graph-scope').textContent=traces.length+' trace(s)';
    const graph=q('graph'); graph.replaceChildren(...(traces.length?traces.slice(0,20).map((trace)=>{ const passes=trace.pass_ids.map((id)=>s.passes.find((p)=>p.id===id)).filter(Boolean); const nodes=[]; passes.forEach((pass,index)=>{ if(index) nodes.push(node('span',{class:'arrow','aria-hidden':'true'},'→')); nodes.push(node('button',{class:'trace-node '+pass.status+' '+pass.liveness,type:'button',onclick:()=>openDrawer(pass.id),'aria-label':pass.role+' '+pass.pass+' '+pass.status},node('strong',{},pass.role),node('div',{},pass.pass),node('div',{class:'meta'},pass.runtime+'/'+(pass.model||'?')),badge(pass.status,pass.status),pass.status==='running'?badge(pass.liveness,pass.liveness):'')); }); for(const skip of trace.skipped_passes){ if(nodes.length) nodes.push(node('span',{class:'arrow','aria-hidden':'true'},'→')); nodes.push(node('div',{class:'trace-node skipped','aria-label':'Skipped '+skip.pass},node('strong',{},skip.pass),node('div',{class:'meta'},skip.reason),badge('skipped','unknown'))); } return node('div',{class:'trace','aria-label':'Trace '+trace.trace_id},...nodes); }):[empty('No correlated trace evidence for the selected filters.') ]));
  }
  function renderActivity(s,scope) {
    const f=currentFilters(); const events=sessionPasses(s,scope).filter((p)=>visibleApp(p.app,scope)&&(!f.role||p.role===f.role)&&(!f.status||p.status===f.status)).flatMap((p)=>p.events.map((e)=>({p,e}))).sort((a,b)=>b.e.ts.localeCompare(a.e.ts)).slice(0,300);
    const list=q('activity'); const wasBottom=list.scrollTop+list.clientHeight>=list.scrollHeight-20; list.replaceChildren(...(events.length?events.map(({p,e})=>node('li',{},node('time',{},shortTime(e.ts)),node('div',{},e.event+' · '+p.app+' · '+p.role+'/'+p.pass),node('div',{class:'meta'},summarizeDetail(e.detail)),e.error_code?badge(e.error_code,'failed'):'')):[empty('No structured activity in this view.') ])); if(state.autoScroll||wasBottom) list.scrollTop=0;
  }
  function summarizeDetail(detail) { return Object.entries(detail||{}).map(([k,v])=>k+'='+String(v)).join(' · '); }
  function renderHistory(s,scope) {
    const tasks=s.parent_tasks.filter((v)=>(!v.app||visibleApp(v.app,scope))&&(!scope||scope.kind==='task'&&v.task_id===scope.task.task_id)); const traces=sessionTraces(s,scope).filter((v)=>visibleApp(v.app,scope));
    const rows=tasks.length?tasks.map((task)=>node('article',{class:'card history-row'},node('div',{},node('strong',{},task.task_id),node('div',{class:'meta'},task.objective)),node('div',{class:'integrity'},task.completion_integrity.reasons.length?task.completion_integrity.reasons.join(' · '):'All recorded integrity requirements satisfied'),badge(task.status,task.status))):traces.slice(0,30).map((trace)=>node('article',{class:'card history-row'},node('div',{},node('strong',{},trace.trace_id),node('div',{class:'meta'},trace.app+' · '+trace.pipeline)),node('div',{class:'integrity'},trace.completion_integrity.reasons.join(' · ')||'Recorded trace complete'),badge(trace.status,trace.status)));
    q('history').replaceChildren(...(rows.length?rows:[empty('No parent-task or trace history recorded.') ]));
  }
  function renderSources(s) { q('sources').replaceChildren(...s.sources.map((v)=>node('article',{class:'source'},node('h3',{},v.id+' '),badge(v.status,v.status==='healthy'?'completed':v.status==='degraded'?'blocked':'failed'),node('p',{class:'meta'},v.detail),node('p',{class:'meta'},'observed '+shortTime(v.observed_at))))); }
  function openDrawer(id) { state.selectedPass=id; const pass=state.snapshot.passes.find((p)=>p.id===id); if(pass) renderDrawer(pass); }
  function renderDrawer(pass) {
    q('drawer').hidden=false; q('drawer-backdrop').hidden=false; document.body.style.overflow='hidden';
    const artifactButtons=pass.artifacts.map((a)=>node('button',{class:'artifact-link',type:'button',disabled:!a.available,onclick:()=>openArtifact(a)},a.label+(a.available?'':a.expired?' — expired by retention':' — not available')));
    q('drawer-body').replaceChildren(
      drawerSection('Identity', [['Pass identity',pass.app+' / '+pass.run_id],['Trace',pass.trace_id],['Parent task',pass.parent_task_id||'not recorded'],['Ticket',pass.ticket||'not recorded'],['Pipeline / pass / role',pass.pipeline+' / '+pass.pass+' / '+pass.role],['Runtime / model / effort',(pass.runtime||'?')+' / '+(pass.model||'?')+' / '+(pass.effort||'?')],['Authority',pass.authority?pass.authority.version+' · sha256:'+pass.authority.sha256:'not recorded'],['Native session',pass.session?pass.session.transcript_note:'not recorded']]),
      drawerSection('Progress', [['Status',pass.status],['Liveness',pass.liveness+' — '+pass.liveness_reason],['Role/app lock',pass.lock?'pid '+pass.lock.pid+' · '+(pass.lock.fresh?'fresh':'stale')+' at '+pass.lock.heartbeat_at:'not recorded'],['Started',shortTime(pass.started_at)],['Finished',shortTime(pass.finished_at)],['Latest heartbeat',shortTime(pass.last_heartbeat_at)],['Terminal reason',pass.terminal_reason||'none recorded']]),
      node('section',{},node('h3',{},'Input and evidence'),node('p',{class:'warning'},'Exact L3 evidence is local and may contain sensitive text.'),...artifactButtons),
      drawerSection('Output and verdict', [['Verdict',pass.verdict_summary||'not recorded'],['Previews',Object.entries(pass.previews).map(([k,v])=>k+': '+v).join(' · ')||'none'],['Result refs',pass.result_refs.map((r)=>r.source+': '+r.ref).join(' · ')||'none']]),
      drawerSection('Usage', [['Tokens in / out',String(pass.usage.tokens_in)+' / '+String(pass.usage.tokens_out)],['Cache read / write',String(pass.usage.cache_read_tokens)+' / '+String(pass.usage.cache_write_tokens)],['Cost',formatCost(pass.usage.cost_usd,pass.usage.quality)],['Quality',pass.usage.quality+(pass.usage.settled?' · ledger settled':' · not settled')],['Tools / subagents / escalations',pass.tool_calls+' / '+pass.subagents+' / '+pass.escalations]]),
      node('section',{},node('h3',{},'Gates'),...(pass.gates.length?pass.gates.map((g)=>node('div',{class:'card'},badge(g.status,g.status),node('strong',{},g.gate),node('p',{class:'meta'},g.detail||'no detail'))):[node('p',{class:'meta'},'No gate result recorded')]))
    ); q('close-drawer').focus();
  }
  function drawerSection(title, rows) { const dl=node('dl',{}); for(const [key,value] of rows) dl.append(node('dt',{},key),node('dd',{},String(value))); return node('section',{},node('h3',{},title),dl); }
  function closeDrawer() { state.selectedPass=null; q('drawer').hidden=true; q('drawer-backdrop').hidden=true; document.body.style.overflow=''; }
  async function openArtifact(artifact) {
    if(!artifact.available||!artifact.href) return; q('artifact-title').textContent=artifact.label; q('artifact-content').textContent='Loading…'; q('artifact-dialog').showModal();
    try { const response=await fetch(artifact.href+tokenQuery(),{cache:'no-store'}); q('artifact-content').textContent=response.ok?await response.text():'Artifact request failed: '+response.status; } catch(error) { q('artifact-content').textContent=String(error); }
  }
  function replaceSessionUrl(value) { const url=new URL(location.href); if(value) url.searchParams.set('session',value); else url.searchParams.delete('session'); history.replaceState({},'',url); }
  function syncUrl() { const url=new URL(location.href), f=currentFilters(); for(const key of ['app','role','status']) { if(f[key]) url.searchParams.set(key,f[key]); else url.searchParams.delete(key); } history.replaceState({},'',url); render(); }
  q('session-selector').addEventListener('change',()=>{ state.selectedSession=q('session-selector').value; closeDrawer(); replaceSessionUrl(state.selectedSession); render(); });
  for(const id of ['app-filter','role-filter','status-filter']) q(id).addEventListener('change',syncUrl);
  q('clear-filters').addEventListener('click',()=>{ q('app-filter').value=''; q('role-filter').value=''; q('status-filter').value=''; syncUrl(); });
  q('close-drawer').addEventListener('click',closeDrawer); q('drawer-backdrop').addEventListener('click',closeDrawer); document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!q('drawer').hidden) closeDrawer(); });
  q('activity').addEventListener('scroll',()=>{ state.autoScroll=q('activity').scrollTop<10; q('resume-stream').hidden=state.autoScroll; }); q('resume-stream').addEventListener('click',()=>{ state.autoScroll=true; q('activity').scrollTop=0; q('resume-stream').hidden=true; });
  const params=new URL(location.href).searchParams; state.selectedSession=params.get('session')||''; for(const key of ['app','role','status']) if(params.get(key)) q(key+'-filter').dataset.initial=params.get(key);
  fetchSnapshot().then(()=>{ for(const key of ['app','role','status']) { const value=q(key+'-filter').dataset.initial; if(value) q(key+'-filter').value=value; } render(); connect(state.snapshot.cursor); }).catch((error)=>{ setConnection('offline','offline'); q('banner').hidden=false; q('banner').textContent=String(error); });
})();`;
