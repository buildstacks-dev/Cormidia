export const OBSERVE_JOBS_HTML =
  '<section aria-labelledby="jobs-title"><div class="section-heading"><h3 id="jobs-title">Jobs</h3><span id="jobs-scope" class="scope-badge"></span></div><div id="jobs" class="history" aria-label="Durable job step states"></div></section>';

export const OBSERVE_JOBS_JS = `function renderJobs(s,scope) {
    const jobs=(s.jobs||[]).filter((job)=>!scope||job.app===scope.app||(job.app===null&&scope.app==='adhoc'));
    const kind=scopeKind(scope);
    renderSectionScope('jobs-scope','jobs',kind,sectionScopeText(kind,withFacets(scope?'this session app':'all visible apps'),disclose(jobs.length,jobs.length,false)),scope?'Job journals are app-scoped durable context, not part of a product trace.':'');
    q('jobs').replaceChildren(...(jobs.length?jobs.map((job)=>node('article',{class:'card history-row'},node('div',{},node('strong',{},job.job),node('div',{class:'meta'},job.app||'adhoc'),stamp(job.updated_at,'updated')),node('div',{class:'integrity'},...job.steps.map((step)=>node('div',{},step.step+': '+step.display_status))),badge(job.steps.some((step)=>step.durable_status==='failed')?'failed':'recorded',job.steps.some((step)=>step.durable_status==='failed')?'failed':'unknown'))):[empty('No durable job journal recorded.')]))
  }`;
