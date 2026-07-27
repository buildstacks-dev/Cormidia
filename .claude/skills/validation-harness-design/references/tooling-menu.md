# Tooling Menu

Read during Phase 7. Present options per layer with the tradeoffs that actually differ — not a feature matrix. The human selects; record rejected options and reasons in the policy file, because the reasons are what make a future revisit cheap.

**Module scope:** the parent product's existing stack is the default. Divergence must be justified — a second runner or a second eval framework doubles the CI surface a future audit has to reason about, and halves the chance anyone maintains either.

## Layer 1 — Unit / contract runner

| Option | Fits when | Cost |
|---|---|---|
| `pytest` | Python codebase; rich fixture and parametrization needs | Fixture magic gets opaque at scale |
| `vitest` / `jest` | TS/JS codebase; vitest for ESM-native and speed | Ecosystem churn |
| `go test` / `cargo test` | Language-native, no dependency | Fewer batteries for property testing |

Add a **property-based** layer (Hypothesis, fast-check) wherever invariants are numeric, ordering-based, or conservation-based — property tests are the natural expression of an invariant, and one property test replaces dozens of examples.

## Layer 2 — Integration and fixtures

- **Real dependencies in containers** (Testcontainers or equivalent): highest fidelity, catches version skew and real timeout behavior. Default for T2+ where a boundary is a real database, queue, or service.
- **In-process fakes** you own: fast and deterministic, but they encode your assumptions — they cannot catch a contract mismatch, only a regression against your belief about the contract.
- **Recorded interactions** (VCR-style cassettes) for external vendors: good for shape, silently stale when the vendor changes. Pair with a low-frequency live smoke test or the staleness is invisible.
- **Contract tests** (Pact-style) where two teams or two services evolve independently — overkill for a solo-maintained module, valuable across an org boundary.

Rule of thumb: mock **across** boundaries, never **inside** them. Mocking inside a boundary tests your mocks.

## Layer 3 — Journey / end-to-end

- **Playwright** for browser journeys; strongest tracing and debugging story.
- **API-level journey tests** where there's no UI — usually the right answer for backend and agentic products, and far cheaper to keep green.
- Keep the count small and behavior-level. E2E suites rot in proportion to their size; the walking skeleton needs exactly one.

## Layer 4 — LLM evals

| Option | Fits when | Cost |
|---|---|---|
| Hand-rolled runner over a golden-set directory + CI job | Small number of call sites; full control of format; no vendor lock | You build reporting and trend tracking yourself |
| `promptfoo` | Config-driven eval matrices, quick model comparison, local-first | Opinionated config; less flexible for trajectory scoring |
| Hosted eval platforms (Braintrust, LangSmith, Langfuse) | Teams needing shared dashboards, trend history, dataset curation UI | Data leaves the box; recurring cost; another auth surface |

Whatever is chosen, the **golden set is plain files in Git**, not locked inside a vendor's dataset store. The set is the model-swap regression suite and must outlive any tool choice.

For **trajectory evals**, start with deterministic assertions over run telemetry (tool calls legal, budget respected, no loops, escalation fired) in the Layer 1 runner. Reach for a tracing platform (OTel GenAI conventions, Langfuse, Phoenix) only when span-level debugging is the actual bottleneck.

## Layer 5 — CI host and cost tiering

Whatever the repo already uses. What matters is not the host but that the tiering from Phase 5 is encoded there and in the policy file:

- **Per commit:** unit, integration, LLM contract layer. Must be fast enough that nobody skips it — set the wall-clock budget explicitly.
- **On prompt/model change + nightly:** LLM quality evals.
- **On judge change:** judge meta-evals.
- **Pre-release:** full journey suite, scale test at the contention point.

Encode the trigger conditions in the policy file, not only in CI config — otherwise "saving CI minutes" silently removes a gate and nothing records that it happened.

## Selection heuristics

1. **Boring and already installed beats better and new.** A harness only pays off if it's still running in six months.
2. **One runner per language, one eval framework per product.** Consolidate before optimizing.
3. **Optimize the per-commit tier for speed, everything else for fidelity.** These are different goals and want different tools.
4. **Anything that can't run locally will eventually only be run by CI, and then only by whoever is on call.** Weight local ergonomics heavily.
