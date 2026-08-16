# Validation harness enablement

This repository currently carries the reviewed `validation-architect` 0.1.1
tarball as an interim, repository-relative development dependency. CI installs
that committed artifact through the frozen lockfile; no registry lookup or
machine-local path is required.

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

4. After `validation-architect@0.3.0` is actually published, replace the
   interim tarball with the exact registry pin and remove the superseded vendor
   artifact in one reviewed change. Publication, tagging, and registry actions
   are outside this enablement procedure and require separate human approval.

`validation-trace` proves deterministic closure only. Fidelity remains a separate architect audit. A live outcome-acceptance (`L-ACC`) campaign is never implied by installation or CI: it still requires fresh human authorization for its target, scenario set, spend/time ceiling, and permitted effects.
