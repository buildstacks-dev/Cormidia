# Example: Local Developer Tool

## Scenario

A command-line tool rewrites project configuration and source files on a developer laptop. It is intended for one user, but it may run inside real repositories and can invoke package managers.

## Criticality profile

- System level: `C1 Limited`.
- High-risk components:
  - File replacement and deletion: `C2` if it can destroy uncommitted work.
  - Shell command execution: `C2` if commands are generated from untrusted input.
  - Credential access: `C2` or `C3` if production credentials are reachable.
- Change criticality:
  - Help-text edit: `L0`.
  - New rewrite rule: `L1` or `L2`.
  - New recursive deletion or shell execution: `L3`.

## Assurance target

> Sufficient evidence for single-user local use on real but version-controlled repositories, without production credentials, with preview and recovery controls enabled.

## Important claims

- The tool never modifies files outside the selected repository.
- `--dry-run` accurately previews the real change.
- A failed or interrupted rewrite does not leave partial corruption.
- Existing user changes are preserved or the tool refuses safely.
- Re-running the same operation is idempotent.
- Paths, symlinks, permissions, and unusual filenames cannot escape the boundary.
- Generated subprocess commands are constrained and quoted safely.
- The user can recover the original files.

## Proportionate validation plan

- Clean build, lint, type check, and unit tests.
- Temporary-repository integration tests.
- Dirty-tree, untracked-file, symlink, path traversal, permission, disk-full, and interruption cases.
- Cross-platform tests for claimed platforms.
- Property tests for path normalization and rewrite idempotency.
- Mutation testing for destructive-operation guards.
- Package installation and invocation in an empty environment.
- Secret and network-egress inspection.
- One end-to-end run on a representative fixture repository.

## What is probably unnecessary

Absent additional risk:

- Multi-region disaster recovery.
- Large-scale load testing.
- Hardware-in-the-loop.
- Formal proof of the entire system.

## Verdict example

> Evidence is sufficient for the stated single-user local target on macOS and Linux. Windows behavior is not verified. Use with production credentials or outside version-controlled repositories is excluded.
