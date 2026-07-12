# Evidence inventory and trace reconstruction

## Preservation boundary

The historical sources under `/Users/bikram/.operon/Bikram-Org` are treated as
read-only evidence. Investigation output is written only under this folder and
to the Operon source/test tree. The original run artifacts were hashed after
collection. No envelope status, event stream, telemetry row, branch, or
worktree was repaired.

At `2026-07-12T02:07:23Z`, `operon learn report --json` refreshed derived
learning projections despite the command being advertised as read-only. It
created or rewrote the capture cursor, the episode projections, the
`20260711T193645-build-26.jsonl` learning event, and `orchestrator.jsonl`.
Those files are now tainted as post-investigation projections; the underlying
`runs/**`, `telemetry/**`, repository, and worktree evidence is unchanged.

## Primary sources

| Source | Location | Evidence note |
| --- | --- | --- |
| Original delegated task | `codex://threads/019f52a4-c8e6-7830-a6e0-d4bf3393e2e2` | Two completed turns; main execution ran `2026-07-11T19:26:00Z`–`19:51:40Z` |
| Telemetry HTML | `/private/tmp/buildstacks-operon-telemetry-2026-07-11.html` | SHA-256 `4f1fd77d02aef6640757a03ee7b3fb3e79aa7dfcc1248169179db025ae70476b` |
| State home | `/Users/bikram/.operon/Bikram-Org` | Run envelopes, events, forensic files, ledger, ticket claims, clone/worktree |
| Observed-defect note | `/Users/bikram/Build/Bikram-Org/operon-bugs.md` | SHA-256 `de24ea00f7694d205da0e1c2462e9ee8e987edd8720f285da0768361bab504f2` before investigation writes |
| Org configuration | `/Users/bikram/Build/Bikram-Org` | `apps.yaml`, `roles.yaml`, `pipelines.yaml`, TASTE and prompts read in full |
| Operator checkout | `/Users/bikram/Build/buildstacks.dev` | HEAD `14f7fbb624335406a9c7044f32a24e932287c7e8`, branch `build/buildstacks-v1` |
| Managed clone | `/Users/bikram/.operon/Bikram-Org/repos/buildstacks.dev` | HEAD `68276c208a704aef73c8befc318c74d038ed8563`, branch `main`; planning/learning files untracked |
| Managed ticket worktree | `/Users/bikram/.operon/Bikram-Org/worktrees/buildstacks.dev/op-26-v1-establish-astro-foundation-visual-system-home` | HEAD `68276c208a704aef73c8befc318c74d038ed8563`; 31 untracked implementation files |
| GitHub plan and delivery | issues #26, #27, #28 and PR #29 in `buildstacks-dev/buildstacks.dev` | All issues open and `op:in-review`; PR open, CI green, zero reviews, empty `reviewDecision` |

The installed CLI resolved package `/Users/bikram/Build/Operon`, org home
`/Users/bikram/Build/Bikram-Org`, and state home
`/Users/bikram/.operon/Bikram-Org`. `operon doctor --json` reported every
adapter `OK` while explicitly stating authentication was not verified.

## Trace-to-run map

All timestamps are persisted UTC timestamps.

| Trace | Run/pass | Start | End or last heartbeat | Persisted state | Durable result |
| --- | --- | --- | --- | --- | --- |
| `plan-buildstacks.dev-1783798200442` | `20260711-193000-plan-bootstrap-visionary` | `19:30:00.466Z` | `19:33:28.125Z` | completed | Claude emitted a complete three-ticket JSON plan, cost `$0.9096465` |
| same | `20260711-193328-plan-bootstrap-pm-a` | `19:33:28.142Z` | `19:37:28.171Z` | running | no output; tool activity exists in `session.log` |
| same | `20260711-193328-plan-bootstrap-pm-b` | `19:33:28.152Z` | `19:37:28.171Z` | running | no output; tool activity exists in `session.log` |
| `plan-buildstacks.dev-1783798322555` | `20260711-193202-plan-bootstrap-visionary` | `19:32:02.576Z` | `19:33:20.991Z` | completed | Codex strategic output, cost `$1.623685` |
| same | `20260711-193320-plan-bootstrap-pm-a` | `19:33:21.007Z` | `19:35:15.016Z` | completed | wrote untracked `.operon/planning/pm-a.md`, cost `$2.16997` |
| same | `20260711-193320-plan-bootstrap-pm-b` | `19:33:21.017Z` | `19:35:37.836Z` | completed | wrote untracked PM-B roadmap and learning candidate, cost `$2.812455` |
| same | `20260711-193537-plan-bootstrap-arbitrator` | `19:35:37.850Z` | `19:36:07.853Z` | running | no output; never reached decomposition/publication |
| `20260711T193645-build-26` | `20260711-193645-build-contract` | `19:36:45.184Z` | `19:41:16.626Z` | completed | 32-file contract, cost `$2.627995` |
| same | `20260711-194116-build-implement` | `19:41:16.671Z` | `19:46:46.692Z` | running | 32 write events in `session.log`; exactly 31 untracked files remain; no final usage |

The two planning traces overlap. Trace `...2555` began at `19:32:02Z`, while
the first trace's visionary pass was still active until `19:33:28Z`. The
first trace then launched both PM children after the outer task had already
treated that invocation as a failed/returned call. The second trace launched
its arbitrator after both PMs completed; the arbitrator never finalized.

## Planning artifacts and plan of record

The managed clone contains untracked:

- `.operon/planning/pm-a.md`
- `.operon/planning/pm-b.md`
- two Planner learning candidates

Neither trace emitted a completed arbitrator plus decomposer result, and no
trace published GitHub issues. The outer Codex task manually created #26,
#27, and #28 at `19:34:29Z`–`19:34:31Z`. The state home contains a claim file
only for #26. There are no run envelopes for #27 or #28.

## Delivery and review evidence

PR #29 targets `main` from `build/buildstacks-v1`, contains five commits, and
declares `Closes #26`, `Closes #27`, and `Closes #28`. Its validation check is
green. GitHub reports `reviews: []` and `reviewDecision: ""`. All three issues
remain open, which is expected until PR #29 merges; their `op:in-review` label
means "PR open; awaiting Reviewer" and does not mean approval.

The outer Codex task explicitly reported that it stopped Operon's Builder and
implemented directly. Therefore PR #29 and its CI result are real delivery
artifacts but are not proof that Operon's Builder/Reviewer lifecycle completed.

## Cost evidence

The report's `$10.1437515` is exactly the sum of the five finalized passes:
Planner `$7.5157565` plus Builder `$2.627995`. Four interrupted passes have no
`usage` object at all. The HTML/JSON presentation converts that absence into
`0/0` and `$0.00`. The implement pass performed substantial reads and writes,
so zero is not a defensible actual-spend value.

## Original-artifact hashes

Envelope hashes, in run order:

```text
8d1e8dd9cc94aeda921cb40e1b08d175a22be58ab8ddf935a9bc0f5f3abccfb0  20260711-193000-plan-bootstrap-visionary/envelope.json
20f7130c945f4d597e307bf08df80a434564c6e62803dc0dcdfff2e4fa43399a  20260711-193202-plan-bootstrap-visionary/envelope.json
63d6f1b966b3b1b6d4a37fbaadbd9b6c52ab2cf0093a33aac8d820635c2dd2d3  20260711-193320-plan-bootstrap-pm-a/envelope.json
e99dc4070ff97637f5291b3ced7207e84736d0c9eac231f16f395d24e51c6d57  20260711-193320-plan-bootstrap-pm-b/envelope.json
0acc3d73c90b156617ab51aa15415878f803b76d21d3aad0467d558e5813010e  20260711-193328-plan-bootstrap-pm-a/envelope.json
90147d8b9b2eba218e1fae9a8b15c360b9de62db44ebdc1e8ba1721031678cb5  20260711-193328-plan-bootstrap-pm-b/envelope.json
be9a3ed5ec4d0c2b98998cbf83e575b5ef662155f3a360c2c81f406f7d63d2e8  20260711-193537-plan-bootstrap-arbitrator/envelope.json
c73f6de67948cb3ff4ee47a07281789b54c93eb2652045c5cfa9abfb4809fbde  20260711-193645-build-contract/envelope.json
f8db4f0cf5af961704fb7a61a68289a17b6dab6f5ca156e911629d3649c8982f  20260711-194116-build-implement/envelope.json
```

The full brief/output/session/event hash inventory can be regenerated without
mutating evidence using `shasum -a 256 runs/buildstacks.dev/*/{envelope.json,events.jsonl,brief.md,output.md,session.log}`.

## Post-fix verification artifacts

These are derived reports outside the historical state home; generating them
did not repair or rewrite any July run artifact.

| Artifact | SHA-256 / result |
| --- | --- |
| `/private/tmp/buildstacks-operon-telemetry-2026-07-11-improved.html` | `d8788d36131138f59343af8e5245be51f64d0e2ccfd52f91e05d5069f576b5a7` |
| `/private/tmp/buildstacks-operon-telemetry-2026-07-11-improved.json` | `a45f063c36f7356be03d2926877bf141d77e0c3d0f0979f66f4c93a45565d311` |
| `/private/tmp/buildstacks-operon-telemetry-2026-07-11-improved.evidence/` | 41 redacted/copied evidence files with relative HTML links |
| learning-state hashes before/after installed `operon learn report --json` | identical manifest SHA-256 `6990a988c9829611fa4f4dafcdfc9b98a74bfddcd1482cee0d415a660a3a83e2` |
| `/private/tmp/buildstacks-learning-readonly-report.json` | `7e44c969b366d792f5ff779194bf1a8c0b702762cda113040821d87a838dced3` |

The improved report still—correctly—shows nine historical passes, four
interrupted/stale envelopes, unavailable cost completeness, a missing Reviewer,
no parent task record, and unverified PR state. Old envelopes lack the new
required-pass manifest, so trace completeness is `unknown`, not retroactively
invented. Planning is labeled `Pre-ticket planning` in current reports.

The installed CLI (`/Users/bikram/.local/bin/operon`) supplied two additional
behavioral checks against the preserved state:

- `operon analyze --app buildstacks.dev` emits both `stale_running` and
  `missing_finalization` for each of the four historical envelopes.
- `operon doctor --json` runs non-billable control-plane probes and reported
  Claude ready in 915 ms, Codex App Server ready in 83 ms, and pi skipped
  because no active-org role uses it. No model prompt was sent.

The read-only learning report reports five already captured runs, four pending
historical runs, and one legacy receipt that would be rebound only by an
explicit `--refresh`. That refresh was not run against the evidence state.
