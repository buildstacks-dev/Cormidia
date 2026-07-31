# OPERON-BND-015 — Package registry/distribution ↔ installed package

Status: **Ratified contract — planned product boundary — 2026-07-29**

Traces: J-01, J-03, J-09; OPERON-INV-001, OPERON-INV-003–005,
OPERON-INV-009–010.

## Contract

### 1. Valid input domain

- A package request names an exact version or an explicitly defined release
  channel, a supported host/Node environment, and the intended installation
  scope.
- A distributable release includes mutually compatible binary and Agent Skill
  versions, declared capabilities and schema compatibility, and verifiable
  artifact identity and provenance `[PROPOSED]`.
- An unsigned/unverifiable `[PROPOSED]`, incompatible, incomplete, yanked, or
  identity-mismatched release is invalid.

### 2. Output guarantees

- Successful installation exposes the exact installed package, binary, Agent
  Skill, capability, and compatibility identities.
- Installation does not create, select, upgrade, or mutate an organization
  unless the human separately invokes that lifecycle behavior.
- A product capability is advertised only when the installed release supports
  it; planned package distribution is not reported as currently operational.

### 3. Error and recovery behavior

- Registry, network, authentication, integrity, compatibility, and local-write
  failures are distinct typed outcomes.
- Failed or interrupted installation leaves either the previously valid
  installation or a clearly incomplete, non-runnable candidate; it cannot
  present mixed binary/skill versions as healthy.
- Existing installed operation remains independent of a later registry outage.
- `OPEN — PTF-005:` npm command shape, install/update/rollback policy, supported
  version window, integrity authority, and user-facing recovery promise require
  product ratification.

### 4. Idempotency and retry

- Installing the same immutable artifact identity repeatedly converges on the
  same installed release.
- Retrying an interrupted install validates existing bytes before reuse.
- Rollback, once ratified, selects an exact prior compatible release rather than
  a floating channel.

### 5. Timing, ordering, and freshness

- Artifact publication and visibility are distinct facts; installation reports
  the exact resolved artifact rather than assuming channel freshness.
- Compatibility is checked before activation of a candidate installation.
- Registry metadata cache duration, channel propagation expectations, and
  update-notification policy remain `OPEN — PTF-005`.

## Controlled-seam obligations

Use a local disposable registry/package fixture with immutable artifacts,
checksum/provenance fixtures, version skew, partial downloads, interrupted
activation, incompatible hosts, registry outage, retry, and rollback. Any real
npm proof remains a separately authorized retained live obligation.
