# Validation harness enablement

This repository carries the reviewed `validation-architect` 0.4.2 tarball
built byte-identically from upstream squash revision
`40a275038b81d624166ffcfa963453237173c8cd` as an interim,
repository-relative development dependency. CI installs that committed
artifact through the frozen lockfile; no registry lookup or machine-local path
is required.

1. Install the exact committed dependency graph:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Run the repository-owned closure command:

   ```bash
   pnpm validation:trace
   ```

3. Keep `.github/workflows/validation-trace.yml` and Core Checks on that same
   package script. The command must remain fail-closed for a missing package,
   manifest, tests root, invalid schema, or any closure finding.

   Before the checked-model cutover, zero files under
   `validation-design/model/` selects 0.4.2's bounded legacy-manifest bridge.
   The presence of any checked-model file selects checked-model authority;
   partial or corrupt model input fails and cannot fall back to the legacy
   manifest.

4. When these exact reviewed 0.4.2 bytes are separately published, #431 Part C
   replaces the interim tarball with the exact registry pin and removes the
   superseded vendor artifact in one reviewed change. Publication, tagging,
   registry actions, and the replacement itself are outside this enablement
   procedure and require their own authority.

`validation-trace` proves deterministic closure only. Fidelity remains a separate architect audit. A live outcome-acceptance (`L-ACC`) campaign is never implied by installation or CI: it still requires fresh human authorization for its target, scenario set, spend/time ceiling, and permitted effects.
