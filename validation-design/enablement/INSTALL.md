# Validation harness enablement

This repository carries the reviewed `validation-architect` 0.4.6 tarball
built byte-identically from upstream squash revision
`52a7b26b5b4de934612640c3d47ba7c738596ece` as an interim,
repository-relative development dependency. CI installs that committed
artifact through the frozen lockfile; no registry lookup or machine-local path
is required.

1. Install the exact committed dependency graph:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Regenerate the five Markdown views and canonical compiler report after any
   checked-model edit, using the public compiler:

   ```bash
   pnpm exec validation-architect compile . --write
   ```

   Never hand-edit `case-catalog.md`, `harness-backlog.md`,
   `owner-briefing.md`, `owner-backlog.md`, `planned-trace.md`, or
   `compiler-report.json`.

3. Run the repository-owned closure command:

   ```bash
   pnpm validation:trace
   ```

4. Keep `.github/workflows/validation-trace.yml` and Core Checks on that same
   package script. The command must remain fail-closed for a missing package,
   any of the eight model files, generated view/report drift, tests root,
   invalid schema, or any closure finding.

   The presence of any checked-model file selects checked-model authority.
   Partial or corrupt model input fails and cannot fall back to a root legacy
   file or `validation-design/migration/`. The package
   selects 0.4.6's bounded legacy-manifest bridge only for the zero-model
   pre-cutover parent revision; it is rollback-by-revert behavior, not a
   current operating mode.

5. When these exact reviewed 0.4.6 bytes are separately published, #431 Part C
   replaces the interim tarball with the exact registry pin and removes the
   superseded vendor artifact in one reviewed change. Publication, tagging,
   registry actions, and the replacement itself are outside this enablement
   procedure and require their own authority.

`validation-trace` proves deterministic closure only.
Fidelity remains a separate architect audit. `validation-design/model/*.yaml`
is the Validation Architect authority; `docs/qualification/host-policy.yaml` separately owns
Cormidia's exact qualification/campaign facts, and the two compose
tighten-only. `validation-design/migration/` is history-only. A live
outcome-acceptance (`L-ACC`) campaign is never implied by installation or CI:
it still requires fresh human authorization for its target, scenario set,
spend/time ceiling, and permitted effects.
