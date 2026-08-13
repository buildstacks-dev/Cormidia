---
name: cormidia-job
description: Author and run ad-hoc dependency-ordered job graphs with the installed `cormidia-job` command. Use when the user wants a one-off or on-demand multi-step piece of work with dependencies between steps — a strategy exercise, a cross-team synthesis, a research sweep, a recurring audit — that runs to completion and is NOT product development. Reach for it when a task needs step X's output to feed step Y, when different steps should run on different models, or when the work must survive being interrupted over days. NOT for developing or operating a software product: tickets, pull requests, code review, releases, and anything reaching GitHub belong to the `cormidia` skill instead.
---

# Cormidia jobs

`cormidia-job` runs a **job**: a named set of steps with declared dependencies,
executed one at a time in dependency order, resumable across process death,
producing files that downstream steps consume.

Use the installed command as the source of truth. Do not read the Cormidia
implementation repository to discover behavior.

```bash
command -v cormidia-job
cormidia-job --help
```

If missing, install the package that provides it: `npm install -g cormidia`. It
ships two binaries — `cormidia` and `cormidia-job` — and they carry **different
guarantees**. See "Which skill" below before choosing.

## Which skill: jobs or the org runtime

This is the decision to get right, because the wrong choice is easy and the job
path is the more tempting one — it needs no org, no app, and no ticket.

**Use `cormidia-job` when the work:**

- has no repository it belongs to, or produces documents rather than code;
- runs to completion once (or on demand) rather than continuously;
- is genuinely the user's own analysis, synthesis, research, or audit.

**Use the `cormidia` skill instead when the work:**

- implements, reviews, or ships product code;
- needs a ticket, a branch, a pull request, or a merge;
- should be picked up automatically by a schedule or an event;
- is a release, a deployment, or an external publication.

A job **cannot** open an issue, push a branch, create a PR, or publish
anything. If the user's goal requires any of those, a job is the wrong tool and
saying so is more useful than building a graph that cannot finish the job.

**If the working directory is a repository registered as a Cormidia app**, stop
and confirm with the user before authoring a job for it. Product work in a
registered app almost always belongs in the governed loop; a job there is
legitimate only for genuinely non-product work (an audit, a docs sweep, a
research pass).

## What a job does not give the user

State this plainly whenever presenting job output. It is the difference between
honest and misleading.

| Not provided | Consequence |
| --- | --- |
| Independent review | Nothing adversarially reads a step's output. There is no reviewer. |
| A merit verdict | "Completed" means the provider returned **and** the declared checks passed. It never means the work is correct. |
| Ticket lifecycle | No claim, branch, PR, or merge. A failed step stops the job. |
| GitHub anything | Jobs never touch a remote. |
| Learning input | Job output never becomes a Cormidia lesson or calibration evidence. |

What a job **does** carry, because it runs on the same runtime: the
critical-ops gate (an irreversible or outward-facing action still needs the
human's approval), per-turn budget ceilings, and exactly-once spend accounting.

## Authoring a job

Write a YAML file **in the user's own repository or working directory**, not in
hidden state. A job worth running twice becomes a reviewable file.

```yaml
job: q3-strategy-cascade          # stable id; path-safe; names the journal
app: null                          # or a registered app name to scope evidence to it
description: >
  One or two lines on what this job is for.

steps:
  - id: framing
    objective: |
      What this step must do, concretely, and exactly which files to write.
      Be specific: the model sees this text and the dependency outputs, nothing else.
    assignment: { harness: claude, model: claude-opus-5, effort: xhigh }
    outputs:
      - path: outputs/framing.md
        check: non_empty

  - id: analysis
    dependsOn: [framing]
    objective: Use the framing to analyse inputs/. Write outputs/analysis.json.
    assignment: { harness: codex, model: gpt-5.6-sol, effort: high }
    outputs:
      - path: outputs/analysis.json
        check: json

  - id: review-before-synthesis
    dependsOn: [analysis]
    checkpoint:
      prompt: Read outputs/analysis.json before synthesis proceeds.

  - id: synthesize
    dependsOn: [review-before-synthesis, analysis]
    objective: Produce outputs/brief.md from the analysis.
    outputs:
      - path: outputs/brief.md
        check: non_empty
```

Then, always before running:

```bash
cormidia-job explain <config.yaml>     # token-free; validates and prints the plan
cormidia-job run <config.yaml> --workdir <path>
```

`explain` costs nothing and writes nothing. Run it after every edit — a
structural error caught there costs zero provider turns, and the same error
found at run time may cost several.

## The five rules worth internalizing

**1. Every step needs a declared output with a check.** This is the only thing
standing in for a reviewer. A long job will produce a step that does not fail —
it returns confident prose the next step cannot use — and without a check,
later steps build on it and the user finds out days later. A step with no
declared outputs completes as `completed_unverified`, which is a warning, not a
pass.

Check kinds: `exists`, `non_empty`, `json`, `{ schema: <path> }`,
`{ command: <cmd> }`. Prefer the strictest one that fits. If a downstream step
reads a specific field, use `schema`. If the job's output is a change rather
than a document, use `command` with the project's real gate
(`pnpm test`, `pytest`, `make check`).

**2. Objectives must name their output files explicitly.** The step's prompt is
its objective plus the *content* of its dependencies' declared outputs. If the
objective does not say where to write, the step will produce prose and fail its
own check.

**3. One step at a time, in dependency order.** `dependsOn` buys ordering and
resumability, not parallelism. Two independent steps still run sequentially, so
do not split work into many steps expecting speed — split it when the
intermediate artifact is genuinely worth checking.

**4. Put a checkpoint wherever the user would want to redirect.** A `checkpoint`
step parks the job and waits. For anything long-running or consequential, this
is the difference between an exercise the user steered and a script that ran for
a week. Resume with `--decide-checkpoint <step-id>`.

**5. Different steps can use different models, and that is the main reason to
use this tool.** `harness` is `claude`, `codex`, or `pi`; `model` must be one
the harness actually serves; `effort` is `low|medium|high|xhigh|max`. Omit
`assignment` to use the `operator` role's configured default. Naming a model
cannot widen what the step is permitted to do — permission lives in the role.

## Resuming, and why a config edit is refused

Re-running the same job id resumes: completed steps are never re-executed and
cost nothing.

The journal binds a hash of the step graph. **Editing an objective, a
dependency, or a step's outputs makes a resume refuse**, naming the drift,
because the completed steps were never part of the edited graph. Editing only
`description` is fine. When the graph genuinely must change, either use a new
`job:` id or start over deliberately.

Interrupted steps are retried at most once. A step that dies twice stops the job
with evidence rather than burning a third turn.

## Reading a failure

A failed job names the step, a reason code, and what was wrong. Common cases:

- `job_output_check_failed` — the step ran but its declared file is missing,
  empty, or malformed. Usually the objective did not say where to write, or the
  check is stricter than the step's instructions.
- `job_dependency_output_missing` — a completed step's artifact was deleted or
  moved. Restore it, or start the job over with a new id.
- `job_config_drifted` — see above.
- `job_nested_invocation` — `cormidia-job` was invoked from inside a Cormidia
  provider turn. This is refused by design; run it from a normal shell.

Completed steps are durable. Fix the cause and re-run to continue from the
failed step.

## Do not claim more than the job proves

When reporting results, say what the checks actually verified — that a file
exists, parses, or that a command exited zero. Do not describe job output as
reviewed, validated, or approved. Nothing in a job measures whether its output
is *good*; that judgement is the user's.
