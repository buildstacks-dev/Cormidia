# ISSUE-029 — which pnpm 11 knob actually prevents the `allowBuilds` placeholder

Date: 2026-07-21 UTC
Candidate base: `2521136` (`codex/run4-issue029`)
pnpm under test: 11.10.0 (corepack), Node v26.4.0

ISSUE-017 was closed by `951509f fix(runtime): make provider sandboxes
non-interactive`. ISSUE-029 is its unfixed remainder: a non-interactive sandbox
stops pnpm from *prompting*, and pnpm 11 does not prompt — when it has no build
decision for a dependency and cannot ask, it **writes the question into the
repo**. Everything below was measured against the installed pnpm, not inferred.

## The write, in pnpm's own code

`pnpm.mjs` → `../installing/commands/lib/handleIgnoredBuilds.js`:

```js
async function handleIgnoredBuilds(opts, ignoredBuilds) {
  if (!ignoredBuilds?.size) return;
  if (!opts.ignoreWorkspace) await writeIgnoredBuildsToAllowBuilds(opts, ignoredBuilds);
  if (opts.strictDepBuilds) throw new IgnoredBuildsError(ignoredBuilds);
}

async function writeIgnoredBuildsToAllowBuilds(opts, ignoredBuilds) {
  for (const name of packageNamesFromIgnoredBuilds(ignoredBuilds)) {
    if (opts.allowBuilds?.[name] == null) newEntries[name] = "set this to true or false";
  }
  …writeSettings({ updatedSettings: { allowBuilds: { ...opts.allowBuilds, ...newEntries } } });
}
```

and `../building/…/buildModules`, which decides what lands in `ignoredBuilds`:

```js
let ignoreScripts = Boolean(buildDepOpts.ignoreScripts);
if (!ignoreScripts) {
  if (node.requiresBuild) {
    switch (allowBuild(node.depPath)) {
      case false: ignoreScripts = true; break;                      // decided: denied
      case void 0: ignoredBuilds.add(node.depPath); ignoreScripts = true; break;  // undecided
    }
  }
}
```

`ignoredBuilds` is populated only on the **undecided** branch, and only when
`ignoreScripts` is false. That is the whole causal chain, and it is why
`strictDepBuilds` is not a fix: it throws *after* the write.

## Knobs tested

Fixture: a temp project depending on a local tarball with a `postinstall`, so
every run is offline and needs no registry.

| Setting | Placeholder written? | Install exit |
| --- | --- | --- |
| (none, `CI=true`) | **yes** | 1 |
| `npm_config_ignore_scripts=true` | yes | 1 |
| `NPM_CONFIG_IGNORE_SCRIPTS=true` | yes | 1 |
| `PNPM_IGNORE_SCRIPTS=true` | yes | 1 |
| `PNPM_CONFIG_IGNORE_SCRIPTS=true` | **no** | 0 |
| `pnpm install --ignore-scripts` | no | 0 |

**pnpm 11 ignores `npm_config_*` entirely.** Its env-config prefix is
`pnpm_config_` / `PNPM_CONFIG_` (`getEnvKeySuffix`, `../config/reader/lib/env.js`).
Confirmed directly:

```console
$ npm_config_registry=https://example.test/ pnpm config get registry
https://registry.npmjs.org/
$ PNPM_CONFIG_REGISTRY=https://example.test/ pnpm config get registry
https://example.test/
$ PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm config get ignore-scripts
true
```

This matters beyond this ticket: `NPM_CONFIG_YES` in the existing overlay
carries no pnpm policy at all, and any future pnpm setting written with an
`NPM_CONFIG_` prefix would ship inert.

## Why `PNPM_CONFIG_IGNORE_SCRIPTS`, and not `allowBuilds` or `dangerouslyAllowAllBuilds`

- Pre-seeding `allowBuilds` requires knowing the package names in advance. There
  is no wildcard: `createAllowBuildFunction` matches exact names/specs only.
  A *new* dependency with a build script re-opens the hole.
- `dangerouslyAllowAllBuilds` prevents the placeholder by allowing everything.
  That is the dangerous direction — a package silently running an install script
  is the worse default — so it is explicitly not used.
- `--ignore-workspace` suppresses the write but changes install semantics and
  discards the settings file the opt-in would live in.
- `ignore-scripts` denies, is one env var, needs no per-package knowledge, and
  short-circuits the undecided branch so nothing is ever written.

## It does not make the gates vacuous

The obvious hazard with a global `ignore-scripts` is a `pnpm test` that silently
does nothing and a gate that passes for free. It does not:

```console
$ CI=true PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm test
$ node -e "console.log(…)"
TEST-RAN
$ CI=true PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm run test
TEST-RAN
```

Only lifecycle and dependency install scripts are skipped; an explicitly named
script still runs.

## Opt-in

A CLI flag beats env config, so a ticket that genuinely needs a dependency built
opts in through the app's `setup_command`:
`pnpm install --frozen-lockfile --no-ignore-scripts`, alongside a committed
`allowBuilds` decision. That path can still reach the placeholder writer for a
package the committed decision does not cover — measured, not assumed:

```console
$ CI=true PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm install --offline --no-ignore-scripts
[ERR_PNPM_IGNORED_BUILDS] …
$ cat pnpm-workspace.yaml
allowBuilds:
  buildy: true
  buildy@file:../buildy-1.0.0.tgz: set this to true or false
```

which is why `src/loop/setup-artifacts.ts` exists as a backstop rather than the
prevention being treated as complete on its own.

## End-to-end, through the real gate

The same install that writes the placeholder and exits 1 without the policy,
driven through the real `runSetupGate`:

```console
gate: pass | setup passed (exit 0)
workspace file written: false
```

Control, identical tree without the policy: `exit=1`, and

```yaml
allowBuilds:
  buildy@file:../buildy-1.0.0.tgz: set this to true or false
```

No provider turn, no network, no org state was used for any of the above.
