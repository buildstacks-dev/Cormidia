# TypeScript Engineering Standards — extracted from the `pi` golden repository

**Purpose.** Drop-in system prompt / skill for AI coding agents working on Cormidia or
any new TypeScript project. Every rule below is extracted from forensic analysis of
`pi` (earendil-works, 2026-08-05 snapshot: 483 src files, 109,459 lines, median file
82 lines, median function 11 lines, 1 TODO marker in the entire tree). Rules are
stated as constraints, not suggestions. A 1000-line solution that could be 300 lines
is a defect.

---

## 1. System Instructions for Code Generation

- **Do** read files in full before wide-ranging changes, before editing files you have
  not fully inspected, and when auditing. **Never** rely on search snippets for broad
  changes.
- **Do** answer the user's question first, then edit. **Never** bury the answer under
  implementation activity.
- **Do** check `node_modules` for external API types. **Never** guess a dependency's
  API shape.
- **Do** ask before removing functionality that appears intentional. **Never**
  preserve backward compatibility unless explicitly asked — delete the old path.
- **Do** fix type errors from outdated deps by upgrading the dep. **Never** remove or
  downgrade code to silence them.
- **Do** write technical prose only. **Never** use emojis or cheerful filler in code,
  commits, issues, or PR comments.
- **Do** finish work or file an issue. **Never** leave `TODO`/`FIXME`/`HACK` markers
  in committed code (pi: 1 marker per 111k lines).

## 2. Code Style & Conciseness

**The gate is public-symbol count; line count is the smoke alarm.** A module is bad
because it exports too much, not because it is long: pi's 1,351-line provider module
is fine at 2 exported values; a 500-line module with 30 exports is not.

**Enforced budgets** (one number each — do not maintain competing thresholds):

| Metric | Budget |
|---|---|
| New module | **≤10 exports and ≤300 lines.** Hard; override only with a named justification in the PR body |
| Existing modules | Frozen at their recorded baseline — may shrink or hold, never grow, on either metric |
| Function body | >50 lines: justify |
| Commit | ~7 files, ±250 lines; adds ≈ deletes over time (net-zero growth) |

pi's measured distribution (median file 82 lines, 55% ≤100; median function 11
lines, p90 46) is the gravity these budgets pull toward — calibration context, not
a second set of gates.

- **Do** keep ~60% of top-level functions unexported (pi: 1160 private vs 847
  exported). A module's public surface is its contract; everything else stays
  file-local.
- **Do** inline single-line helpers that have only one call site. **Never** extract a
  helper "for readability" that is called once and adds a name to learn.
- **Do** define state-capturing helpers as `const` arrow closures *inside* the
  function that uses them (pi `bash.ts`: `emitOutputUpdate`, `clearUpdateTimer` close
  over local state). **Do** use file-local `function` declarations for module-private
  helpers. **Never** export a helper so a test can reach it — test through the public
  surface or inject a seam.
- **Do** let one file carry a whole cohesive subsystem (pi: the entire wire protocol —
  every schema, type, and version constant — is one 445-line `schemas.ts`; per-path
  write serialization is a 56-line module with a module-level `WeakMap`, no class).
  **Never** shard cohesive logic across files for "organization."
- **Comments explain why, never what.** Cite sources with URLs when encoding external
  facts ("SDK 0.91.1 omits the field from its Usage type, so read it through a narrow
  cast. Verified against the live API."). **Never** write a comment that restates the
  next line, narrates your edit, or addresses the reviewer.
- **JSDoc is one line and semantic.** Every field of a public options interface gets a
  one-line doc including its default. **Never** write `@param`/`@returns` boilerplate
  that restates the signature (pi: 2,106 JSDoc blocks, only 101 `@param` total).
- **Do** state behavioral contracts in prose on the type, once ("Contract: must not
  throw or reject. Return a safe fallback value instead."). This is what lets call
  sites skip defensive code.
- Formatter owns layout: run it, obey it, never hand-format. (pi: Biome, tabs,
  `lineWidth: 120`, `--error-on-warnings` — warnings are errors.)

## 3. Type Safety Rules

**tsconfig floor** (pi `tsconfig.base.json`): `strict: true`,
`erasableSyntaxOnly: true`, `forceConsistentCasingInFileNames: true`,
`skipLibCheck: true`, explicit `target`/`module`/`lib`.

- **Never** use `enum`, `namespace`, parameter properties, `import =`/`export =`
  (structurally banned by `erasableSyntaxOnly`; code must run under Node type
  stripping). Use string-literal unions and explicit constructor field assignment.
- **`type` for anything algebraic** (unions, function types, mapped types, derived
  shapes). **`interface` for open object shapes and capability contracts**
  (`FileSystem`, `Shell`). Never an interface for a union wrapper; never a `type` where
  declaration merging is the point.
- **Discriminated unions are the default data model.** Discriminant field: `type` for
  events/content, `role` for messages, `kind`/`status`/`command` where domain-natural,
  `_tag` for tagged errors. Narrow with `Extract<Union, { type: T }>`.
- **Derive, never duplicate.** Build variant types with `Omit`/`Pick`/`Extract`/
  `Partial` from one source type. Two hand-maintained near-identical shapes is a
  defect.
- **Open string unions** for extensible IDs: `type Api = KnownApi | (string & {})` —
  keeps autocomplete without closing the set.
- **Schema is the type.** For anything validated at runtime (tool params, wire
  messages, settings): define one typebox/zod schema, derive the TS type via
  `Static<typeof schema>`. **Never** maintain a DTO + validator + type triplet.
  Descriptions live in the schema so the model-facing JSON schema is free.
- **`unknown` at every boundary; `any` only in erased generic positions.** pi:
  `unknown` 644 uses vs bare `: any` annotations 22 — and those are `Model<any>`-style
  variance escapes, not lazy typing. Parse `unknown` with type-guard functions
  (`(v): v is X`).
- **Zero `@ts-ignore` / `@ts-expect-error`.** If the compiler disagrees, the types are
  wrong — fix them.
- **`satisfies` over `as`** for literal conformance (`{...} satisfies AnthropicOptions`).
  Every remaining `as` cast carries an inline comment justifying it against a verified
  external fact. Naked casts are defects.
- **Type-level dispatch replaces class polymorphism.** Per-variant behavior shapes are
  conditional types (`Model<TApi>["compat"]`) plus boolean capability flags resolved in
  one small function — zero subclasses, zero runtime cost.

## 4. Error Handling & Async

Three strategies, each scoped to a layer — pick one per boundary, never mix ad hoc:

1. **`Result<T, E> = { ok: true; value } | { ok: false; error }`** at boundaries whose
   contract is "never throws" (filesystem/shell seams). Document the invariant on the
   interface once. Helpers stay 3 lines (`ok`, `err`, `getOrThrow`). Convert back to
   exceptions at the consumer's boundary with `getOrThrow`.
2. **`Error` subclasses with a stable `code` field** typed as a string-literal union,
   for domain errors callers branch on. Constructor is 6 lines; pass `{ cause }`.
   Hierarchies stay ≤2 levels.
3. **Streams/event pipelines encode failure as data.** Once a stream is returned,
   errors become `{ type: "error", ... }` events, never throws — one outermost
   `try/catch` per run converts the exception into the normal event sequence so
   consumers have exactly one code path.

- `try/catch` lives at IO/protocol seams only, never sprinkled per-call.
  `try/finally` (no catch) for resource release. Bare `catch {}` only for
  expected-miss paths (stat on maybe-missing file), never to silence bugs.
- Bound error text at trust boundaries (truncate messages); latch decoders into a
  `failed` state so poisoned streams can't resume.
- **Thread `AbortSignal`; rarely create one** (pi: 267 signal uses, 32 controllers).
  Signals are parameters on every long-running operation; check
  `signal?.aborted` cooperatively at await boundaries; use `throwIfAborted()` in
  sequential flows. Shared utilities (`combineAbortSignals`, `raceWithAbortSignal`)
  are ~50 lines total — never rebuild them per call site.

## 5. Structure: Files, Modules, Classes, Exports

- **Classes are for exactly four things:** (1) stateful long-lived objects (`Agent`,
  `SessionManager`), (2) UI components implementing one shared interface, (3) `Error`
  subclasses, (4) incremental decoders/buffers. Everything else is functions + object
  literals.
- **Inheritance ≤1 level** outside UI component trees; abstract classes near-zero
  (pi: 2 in the repo). **Never** design a base-class plugin system — use a uniform
  module-shape contract instead ("every module under `src/api/` exports `stream` and
  `streamSimple`; the module itself satisfies the interface").
- **Pluggable things are factory functions returning object literals**
  (`createBashTool(...)`), registered via a plain `switch` or map — **never** a
  registry framework, decorator, or DI container.
- **Dependency injection is an options object of values and callbacks** with `??`
  defaults in the constructor. Test seams are small `Operations` interfaces with a
  4-line default implementation, injected via `options?.operations`.
- **Every stateful manager ships an `.inMemory()` constructor** — this single
  convention is what makes hermetic testing cheap.
- **Named exports only.** `export default` only when an external contract forces it
  (pi: 2 in the whole tree).
- **Barrels:** leaf packages `export *`; public-API packages enumerate explicitly
  with `// section` comments and a header documenting what is *deliberately excluded*
  ("Core only, side-effect free: no provider factories, no OAuth"). Sub-barrels stay
  ~20 lines. Package `exports` maps use wildcard subpaths (`"./providers/*"`) for file
  families instead of per-file entries.
- **Top-level imports only.** No `await import()`, no `import("pkg").Type` — dynamic
  import is allowed solely inside one deliberate lazy-loading layer (4-line `.lazy.ts`
  shims) built for tree-shaking, not convenience.
- Relative imports carry explicit source extensions, enforced by a check script.
  `import type` for type-only imports.
- **Tests live in per-package `test/` (or repo `tests/`), never co-located.** Names:
  `<feature>.test.ts`; issue regressions: `regressions/<issue-number>-<slug>.test.ts`.
  Paid/model-backed evals are `.eval.ts` in a separate package, run only by explicit
  command, never in CI's test path.

## 6. Dependency, Tooling & Process Rules

- **Exact-pin every external dependency** (no `^`/`~`), machine-enforced by a check
  script in the main gate. Internal workspace deps may range. Treat dep and lockfile
  diffs as reviewed code; read the changelog of security-sensitive deps before
  bumping.
- **Dependencies are minimal and boring.** pi's core `agent` package: 5 deps. Adding
  a dependency is a decision with a rationale, never a convenience.
- **Install with `--ignore-scripts` everywhere** (dev, CI, docs). Lifecycle scripts
  require review and an explicit allowlist entry.
- **One `check` command is the gate:** format + lint (warnings are errors) +
  typecheck + repo-invariant scripts (pinned deps, import style, lockfile
  consistency). Pre-commit runs it. CI is one short workflow: install → build →
  check → test, with SHA-pinned actions.
- **Repo invariants become ~50-line check scripts** wired into `check`, not review
  checklist items. If a rule matters, a script enforces it.
- **Tests are hermetic by construction:** run under an isolated empty environment
  (throwaway HOME, no API keys, `TZ=UTC`); LLM calls go through a first-class faux
  provider with scripted responses and tiny message factories (`fauxText(...)`,
  `fauxToolCall(...)`). **Never** call a real provider API in tests.
- **Commits:** `{feat,fix,docs,refactor,chore}(scope): imperative summary`. Stage
  explicit paths only — never `git add -A`/`.`. Never commit unless asked. Include
  `closes #N` per issue (keyword repeated per issue number).
- **Changelogs:** per-package `CHANGELOG.md`, append under `[Unreleased]`
  (Breaking/Added/Changed/Fixed/Removed); released sections are immutable.
- **Releases:** lockstep versions, patch/minor only; local out-of-repo smoke test
  before tagging; tag push triggers CI publish via OIDC trusted publishing — no local
  `npm publish` ever.
- **Every bug fix deposits its regression test in the same change**, named after the
  issue.

## 7. Hard "Never Do This" List (LLM failure modes)

1. **Never create an interface with a single class implementation** (`IFoo` +
   `FooImpl`). Export the concrete class; inject function seams for testing.
2. **Never wrap a vendor SDK in a client/adapter class.** Import its types directly
   and build its param shapes literally; if an alternate client must be swappable,
   accept it as one option field (`client?: Anthropic`).
3. **Never introduce a factory, registry, builder, or DI framework** where a plain
   function, `switch`, or object map suffices.
4. **Never write a DTO + validator + type for the same data.** One schema, one
   derived type.
5. **Never re-validate data that is already typed** inside the system. Validate
   `unknown` once at the boundary; trust types inward.
6. **Never split a cohesive subsystem into many small files** or helper modules for
   "clean architecture." Count public symbols, not lines.
7. **Never extract single-use helpers**, constants files, or `utils.ts` dumping
   grounds. Inline it or keep it file-local.
8. **Never add speculative extensibility** — hook points, plugin slots, config
   options nobody asked for. Extension points are designed, discussed features.
9. **Never leave *permanent* backward-compat shims, re-export aliases, or
   deprecated paths** unless explicitly requested. A temporary barrel at the old
   path during an approved decomposition is fine — with a removal ticket filed in
   the same change.
10. **Never use `enum`, `namespace`, parameter properties, or default exports.**
11. **Never use `@ts-ignore`/`@ts-expect-error`**, naked `as` casts, or `any` outside
    erased generic positions.
12. **Never weaken a gate, test, or golden set to make a change pass.** Extend cases;
    never soften one.
13. **Never call real model/provider APIs in tests**; never let evals into the CI
    test path.
14. **Never hardcode a value that belongs in the project's config/defaults table**
    (keybindings, model IDs, branch names) — add to the table so it stays
    configurable.
15. **Never write filler prose in code artifacts**: no emoji, no "This function is
    responsible for…", no apology comments, no restating the diff in comments.

---

*Injection guidance: place this file's rules in the agent's system prompt or project
AGENTS.md/CLAUDE.md. Rules 2 (budgets), 3 (types), 5 (structure), and 7 (never-list)
are the highest-leverage sections for preventing bloat; enforcement scripts (§6) are
what make the rest stick without review effort.*
