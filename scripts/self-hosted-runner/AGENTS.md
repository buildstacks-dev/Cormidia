# Self-hosted Core Checks runner

Scope: this directory only. It is developer infrastructure and is never part of
the published `cormidia` package.

Security invariants:

- Use only the official checksum-pinned GitHub Actions runner archive and a
  digest-pinned base image.
- Registration is repository-scoped, one-job, and ephemeral. The container
  receives only the short-lived registration token; host GitHub credentials
  never enter it.
- Job containers are disposable and non-privileged. Never add host mounts,
  the Docker socket, host networking, host credentials, or application secrets.
- `NET_ADMIN` exists only long enough for the root entrypoint to reject private
  and link-local egress. The runner and all job descendants execute as uid 1001
  with an empty capability bounding set and `no-new-privileges`.
- Keep release and publication workflows on GitHub-hosted runners.
- Any change to image pins, isolation, labels, registration, cleanup, routing,
  or fallback behavior updates `CF-HARNESS-CI` tests and the validation-policy
  contract in the same change. Every detector keeps a seeded negative control.
