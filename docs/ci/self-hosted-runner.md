# Self-hosted Core Checks

GitHub Actions remains Cormidia's CI orchestrator and check system of record.
Ordinary internal pull requests and `main` pushes use a disposable Linux ARM64
runner container on the owner's Mac; the workflow never runs on a contributor's
laptop merely because they opened the pull request.

JavaScript actions run on their Node 24-compatible majors, while Cormidia's
install, check, build, and test commands run on Node 26. The CF-HARNESS-CI
policy suite scans every active workflow plus the validation-trace template and
refuses known pre-Node-24 action majors or a project runtime other than Node 26.

## Where a check runs

| Event | Compute | Reason |
|---|---|---|
| Pull request from `cormidia/Cormidia` | Mac runner | Trusted repository branch; ordinary fast path |
| Pull request from a fork | `ubuntu-latest` | Fork code never enters the owner's network boundary |
| Push to `main` | Mac runner | Ordinary post-merge validation |
| Manual dispatch, `compute=self-hosted` | Mac runner | Explicit retry on the normal path |
| Manual dispatch, `compute=github-hosted` | `ubuntu-latest` | Explicit Mac-offline recovery path |
| Release tag, npm publication, provenance, artifacts | `ubuntu-latest` | Release credentials and publication remain on GitHub-hosted compute |

The workflow chooses compute from the event in
`.github/workflows/core-checks.yml`; it is not configured per pull request and
it never runs on the pull-request author's laptop. A self-hosted job runs on
the owner's Mac only while its launchd service is online and advertising the
exact `cormidia-core-linux-arm64` label.

## One-time Mac setup

Prerequisites are Docker Desktop with at least 28 GiB available, an ARM64
engine, Node/pnpm for this repository, and a durable `gh auth login` for a
repository administrator.

```sh
pnpm ci:runner -- build
pnpm ci:runner -- doctor
pnpm ci:runner -- once
pnpm ci:runner -- service-install
pnpm ci:runner -- status
```

`once` is the diagnostic path: it registers one runner, waits for one job,
then exits. `service-install` copies only the runner appliance into
`~/Library/Application Support/Cormidia/ci-runner/app`, writes
`~/Library/LaunchAgents/com.cormidia.github-actions-runner.plist`, and starts a
supervisor that maintains exactly one idle ephemeral runner. Logs live under
`~/Library/Application Support/Cormidia/ci-runner/logs/`; this host-operational
state is deliberately outside every Cormidia org home.

Re-run `build`, `doctor`, and `service-install` after runner appliance pins or
scripts change. `service-install` transactionally replaces only its owned app
copy and launch agent.

## Security boundary

Each job gets a new repository-scoped GitHub registration and a new Docker
container. The image and official GitHub runner archive are digest/checksum
pinned. The container has bounded CPU, memory, and processes; no host mount,
Docker socket, host credential, or persistent workspace; and no effective
capabilities while job code runs. Private, carrier-grade, link-local, and
cloud-metadata IPv4 ranges are rejected before the bootstrap capability is
dropped, and the container run specification disables IPv6. The registration
token is removed before job execution. Completion destroys the container and
deregisters the runner.

Only exact-prefix, exact-label, offline, non-busy runner records are eligible
for cleanup. The manager refuses to register a duplicate while a managed
runner is online.

## Mac-offline recovery

There is intentionally no silent fallback: changing compute providers is a
trust-boundary decision. When the Mac is offline, the self-hosted job stays
queued. Cancel that run, resolve the exact candidate SHA, and dispatch the same
workflow on the candidate branch with the SHA guard and hosted compute:

```sh
SHA="$(git rev-parse <candidate-branch>)"
gh workflow run core-checks.yml \
  --ref <candidate-branch> \
  -f compute=github-hosted \
  -f expected_sha="${SHA}"
```

Both jobs refuse unless `expected_sha` exactly equals GitHub's resolved
`github.sha`, so a branch that moved between inspection and dispatch cannot
produce a false green. For an older `main` candidate no longer named by a
branch, first create a temporary remote branch pointing at that exact commit;
do not dispatch against a newer `main` and merely check out old bytes.

The standalone **Self-hosted runner probe** workflow is manual-only after the
initial cutover proof. It verifies Linux ARM64, an overlay workspace, absent
Docker socket and registration-token environment, zero effective capabilities,
and the installed network guard.

## Cutover evidence (2026-08-11)

All three proof paths ran against commit
`95561cd789da53da895226dd02629e8cd02fffd5`:

- The [final boundary probe](https://github.com/cormidia/Cormidia/actions/runs/31562095184)
  passed in 8 seconds, including the IPv4 guard and IPv6-disable assertions.
- [Core Checks attempts 1 and 2](https://github.com/cormidia/Cormidia/actions/runs/31561452475)
  both passed on independently registered `cormidia-core-linux-arm64` runners.
  Their suite steps took 125 and 126 seconds; their complete core jobs took 220
  and 228 seconds. With two observations, nearest-rank p90 is therefore 126
  seconds for the suite and 228 seconds for the job, both below the ratified
  five-minute target.
- The [exact-SHA hosted fallback](https://github.com/cormidia/Cormidia/actions/runs/31561730803)
  passed on GitHub Actions `ubuntu-latest`. Its suite took 431 seconds and its
  complete core job 504 seconds. This path is retained for recovery, not the
  ordinary internal-PR/main fast path.

The host-side offline suite also passed all 272 files: 2,160 tests passed and
one was intentionally skipped. The first Linux run exposed an unhandled Cursor
handshake `EPIPE`; CF-REG-403 now reproduces that failure deterministically and
pins its typed pre-spend refusal.
