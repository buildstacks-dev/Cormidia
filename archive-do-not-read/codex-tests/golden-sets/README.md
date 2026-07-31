# Operon golden-set registry

Status: **Episode Planner slice frozen; remaining call sites are scaffold-only
— 2026-07-30**

Last updated: 2026-07-30

Golden sets are plain, versioned data and remain independent of the eventual
evaluation framework. One set will exist for each ratified call-site ID in
`../llm-eval-plan.md`; composite episode sets are registered separately because
they grade a full trajectory and final artifact rather than one model call.

The human authorized one exact provider campaign after Phase-6 risk weighting:
`episode-planner/` contains the 10-case `OPERON-L4-001` corpus. No other
prompt/model tuning or provider campaign is authorized by this registry.

## Planned per-call directories

| Call-site range | Planned directory |
| --- | --- |
| OPERON-LLM-001 | `episode-planner/` |
| OPERON-LLM-002–007 | `planning/<call-site>/` |
| OPERON-LLM-008–009 | `intake/<call-site>/` |
| OPERON-LLM-010–012 | `builder/<call-site>/` |
| OPERON-LLM-013–016 | `review/<call-site>/` |
| OPERON-LLM-017–018 | `sre/<call-site>/` |
| OPERON-LLM-019 | `support/digest/` |
| OPERON-LLM-020–021 | `marketing/<call-site>/` |
| OPERON-LLM-022–023 | `learning/<call-site>/` |

Planned cross-call sets:

- `episodes/<product-profile>/` — integrated outcome and proportionality;
- `judge-meta/<call-site>/must-catch/` — planted defects; and
- `judge-meta/<call-site>/must-pass/` — comparable clean artifacts.

## Baseline honesty

The current product prompts predate this new design. Initial manifests must set
`authored_before_prompt_tuning: false` and explain that they were frozen before
the **next** prompt/model change. Future new call sites must create and freeze
their set before tuning begins.

The eventual manifest format is defined in `manifest-template.yaml`.

## Frozen Episode Planner set

`episode-planner/manifest.yaml` binds:

- `OPERON-LLM-001`;
- `claude/claude-opus-5/xhigh`;
- 10 cases and 3 runs per case;
- 27/30 overall, 2/3 per case, and 3/3 for critical cases;
- USD 5 per turn and USD 60 aggregate; and
- a content hash over the sorted case filenames and bytes.

The cases operationalize “smallest sufficient, safe, executable” through
pre-provider required/forbidden roles and operations, exact safety
gate/approval sets, independent-review trajectories, and maximum graph size.
The acting model does not author this oracle. Production EpisodePlan parsing,
materialization, and validation remain the separate blocking contract oracle.

The set is honestly marked `authored_before_prompt_tuning: false`. It was
frozen before this campaign, not before the existing protected prompt was
written.

The authorized campaign ran on 2026-07-30 and stopped after 9/30 attempts on a
deterministic contract failure in `OPERON-EP-003` repetition 3. It spent USD
4.219405 and issued no qualification. The set and protected prompt were not
edited in response. A follow-up cannot reuse this failed result as a fresh
campaign.

`../campaigns/OPERON-L4-002/` deliberately reuses this corpus byte-for-byte
and binds the content hash in its preflight. The candidate overlay is outside
both the protected prompt and the frozen corpus. Its separately authorized
`OPERON-EP-003` × 3 diagnostic passed 3/3 contract and quality trials at USD
1.224494 total and issued no qualification. Any full rerun remains a fresh,
separately authorized 10 × 3 campaign.

## When a threshold fails

- Missing thresholds block qualification.
- Contract or guardrail failures block immediately and cannot be averaged into
  a quality pass.
- A failing candidate is not promoted; the currently qualified assignment is
  preserved.
- A failing judge cannot gate promotion or produce trusted downstream
  metrics.
- Evidence is retained. Golden cases are never weakened or rewritten merely
  to make a candidate pass.
- Deterministic defects deposit Layer-1/2 detectors, and legitimate bad model
  outputs remain or become versioned golden cases.

The full control flow is in `../llm-eval-plan.md` §12.
