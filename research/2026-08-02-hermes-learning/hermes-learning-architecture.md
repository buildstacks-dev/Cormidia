# Hermes Agent learning architecture

*2026-08-02. Reader-guide mode: tutorial. Descriptive research, not a Cormidia
decision or implementation contract.*

## Snapshot and conclusion

This document describes
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) at
commit
[`9060e3c2d3d3f7f3a21c297b5617e06ff9237085`](https://github.com/NousResearch/hermes-agent/tree/9060e3c2d3d3f7f3a21c297b5617e06ff9237085),
cloned on 2026-08-02. Statements about defaults and implementation details are
bounded to that snapshot.

Hermes does not have one formal learning state machine. Its “closed learning
loop” is a composition of six mechanisms:

1. very small declarative memory injected into the system prompt;
2. progressively disclosed procedural skills;
3. searchable session history for episodic recall;
4. periodic, model-authored reflection that may update memory or skills;
5. deterministic skill aging plus optional LLM consolidation; and
6. an optional external memory provider, independently configurable from the
   built-in store and additive under the defaults.

That composition is optimized for a personal agent: retain useful context,
keep the always-on prompt small and cacheable, and make stale procedures
recoverable. It is not an outcome-validation loop. Hermes can decide that a
lesson looks reusable, but it does not natively prove through a control,
treatment, or regression gate that the lesson improved later work.

## Terms

| Term | Meaning in this document |
| --- | --- |
| Declarative memory | Short facts, preferences, and environmental details stored in `MEMORY.md` and `USER.md`. |
| Skill | A Markdown package containing a reusable procedure, progressively loaded only when relevant. |
| Session history | Persisted conversation and tool history in SQLite, searchable on demand. |
| Background review | A best-effort agent fork, triggered after a cadence threshold, that reflects on recent work and may mutate memory or skills. |
| Curator | Long-horizon skill-library maintenance: deterministic aging/archive, with expensive LLM consolidation off by default. |
| Learning graph | A visualization and editing surface over memory and skills, not a retrieval or evaluation engine. |
| External memory provider | One optional plugin that adds provider-specific recall and synchronization; built-in memory is enabled alongside it by default but can be disabled independently. |

## System shape

```mermaid
flowchart TD
    START[Session starts] --> PROMPT[Build one frozen system prompt]
    MEM[(MEMORY.md + USER.md)] --> PROMPT
    SOUL[SOUL.md and context files] --> PROMPT
    SKILLIDX[Skill metadata index] --> PROMPT

    PROMPT --> TURN[Foreground agent turn]
    TURN --> VIEW[Load a skill body on demand]
    TURN --> SEARCH[Search SQLite session history on demand]
    TURN --> MWRITE[Memory tool mutation]
    TURN --> SWRITE[Skill package mutation]

    MWRITE --> MEM
    SWRITE --> SKILLS[(Skill packages)]
    SKILLS --> SKILLIDX

    TURN --> COUNTERS[Update memory-turn and skill-iteration counters]
    COUNTERS -->|threshold reached, after final response| REVIEW[Background review fork]
    REVIEW --> MWRITE
    REVIEW --> SWRITE

    SKILLS --> USAGE[(.usage.json activity state)]
    VIEW --> USAGE
    SWRITE --> USAGE
    USAGE --> CURATOR[Periodic curator eligibility check]
    CURATOR -->|stale / archive| ARCHIVE[(Recoverable skill archive)]
    CURATOR -->|optional consolidation| SKILLS

    TURN --> DB[(state.db sessions)]
    DB --> SEARCH
    MEM --> GRAPH[/journey learning graph]
    SKILLS --> GRAPH

    PROVIDER[Optional external memory provider] <--> TURN
    MWRITE -. committed write notification .-> PROVIDER
```

The important boundary is the frozen prompt. Durable writes take effect on
disk immediately, but the current session normally continues using its
original memory and skill-index snapshot. The new state becomes ambient
context on a new session, compression/rebuild, or another explicit
invalidation path. This trades immediate self-modification for prompt-prefix
stability.

## A learning journey, end to end

Imagine the user corrects a deployment procedure.

### 1. The session begins with a bounded working identity

Hermes assembles its core instructions, user-controlled identity/context
files, the two built-in memory files, and a compact index of available skills.
Full skill bodies do not enter the initial system prompt; after selection, a
body enters the model request as a tool result or slash-invocation message.
This assembled system prompt is kept stable for the session and may be
persisted with the session.

The built-in memory budgets are intentionally tiny by default:

- `MEMORY.md`: 2,200 characters, roughly 800 tokens by Hermes's estimate;
- `USER.md`: 1,375 characters, roughly 500 tokens.

Memory entries are separated by `§`. The memory tool supports add, replace,
remove, and atomic batch operations. It rejects exact duplicates and refuses
overflow rather than evicting an arbitrary older entry. The agent is expected
to merge or remove lower-value material deliberately.

### 2. The foreground agent chooses the right storage temperature

Hermes's prompt tells the model to put short facts and preferences in memory,
and reusable procedures in skills. A skill is a package rooted at `SKILL.md`;
it may also contain references, templates, scripts, or assets.

Skill loading uses progressive disclosure:

- **L0:** normally name and description in the system-prompt index; some
  postures demote categories to names only;
- **L1:** the selected `SKILL.md` body, loaded on demand;
- **L2:** supporting files, loaded only if the skill directs the agent to
  them.

This makes a large procedural library discoverable without paying its full
token cost on every request.

The explicit `/learn` command does not invoke a separate learning algorithm.
It builds a standards-oriented prompt and runs an ordinary agent turn with
the existing read/web/tool abilities. That turn is asked to synthesize exactly
one skill through `skill_manage`.

### 3. Durable mutation is guarded for integrity, but approval is optional

The built-in memory store uses per-file locking, checked reloads, atomic
replacement, drift backups, character limits, and all-or-nothing batches. Its
prompt snapshot scans entries for instruction-injection patterns. A blocked
entry remains on disk so it can be removed, but the prompt receives a warning
placeholder rather than the raw entry.

Skill writes validate package shape and paths, use atomic file operations, and
may run an agent-created-skill scanner. Both mutation surfaces have optional
approval gates, but the snapshot defaults are permissive:

- `memory.write_approval: false`;
- `skills.write_approval: false`;
- `skills.guard_agent_created: false`.

When enabled, foreground memory writes can be approved inline. Background
memory writes are staged because their worker cannot safely block on an
interactive prompt. All skill writes—including foreground writes—are staged,
because Hermes treats a skill package as too large for inline review.

### 4. Hermes periodically reflects after completing the user's turn

Hermes maintains two independent counters. The defaults are:

- memory review after 10 real user turns;
- skill review after 10 main-loop iterations.

“Ten iterations” is not exactly “ten tool calls”: it is the agent loop's own
iteration accounting. The two due flags are not consumed at one uniform
post-response checkpoint. Memory cadence reaches and resets its threshold
while preparing the foreground turn, before the model call; skill cadence is
checked and reset during turn finalization. Actual background-review spawning
is gated later on a usable, non-interrupted final response. An interrupted or
final-less turn can therefore consume a due trigger without launching review.
An allowed `memory` or `skill_manage` dispatch also resets its respective
counter before the tool executes, even if the mutation later fails.

When due, Hermes starts a daemon background-review agent with a maximum of 16
iterations. It receives a memory prompt, a skill prompt, or a combined prompt.
By default it reuses the parent model, provider, tool schemas, conversation,
and frozen prompt. The runtime is also inherited except that a parent using
`codex_app_server` is reviewed through `codex_responses`. The same-model path
preserves a warm prompt-cache prefix. If a different auxiliary model is
configured, Hermes sends a compact history digest instead of assuming cache
compatibility.

The review fork is deliberately constrained:

- it does not persist its review harness into the user's session transcript;
- it disables recursive memory/skill nudges;
- it does not attach an external memory provider;
- dangerous-command approvals are auto-denied;
- mutations of existing skills are limited to curator-managed local skills;
- existing pinned, protected, bundled, external, hub-owned, and user-owned
  targets are refused;
- an existing target file must have been read in that review before it can be
  changed.

Creation is a deliberate exception: the reviewer may create a new skill, and
a successful background create marks it curator-managed. Creating a new
support file also has no pre-existing exact file to satisfy the read-before-
write guard. The restrictions above should therefore be read as protections
for existing targets, not a blanket ban on autonomous skill creation.

The process is best-effort. It is a daemon thread, failures are logged rather
than retried durably, and the process can exit before the review commits.
The skill-review prompt is intentionally aggressive—its stated posture is that
most sessions should produce at least one skill update—so its later filters
against one-offs and unresolved failures do not eliminate overgeneralization
risk.

### 5. The curator controls procedural-library growth

Background reflection handles near-term learning. The curator handles
long-horizon library hygiene.

It is triggered by periodic eligibility checks at CLI startup and gateway
ticks, not by an independent cron daemon. Configured defaults are:

- enabled;
- one-week interval;
- at least two hours idle;
- mark stale after 30 unused days;
- archive after 90 unused days;
- retain five pre-run backups;
- LLM consolidation off;
- pruning of unused bundled built-ins on, except protected built-ins;
- hub-installed and external skills off-limits.

The first observation seeds the clock and waits a full interval before the
first real pass. A snapshot caveat is important: both inspected automatic
callers pass an effectively infinite idle duration, so they satisfy rather
than measure the configured two-hour threshold. The current automatic path can
therefore run while conversations are active; `min_idle_hours` is a policy
setting, not proved idle observation in those callers.

Normal curation is deterministic and has no model cost: it updates activity
state and moves long-unused skill directories into a recoverable archive. It
never auto-deletes their content. Restoring a categorized skill places it in
the flat top-level skill layout rather than recreating its original category,
so content is recoverable but organization is not perfectly round-tripped.

LLM consolidation is opt-in because it is qualitatively different. It can
survey multiple skills, patch drift, and merge overlapping procedures into
class-level umbrella packages. Its prompt is aggressive: it says a run ending
with fewer than ten archives stopped too early and authorizes direct terminal
moves. Those terminal mutations bypass `skill_manage`'s ownership and read-
before-write checks, leaving the prompt—not the same code guard—to preserve
protected/bundled/hub/external targets on that route. The prompt also advertises
an empty `absorbed_into` value for true pruning while the consolidation delete
guard rejects an empty forwarding target.

The official guide warns that a sweep may take 50–100 API calls. Each real
curator run first attempts a tarball snapshot, and dry-run, restore, pin,
adopt, archive, and rollback commands make the lifecycle operator-visible.

The `.usage.json` field `created_by: agent` should be read as a management
policy marker—“the curator may manage this”—not as reliable authorship
provenance. A user can adopt an unmanaged skill into that state.

Usage is also weaker evidence than its name suggests: a successful
`skill_view` increments both view and use counts, and the latest view/use/patch
timestamp refreshes the curator activity clock. Inspection can therefore keep
a skill active without proving that its procedure succeeded.

### 6. Old episodes remain searchable instead of staying in the prompt

Hermes stores session messages in SQLite and provides lexical full-text search
using FTS5/BM25, with fallbacks for cases such as CJK text. Search includes
history compacted out of the active conversation, while excluding undone
content. It normally excludes the current session lineage because that content
should already be active; compacted-away rows and legacy compression cases are
exceptions. Results and surrounding windows are bounded and may be truncated.

This is a third storage temperature:

- when enabled, built-in memory is tiny and ambient;
- skills are indexed but loaded only when selected;
- session history is large and queried only when needed.

The `/journey` view then projects memory chunks and used/agent-managed skills
into a graph. Skill relationships may be declared; memory-to-skill edges are
lexical heuristics. Its edit/delete controls mutate the underlying stores, but
the graph itself neither retrieves context for the model nor evaluates whether
a lesson is good. Positional memory-node identifiers can shift after an edit.

### 7. An external memory provider may add recall, not replace governance

Hermes may enable one external memory provider. The built-in store is enabled
alongside it under default settings, but its two file-backed memory surfaces
can be disabled independently while the provider remains active. The provider
lifecycle includes initialization, prefetch, turn synchronization,
pre-compression contribution, memory-write notification, delegation, and
session-end hooks.

Dynamic provider recall is structurally sanitized to strip nested provider
fences and Hermes's internal note, then fenced and injected into an API-copy
of the user message rather than changing the frozen system prompt. It does not
pass through the built-in memory prompt-injection scanner and is labeled to the
model as authoritative reference data. Completed, non-interrupted turns
synchronize after the response. Much of this work is best-effort and bounded;
a prefetch thread may still be joined for up to eight seconds, and shutdown
drains for only a bounded period. Provider use can send conversation and tool
data off-device, so profile scoping, semantic injection safety, and provider
trust remain operational responsibilities.

## How Hermes keeps learning optimized

| Pressure | Mechanism | Result | Trade-off |
| --- | --- | --- | --- |
| Always-on prompt size | Hard character caps for declarative memory | Predictable small identity/profile cost | The model must consolidate; no automatic value-based eviction |
| Large procedural library | Skill metadata first, bodies and support files on demand | Thousands of procedural tokens stay out of ordinary turns | Retrieval depends on names/descriptions and model choice |
| Long episodic history | SQLite full-text search | Old detail is retained without occupying active context | Lexical search can miss paraphrases; results are bounded |
| Prompt-cache churn | Freeze the system prompt per session; do not rebuild it after every write | Stable prefix and warm-cache reuse | A successful learning write is not ambient until a later rebuild |
| Reflection cost | Cadence counters and post-response background work | No reflection call on every turn; user response is not blocked | Best-effort review may fail or be lost |
| Auxiliary-model mismatch | Same-model warm-cache path; compact digest for a different model | Avoids feeding an incompatible full cached transcript | The digest is lossy |
| Context pressure | On Hermes-managed transports, prune old tool results, then make a structured summary and retain recent turns; `codex_app_server` delegates to Codex-native compaction | Long sessions can continue within a bounded model context | Summarization is lossy; the native path has different injection/threshold semantics |
| Skill sprawl | Usage telemetry, stale/archive states, pinning, deterministic pruning | Cold procedures leave the active library without being destroyed | A view counts as use/activity; recency is not proof of successful application or future value |
| Expensive reorganization | LLM consolidation off by default | Normal maintenance costs no model tokens | Overlap remains until an operator opts in |
| External-memory complexity | Single-select provider interface | Avoids combining conflicting external schemas | One provider can still add latency, privacy, and failure modes |

Skill discovery adds two smaller optimizations: an in-process LRU, and a disk
snapshot validated by file metadata with short scan caches. Hermes-managed
context compression also has locks, retries, cooldown/probation, and
ineffective-compression breakers. Its configured threshold is 50%, but the
implementation floors it at 75% for contexts under 512K tokens.
`codex_app_server` sessions instead use Codex-native compaction because local
summarization cannot shrink the remote thread; Hermes has no truthful seam for
injecting external-provider pre-compression text into that native path.

## Safety, reversibility, and what is not proved

Hermes has meaningful operational protections:

- bounded built-in memory and prompt-snapshot injection scanning (not semantic
  scanning of external-provider recall);
- atomic writes and drift checks;
- optional write approvals;
- ownership/read-before-write restrictions for existing autonomous skill
  targets on the `skill_manage` path;
- pinned and protected skills on guarded mutation/curation paths;
- content-recoverable archives, best-effort backups, dry-runs, and rollback;
- deterministic pruning before expensive model judgment.

Coverage is path-dependent: the learning graph and optional curator terminal
route do not traverse every top-level guard. Within that qualification, these
controls address “may this agent mutate this store?” and “can the user
recover?” They do not answer “did this change improve outcomes?” Background
review is prompt-driven self-judgment. There is no native treatment/control
assignment, declared efficacy metric, paired replay, independent reviewer,
immutable activation receipt, or regression-gated promotion. Any claim that a
Hermes-authored memory or skill is *validated* would therefore be an inference
outside the snapshot's evidence model.

## Snapshot-specific caveats and source disagreements

These are useful when reading the architecture, not reasons to dismiss it:

1. Some root comments still describe the curator as agent-created-only. The
   current defaults and curator guide set `prune_builtins: true`, allowing
   deterministic archival of unused bundled skills except protected ones.
2. The session-search guide describes three shapes and no truncation; the
   implementation exposes four operations with explicit result/window clamps.
3. Memory-provider prose calls prefetch non-blocking, while the coordinator can
   wait up to eight seconds for its daemon prefetch.
4. Hermes-managed compression prose emphasizes a 50% threshold, while smaller
   contexts use a 75% implementation floor. If semantic summarization cannot
   be produced, a visible deterministic fallback may discard the middle of
   active context; the original session rows remain searchable.
   `codex_app_server` instead invokes Codex-native compaction and does not
   expose the same provider pre-compression injection seam.
5. A foreground `skill_manage delete` can permanently remove a skill. The
   curator/background consolidation path archives instead, so “never deletes”
   applies to automatic curation, not every mutation surface.
6. The learning graph's direct edit path uses lower-level mutation helpers and
   does not traverse every top-level memory/skill approval and scan path.
7. The curator attempts a pre-run backup, but a failed snapshot does not
   necessarily prevent later mutation in the reviewed code path.
8. With consolidation enabled and no eligible skills, a string mismatch between
   candidate rendering and the LLM-pass skip check can still launch the
   expensive review. Consolidation being off by default contains this bug.
9. The curator guide says bundled/hub skills are excluded from telemetry
   writes, while the usage implementation records telemetry broadly and
   filters eligibility/reporting later.
10. Curator rollback promises to abort if its protective snapshot fails, but
    `snapshot_skills()` can return no snapshot after an I/O error and the
    rollback path does not check that result before proceeding.

Where explanatory prose and implementation differ, this guide reports the
implementation behavior and calls out the mismatch rather than blending the
two.

## Source coverage

The primary architecture set was 15 files totaling 49,817 words: the root
`README.md` and `AGENTS.md`; the memory, skills, curator, context-file,
compression/caching, and memory-provider guides; and the background-review,
learn-prompt, learning-graph, learning-mutation, memory-provider, memory-tool,
and skill-usage implementations. Targeted checks in configuration defaults,
prompt construction, agent initialization/finalization, session search,
curator backup, skill management, and the tool executor resolved defaults and
edge cases.

Pinned entry points:

- [Memory guide](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/website/docs/user-guide/features/memory.md)
  and
  [`MemoryStore`](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/tools/memory_tool.py)
- [Skills guide](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/website/docs/user-guide/features/skills.md),
  [`skill_manage`](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/tools/skill_manager_tool.py),
  and
  [skill usage/provenance](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/tools/skill_usage.py)
- [Background review](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/background_review.py)
  and
  [turn finalization](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/turn_finalizer.py)
  with cadence state in
  [turn context](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/turn_context.py)
  and
  [tool execution](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/tool_executor.py)
- [`/learn` prompt builder](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/learn_prompt.py)
- [Curator guide](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/website/docs/user-guide/features/curator.md),
  [curator implementation](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/curator.py),
  and
  [backup implementation](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/curator_backup.py)
- [Session search](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/tools/session_search_tool.py)
  and
  [SQLite/FTS implementation](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/hermes_state_search.py)
  and
  [learning graph](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/learning_graph.py)
- [Context compression and caching](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/website/docs/developer-guide/context-compression-and-caching.md)
  with
  [context compressor](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/context_compressor.py)
  and
  [conversation compaction](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/conversation_compression.py)
- [Memory-provider interface](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/memory_provider.py)
  and
  [provider-plugin guide](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/website/docs/developer-guide/memory-provider-plugin.md),
  coordinated by the
  [memory manager](https://github.com/NousResearch/hermes-agent/blob/9060e3c2d3d3f7f3a21c297b5617e06ff9237085/agent/memory_manager.py)

Excluded from the primary set were messaging-platform adapters, UI code,
browser/computer-use implementations, most provider transports, bundled skill
content, and tests unrelated to learning. The whole 8,261-file repository was
inventoried for navigation, but this is an architecture-focused reconstruction,
not a full security audit of Hermes.
