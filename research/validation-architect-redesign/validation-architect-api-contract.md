# Validation Architect — package and API contract

## What a consumer installs, calls, and can rely on

Status: **recommended design**, not yet implemented.

Date: 2026-08-13 (supersedes the 2026-08-12 packaging record)

Companion documents:
[core improvements](./validation-architect-core-improvements.md) ·
[Cormidia adapter](./cormidia-validation-architect-adapter.md).

No implementation, npm publication, validation campaign, provider turn, or
release-shaped action was performed. Command names, schemas, and interfaces
below are proposals until separately accepted.

## 1. Scope: which of the three problems this document solves

Validation Architect is being reworked in three separable pieces. Mixing them
is what made the previous record hard to read, because a question about a
TypeScript signature sat next to a question about one particular host's budget
policy.

| # | Problem | Where it is decided | Repository |
| --- | --- | --- | --- |
| 1 | The method and its internal model are hard to understand and reuse. | [core improvements](./validation-architect-core-improvements.md) — **final** | `validation-architect` |
| 2 | **There is no published contract anyone can build against.** | **This document** | `validation-architect` |
| 3 | Cormidia needs to consume that contract for its users' applications. | [Cormidia adapter](./cormidia-validation-architect-adapter.md) — later | `Cormidia` |

This document answers one question: **what does the `validation-architect`
package expose, and what may a consumer depend on?** It contains no decision
that is specific to Cormidia. Anything that turned out to be a Cormidia policy
choice moved to document 3, listed in
[§11](#11-what-moved-to-the-cormidia-document).

The two supported uses are the ones the core document already names, and no
third one is introduced here:

- **Standalone use** — a person or CI job runs the tool against a repository.
  The repository under design is the *target*; there is no other system
  involved.
- **Embedded use** — another system imports the library and supplies the
  repository access and the model turns. That system is the *host*; its user's
  application is the target.

Cormidia is one host. So is a future GitHub Action, a hosted service, or
someone's internal platform. The contract must not assume which.

### Decisions at a glance

| ID | Decision |
| --- | --- |
| D1 | Split deterministic computation and provider-neutral campaign orchestration from standalone provider adapters. |
| D2 | Hosts inject three ports — repository read access, governed turns, and durable campaign checkpoints. The headless library owns no effects itself. |
| D3 | The core package publishes seven deterministic entry points plus provider-neutral `design`/`resume`; the design package supplies the standalone provider-backed CLI. |
| D4 | Publish two lockstep-versioned packages, split by whether code constructs and governs provider clients. |
| D5 | Ship the three skill directories as data in the core package; the package version is their only released identity. |
| D6 | The core package keeps its single `yaml` runtime dependency. The provider SDKs live only in the design package. |
| D7 | Method depth is a caller-selected profile keyed to C0–C4; a too-shallow run reports a typed escalation requirement but never changes its own budget. |
| D8 | Package SemVer plus independently versioned schema IDs. No separate contract manifest. |
| D9 | License the published package MIT. |

## 2. Why a contract is needed at all

Today the useful parts of Validation Architect are reachable only if you have
its source checkout. `pnpm vda` runs the campaign from `src/`, and the one
published binary — `validation-trace` — proves closure but cannot design,
explain, plan, or classify a result. A consumer who installs the package today
gets the smallest slice of the method and has to rebuild everything else.

That has two costs. Anyone who wants the method must either vendor a checkout
or reimplement the phases, which is exactly how two divergent copies of a
prompt-driven method get created. And the deterministic capabilities described
in the core document — compile, trace, explain, plan, result classification —
have no address a CI job can call.

The fix is not more features. It is drawing one boundary and publishing what
sits on each side of it.

## 3. The split that makes the API small

The single most useful observation about this system is that it does two
completely different kinds of work, and only one of them is expensive.

**Designing validation** requires model turns. It costs money, takes hours,
needs budgets and resumability, and must be governed by whoever is paying. The
campaign state machine can still be provider-neutral: it asks a host for a
governed turn and a durable checkpoint without constructing either facility.

**Everything else** — validating the corpus, proving it is closed against the
real test files, answering "why does this test exist", turning a changed-file
list into a test plan, and classifying what a test run actually showed — is
pure computation over files already on disk. No network, no spend, no
credentials, no authority.

Collapsing these into one surface is what forces every consumer to care about
provider governance even when they only wanted to run a CI check. Separating
them means the common case gets radically simpler:

```
Core package              no provider client · no credentials · no publication authority
  compile · check · explain · plan · ingest · render · migrate
  design · resume
        ▲
        │ same model, schemas, and campaign state machine
        ▼
Standalone adapters       provider clients · local checkpoint store · CLI
  designer · stakeholder · auditor · reader
```

This is also the packaging boundary (§8): the two halves have install profiles
that differ by roughly five hundred times, so they ship as two packages.

**D1. The public API separates deterministic computation and provider-neutral
campaign orchestration from provider adapters.** A consumer that only needs
closure checking in CI calls only the deterministic functions, installs no
provider SDK, and needs no secrets. An embedded host uses the same small core
package and supplies governed turns plus storage. Standalone use opts into the
provider-backed design package explicitly.

## 4. What the host supplies

A library that reads files, runs git, spawns processes, calls provider APIs and
writes branches has an unbounded blast radius, and every embedder has to audit
all of it. It is also untestable without a real repository and real spend.

So the headless library owns no effects. It asks the host for exactly three
capabilities and returns data for the caller to publish.

**D2. Hosts inject three ports.**

```ts
interface RepositoryPort {
  revision(): Promise<string>;                              // exact commit identity
  readFile(path: string): Promise<string | null>;
  listFiles(globs: string[]): Promise<string[]>;
  changedPaths(base: string, head: string): Promise<string[]>;
}

interface TurnPort {                                        // campaign only
  runTurn(request: TurnRequest): Promise<TurnResult>;
}

interface CampaignStorePort {                               // campaign only
  load(runId: string): Promise<CampaignCheckpoint | null>;
  save(checkpoint: CampaignCheckpoint, expectedGeneration: number): Promise<void>;
}
```

`RepositoryPort` is read-only by construction. The standalone CLI implements it
over the filesystem and `git`; an embedder implements it over whatever checkout
it already manages. The test inventory is not a third port — the library
derives it by listing and parsing spec files, which is what the existing
`scanSpecs` already does.

`CampaignStorePort` is a host-owned compare-and-swap store. The campaign saves
the next pending request before invoking a turn and saves the accepted result
afterward. A stale `expectedGeneration` is refused rather than overwriting
another process. The standalone adapter implements it with an atomic local
checkpoint file; Cormidia implements it in its state home. The checkpoint is a
published `design-run/v1` object containing the exact package version, source
revision, admitted envelope, state-machine position, pending idempotency key,
accepted turn receipts, and the opaque native session identities needed to
continue persistent seats.

`TurnRequest` describes a *logical seat instance*, never a provider assignment:

```ts
type Seat = "designer" | "stakeholder" | "auditor" | "reader";

interface SeatRef {
  seat: Seat;
  instance: string;              // designer, stakeholder, auditor:1, reader:operator, ...
}

type IndependenceDimension = "provider" | "model" | "session";

interface IndependenceRequirement {
  from: SeatRef;
  dimensions: IndependenceDimension[];
}

type SessionRequest =
  | { mode: "new" }
  | { mode: "resume"; sessionId: string };

interface TurnRequest {
  seat: SeatRef;
  independence: IndependenceRequirement[];
  session: SessionRequest;
  idempotencyKey: string;        // stable across crash recovery
  prompt: string;
  outputSchema?: JsonSchema;    // when the turn must return structured data
  limits: { maxTokens?: number; maxWallMs?: number };
  metadata: { runId: string; phase: string; turnIndex: number };
}

interface ExecutionIdentity {
  provider: string;              // opaque, stable and comparable within this host
  model: string;                 // opaque, stable and comparable within this host
  session: string;               // exact native session identity
}

type TurnResult =
  | {
      status: "ok";
      text: string;
      parsed?: unknown;          // validated against outputSchema by the library
      identity: ExecutionIdentity;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | {
      status: "refused" | "limit_exhausted" | "error";
      reason: string;
      identity?: ExecutionIdentity; // absent when refusal happened before assignment
      usage?: { inputTokens: number; outputTokens: number };
    };
```

Four properties are worth calling out because they are contract, not
convenience.

`independence` states *which kind* of separation the method needs. The persistent
Designer and Stakeholder seats are cross-provider because their disagreement is
the method's anti-yes-loop. Readers and each audit iteration are new sessions
that share no context with the Designer or one another; the current method does
not require the Auditor to use a different model. The library compares the
returned provider, model, and session identities along the requested dimensions
and refuses a mismatch, so neither a fresh session nor a model alias can be
misrepresented as cross-provider review.

`session` makes context lifecycle explicit. Designer and Stakeholder start once
and then resume the exact returned native session. Each reader persona and audit
iteration starts with `mode: "new"`. A host may not infer freshness or
continuation merely from the seat name.

`idempotencyKey` closes the crash window between a provider result and the next
checkpoint. Replaying the same pending request must reconcile and return the
same settled turn result, never spend a second turn. Cormidia binds this key to
its ordinary provider-turn settlement identity.

`status` has no success-by-omission. A refusal, an exhausted limit, or an error
is a typed outcome that flows into the result record as incomplete evidence.
The library never retries around it, never substitutes a different seat, and
never adds an unplanned turn to recover.

**What the headless core never does.** It constructs no provider client, opens
no socket itself, spawns no subprocess, writes no file in the target repository,
creates no branch or pull request, reads no credential, or reaches a conclusion
about what the caller is authorized to do. It requests repository reads, turns,
and checkpoints through the three ports. The standalone design package supplies
concrete provider and local-store adapters; `design` still returns an artifact
bundle, and its caller decides where that bundle lands.

## 5. The public API

With the split and the ports in place, the surface a consumer has to learn is
small. Every deterministic function is a pure function of the corpus plus
repository facts, so all of them can be tested offline against fixtures.

**D3. The packages expose these entry points and no others.** All nine
provider-neutral functions are in the core package. The standalone design
package supplies the concrete provider adapters and CLI that call the same
`design` and `resume` functions (§8).

| Entry point | Spends | Answers |
| --- | --- | --- |
| `compile(repo)` | — | Is the design corpus valid, and what are its current human views? |
| `check(repo)` | — | Is the corpus closed against the tests that actually exist? *(the CI gate)* |
| `explain(repo, query)` | — | Why does this test exist? What protects this rule? |
| `plan(repo, changed)` | — | Given these changed paths, what should run, why, and what does it need first? |
| `ingest(output, ctx)` | — | What did that run actually show, as one portable record? |
| `render(view, facts)` | — | The same facts written for an author, architect, reviewer, or operator. |
| `migrate(corpus, to)` | — | Explicit, reviewable upgrade across a schema major. |
| `design(request, ports)` | turns | Produce or revise a corpus. |
| `resume(runId, ports)` | turns | Continue an interrupted campaign from its checkpoint. |

Notes that keep the surface this small:

- **`check` is separate from `compile`** because they answer to different
  readers. `compile` returns findings and regenerated views for an author;
  `check` returns a fail-closed `ValidationResult` for a gate.
- **Environment prerequisites live in the plan**, not in a separate `doctor`
  function. `plan` returns `requires: CapabilityRequirement[]` alongside its
  commands, so "can this environment run this plan" is answered by the object
  you already have. A bare environment check is `plan(repo, [])`, which yields
  the full-suite plan and its full requirement set.
- **Version negotiation is not an entry point.** Every function that loads a
  corpus refuses an unsupported schema major with a typed error naming the
  supported range. `migrate` exists only for the deliberate upgrade.
- **`render` exists so there is exactly one fact model.** The four role views
  in the core design are projections of the objects above, not four separately
  maintained outputs. Facts are returned as data; prose is generated from that
  data on request.

`design` publishes its envelope before it runs — the selected profile, the
maximum turn count, the required seat and session independence, the output
schemas, and the method version. C0–C2 publish a finite sequence. C3/C4 publish
a finite transition graph with explicit states, permitted transitions, terminal
coverage, and per-transition turn costs because gate refusals, reader residue,
and audit dispositions determine the next step. Both shapes are bounded and
admittable; neither pretends an adaptive relay is a predetermined sequence. A
host admits the envelope against its own budget before the first turn.
Exhausting a declared bound is a typed incomplete result; the library never
extends its own envelope.

`design` returns a bundle, not a side effect:

```ts
interface DesignBundle {
  files: Array<{ path: string; content: string }>;   // the corpus, unwritten
  provenance: Provenance;                            // versions, revision, run identity
  profileAssessment: {
    selected: "C0" | "C1" | "C2" | "C3" | "C4";
    minimumSupportedByFindings: "C0" | "C1" | "C2" | "C3" | "C4";
    escalationRequired: boolean;
  };
  audit:
    | { status: "not_required_by_profile" }
    | {
        status: "performed";
        verdict: "clean" | "clean-with-reservations" | "reservations";
        findings: AuditFinding[];
      };
  usage: { turns: number; inputTokens: number; outputTokens: number };
}

type DesignOutcome =
  | { status: "complete"; bundle: DesignBundle }
  | {
      status: "incomplete";
      checkpoint: CampaignCheckpoint;
      reason: "turn_refused" | "limit_exhausted" | "turn_error" | "invalid_artifact";
      nextAction: string;
    };
```

Failure is an outcome of the campaign, not an audit verdict. C0 records that an
audit was not required by its selected profile instead of calling an unaudited
result clean. A discovered criticality above the selected profile is equally
explicit: the admitted run may finish within its budget and return its bundle,
but `escalationRequired` prevents a host from presenting that shallow design as
sufficient for the discovered use.

The standalone CLI writes that bundle to `validation-design/` on a branch. An
embedder writes it through whatever publication path it already trusts. There
is one publisher per host and the library is never it — two publishers would
mean two places where a corpus can appear and disagree.

## 6. Schemas: the part that outlives the install

A corpus written today will be read by a package version that does not exist
yet, in a repository whose owner may never have run the tool. Files on disk
outlive the process that wrote them, so they have to describe themselves.

Every artifact carries a schema ID with its own major, following the
convention already in use (`validation-architect/case-catalog/v1`). The
published set is:

| Schema ID | What it describes |
| --- | --- |
| `validation-architect/corpus/v1` | The design model: structures, families, owners, layers, oracles, negative controls, statuses, links. |
| `validation-architect/case-catalog/v1` | The generated catalog manifest (exists today). |
| `validation-architect/result/v1` | One run outcome, defined in core §9.5. |
| `validation-architect/plan/v1` | An explained test plan with requirements, expansions, and unknowns. |
| `validation-architect/design-run/v1` | Campaign request, envelope, and resumable state. |
| `validation-architect/provenance/v1` | Versions, revision, profile, tier, and run identity stamped into every artifact. |

`result/v1` is the one most consumers touch, and this document does not
redefine it — the three axes (applicable, complete, verdict), the five reasons,
and the required record contents are fixed in
[core §9.5](./validation-architect-core-improvements.md). What this document
adds is the promise: it is a published, versioned schema, hosts may add
namespaced fields, and no host may redefine the meaning of an existing field.
Incomplete evidence never renders as a pass, in any consumer.

## 7. Method depth: matching effort to consequence

Not every product deserves the same validation campaign. Someone building a
weekend prototype does not need a bounded designer-stakeholder relay, three
fresh readers, and a two-iteration independent audit — they need a usable test
plan in a few minutes. A billing ledger or an infrastructure controller needs
every one of those things, because being wrong is expensive and the people
affected did not choose the risk.

If the only available method is the deep one, the prototype author skips
validation design entirely. A shallow design that is honest about being shallow
beats no design at all, so the method has to be able to run cheap.

Validation Architect already has the vocabulary for this: the C0–C4 criticality
model in the audit skill's references, where C0 is experimental with disposable
data, C2 is production with real users and persistent data, and C4 is
safety- or mission-critical. Cormidia's own corpus already runs at `C2`. No new
scale is invented here; the profiles simply attach a turn budget to it.

**D7. `design` takes a profile, and the profile determines either a finite turn
sequence or a finite bounded state machine.**

| Tier | Plain reading | Provider turns | Shape |
| --- | --- | ---: | --- |
| C0 | Experimental; failure is cheap and obvious. | 1 | One Designer turn. No audit — the omission is stated in the output. |
| C1 | Limited or internal use. | 2 | Designer, then one fresh independent Auditor. No feedback relay. |
| C2 | Production; real users, real data. | 4 | Designer draft, Stakeholder challenge, Designer revision, fresh independent Auditor. |
| C3/C4 | High-consequence or safety-critical. | bounded relay | The full Phase 0–8 relay, three fresh readers, two-iteration audit and disposition protocol. |

Deterministic checks — schema, required files, identifiers, provenance, and
cross-artifact closure — run after every artifact-producing turn at every tier.
They are computation, not turns, so they cost nothing and are never skipped.

Three rules keep the cheap tiers honest:

- **Findings surface; they do not trigger repair loops.** At C1–C2 an audit
  produces `clean`, `clean-with-reservations`, or `reservations`, and the
  reservations are visible in the output. C0 records the declared audit
  omission. There is no unbounded fix cycle.
- **A failed run is a failed run.** Missing artifacts, invalid schemas or IDs, a
  failed required turn, or an exhausted budget produce a typed design failure.
  The library does not manufacture a thin corpus to have something to return.
- **Escalation requirements surface; profiles never change silently.**
  Criticality is assessed *during* design, so a C0 run that discovers the
  product handles production customer data reports that its profile was too
  shallow for what it found. It completes within the admitted envelope and says
  so; it does not upgrade itself and spend the caller's budget, and the host may
  not present the result as sufficient for that use.

At C3/C4 the existing relay defaults remain explicit outer bounds rather than
an implicit loop: 60 relay exchanges, 300 wall minutes, three reader turns, at
most two audit iterations, at most 12 stakeholder exchanges per audit feedback
window. A host may tighten any of these. Neither a host nor the library may
read ceiling exhaustion as completion.

## 8. What ships in the package

A package that contains a closure checker and one skill file is not a usable
definition of a method. A consumer holding it cannot design a corpus, cannot
tell which method version produced one, and cannot run the audit that gives the
design its independence. Today's published `files` list is exactly that narrow.

But shipping everything in one package has a cost that only shows up after
measurement. The design campaign is driven through provider SDKs, and those
SDKs carry platform binaries:

| Installed | Size |
| --- | ---: |
| `@openai/codex` platform binary | 310 MB |
| `@anthropic-ai/claude-agent-sdk` platform binary | 245 MB |
| `yaml` — the only thing the deterministic core needs | 1.2 MB |

Both are platform-gated optional dependencies, so a consumer installs one
platform's copy, not all of them. That is still roughly 555 MB.

Now look at how a consumer actually uses this. **Validation Architect is always
a development dependency** — nothing about validation runs in an application's
production process, and the enablement handoff already installs it with
`--save-dev --save-exact`. So the production-versus-development question is not
where the decision lives. The decision lives in *cadence*:

- **Designing** a corpus happens once per product, plus occasional revisions.
  It is an hours-long, token-spending, interactive campaign. Half a gigabyte for
  a once-per-product tool is unremarkable — it is the same weight class as the
  agent CLI the user already installed.
- **Checking** a corpus happens on every pull request, forever, in CI, where the
  install is cold every time. Half a gigabyte to run a deterministic closure
  check is a tax paid on every commit of the product's life.

**D4. Two packages, split by whether code constructs provider clients.**

| Package | Contains | Installed as | Runtime deps |
| --- | --- | --- | --- |
| `validation-architect` | Deterministic functions, provider-neutral `design`/`resume`, port and checkpoint types, core CLI, all schemas, all three skills | Exact-pinned devDependency in an application or dependency of an embedded host | `yaml` |
| `validation-architect-design` | Standalone CLI plus designer/stakeholder/auditor/reader provider adapters and local checkpoint store | Exact-version global install or `npx validation-architect-design@<exact>`, once per product | exact-equal core + provider SDKs |

The rule a user can predict is one sentence: **if code constructs or directly
operates a provider client it is in the design package; deterministic code and
provider-neutral orchestration are in core.** Calling core `design` can still
cause a host's injected `TurnPort` to spend, but the dependency itself carries
no provider SDK, credential, or hidden execution path. That is what makes this
different from today's `validation-trace`-versus-`pnpm vda` split, which is a
fragment of an unpublished whole divided by accident of history.

Two consequences fall out cleanly, which is the sign the boundary is in the
right place. An embedded host installs **only the core package** and injects its
own repository, turn, and checkpoint ports. A CI job that runs `check` on every
PR installs the same SDK-free package and never calls its campaign functions.

The packages are versioned and published in lockstep from this one repository,
and the design package depends on the core at an exact equal version. There is
still exactly one released number, so this does not reintroduce the version
mapping that §9 deletes.

Two binaries, named for what they do:

```bash
validation-architect check .            # the CI gate — closure against real tests
validation-architect plan --changed     # explained plan for the current diff
validation-architect explain <id>       # why this test exists
validation-architect compile .          # validate the corpus, regenerate views
validation-architect report <file>      # ingest runner output, render for a role

validation-architect-design .           # run a campaign
validation-architect-design resume <id>
```

`validation-trace` remains a deprecated alias for `check` through the next
minor, because a live CI workflow and the enablement handoff reference it
today; it is removed at 1.0.

**D5. Ship all three skill directories as data in the core package.** The skills
already live in this repository as its own artifacts, so a skill change is one
ordinary commit that lands with whatever code it belongs with, and it reaches
consumers when — and only when — the package is published. That is the whole
compatibility story, which is why §9 deletes the manifest the previous record
proposed.

All three go in the core package rather than being split across the two. They
total 476 KB, `implement-harness-ticket` is installed into the application
repository's own agent-skill location, and keeping the design and audit skills
alongside the schemas means the core package is the complete, readable
definition of the method. The design package is then only the standalone
provider-backed adapter and CLI — including for a user who wants to run the
design skill by hand in their own agent session rather than through the
campaign.

**D6. The core package's only runtime dependency stays `yaml`.** The provider
SDKs move from devDependencies into the design package's ordinary dependencies,
where `validation-architect-design` works on install with no peer-dependency
resolution for the user to reason about. Optional peer dependencies were
considered and rejected: they would put an npm resolution puzzle in front of the
product's headline capability in order to save install weight that the two-package
split already saves completely.

The SDK dependency is not incidental and cannot be swapped for a subprocess over
an installed agent CLI. The designer's confinement — Read/Grep/Glob workspace-wide,
writes only beneath `validation-design/`, Bash statically confined and denied
fail-closed — is enforced through the SDK's `PreToolUse` hook and `canUseTool`,
after a recorded incident where a prompt-only restriction was violated. Dropping
the SDK would demote an enforced boundary back to a prompt.

The engines floor stays at the lowest Node version the code actually supports.
A validation package that forces a runtime upgrade on its consumers is a
validation package people route around.

## 9. Versioning: one number, plus self-describing files

Every version number a consumer has to reconcile is a chance for two of them to
disagree. The previous design had four — package SemVer, design-skill version,
audit-skill version, and a contract manifest mapping between them — for content
that all lives in one repository and always ships together.

**D8. The package version is the only released identity. Schema IDs carry their
own majors because files outlive installs.**

- The package follows SemVer. Patch is a compatible fix; minor may add
  compatible API fields, schemas, or profiles; a breaking API or schema change
  is a major.
- **A method or prompt change is a version change.** Prompt content is method
  behavior even though it changes no TypeScript signature, so a substantive
  method change is at least a minor and appears in the changelog. This is the
  one thing the single-version scheme must not lose.
- The skills keep `CHANGELOG.md` as readable history. Their separate `VERSION`
  files and the package-to-skill contract manifest are deleted — they tracked
  the same fact as the package version.
- Provenance records the package version, schema IDs, profile, tier, source
  revision, and run identity. The skill version is recoverable from the package
  version, because the tag contains both.
- The library writes only the current schema major. It reads the current and
  immediately previous major, and only to run an explicit `migrate`. A major
  meaning change never happens while reading a corpus.
- Package versions are exact-pinned by consumers. An upgrade is a reviewed
  dependency change, not a range.
- Resume requires the exact package version that began the run.

If the skills are also distributed anywhere else — an agent skill catalog, for
instance — that copy is a downstream mirror of this repository, not a second
authority. Two editable copies of a method is the drift this decision exists to
prevent.

## 10. License

Consumers install this package into repositories and CI systems they do not all
own, so they need unambiguous legal permission to install and execute it. The
package is currently marked `UNLICENSED`, which does not grant that.

**D9. The published package uses SPDX `MIT` and includes the standard notice.**
MIT permits use, copying, modification, and distribution while retaining the
copyright and permission notice, and carries the standard warranty disclaimer
(<https://opensource.org/license/mit>). A proprietary or source-available
license is rejected as needless friction for an interoperability layer.

This licenses the software and documentation distributed in the npm package. It
does not make the private GitHub repository public. The release change must name
the copyright holder in the bundled notice before publication.

## 11. What moved to the Cormidia document

These were in the previous record and are not contract questions. They are one
host's policy, and deciding them here would have baked Cormidia's choices into
an interface everyone else has to implement.

| Moved item | Why it is not contract |
| --- | --- |
| Per-application validation modes and their defaults | A host's product policy about which of its users' apps get a corpus. The library supports greenfield, existing-with-tests, existing-design, and older-method starting points regardless. |
| Criticality elicitation during onboarding | How a host asks its owner a question. The library takes a profile; it does not care how the caller chose it. |
| Provider-turn governance, budgets, approvals, settlement | The contract exposes identity, independence, session, and idempotency requirements through `TurnPort`; Cormidia's specific admission and execution rules remain Cormidia's. |
| Corpus storage, checkpoint implementation, publication path, and state layout | The core defines the checkpoint protocol and returns a bundle. Where a host persists those records and lands the bundle is the host's. |
| Whether Cormidia copies package skills into its org-home `skills/` root | A host integration choice with no bearing on package contents; the package does not redefine the root's generic promoted-skill purpose. |
| `pipelines.yaml` / `prompts/**` consequences | Cormidia's ratified surfaces. |

## 12. Tickets

Both tickets are in `buildstacks-dev/validation-architect`.

- **#16 — the library.** Deterministic core, provider-neutral campaign engine,
  the three ports, all nine entry points, explicit session and independence
  semantics, tier profiles, schemas, provenance, crash-safe resumability, and
  incremental mode.
- **#17 — the packages.** MIT license, the two-package split and its lockstep
  release, package metadata, the two CLI binaries, the complete published file
  sets including the skill directories, release workflow, package smoke tests,
  and the first public publication at `0.3.0`.

`0.3.0` rather than the superseded record's proposed `0.2.0`: the new release
identity names the corrected core/API plus packaging boundary and avoids making
two incompatible designs appear to be the same planned release. Both are
pre-1.0 and carry no compatibility promise.

Sequencing: the license, metadata, and release workflow in #17 can land before
#16. The first publish waits for #16 so the public contract is not born
incomplete. Publication remains a separately approved release action.

## 13. Open questions

1. **Deprecated alias lifetime.** `validation-trace` is kept as an alias for
   `check` through the next minor. If in-flight consumers can absorb the rename
   immediately, it can be dropped at first publish instead.
2. **Design package name.** `validation-architect-design` is descriptive but
   long on the command line. A scoped pair — `@validation-architect/core` and
   `@validation-architect/design` — reads better and reserves the namespace,
   at the cost of renaming the package that already exists on the registry path.
