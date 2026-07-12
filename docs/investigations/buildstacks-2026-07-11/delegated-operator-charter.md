# Delegated-operator charter design

## Canonical source

Each org owns one human-ratified, versioned `AUTHORITY.md` at its org root.
It has machine-readable frontmatter:

```yaml
schema_version: 1
kind: operon-org-authority
profile: delegated-operator
version: delegated-operator/v1
```

The body defines automatic ordinary actions and hard escalation boundaries.
Its byte-level SHA-256 is the run provenance key. A custom profile also records
`granted_by`, supplied through the required `--authority-by` argument.

App onboarding creates `.operon/AUTHORITY.md`: a session-readable projection
whose structured frontmatter selects inherit/conservative/custom restrictions.
The org document remains the only grant source.

## Profiles

### Conservative

Automatic: read-only inspection, local analysis, and dry-run planning. Ask
before edits, billable model work, branches, issues, or PR preparation unless
the current human task explicitly grants them.

### Delegated operator

Default language:

> You are my delegated operator. Make ordinary, reversible decisions
> independently and continue until the defined outcome is genuinely complete.
> Do not pause for routine workflow choices, ordinary token cost, local edits,
> tests, branches, tickets, or normal PR preparation. Escalate only for
> publication or deployment, secrets, cloud/DNS/infrastructure changes,
> irreversible data loss, merging when human merge is required, or a genuinely
> material product decision.

### Custom

The human supplies a charter file plus an attributable identity. Operon wraps
the custom prose with fixed non-bypassable boundaries and records the resulting
source/version/hash.

`operon org init` previews the selected profile in two lists: automatic and
human-gated. Delegated-operator is the default for new interactive and
non-interactive orgs. Pre-feature orgs do not inherit that default: without a
canonical file they resolve to `legacy-conservative/v1`.

## Resolution and narrowing

Authority resolves in this order:

1. canonical org charter;
2. app restrictions;
3. current human task instructions;
4. non-bypassable critical-operation policy.

Layers 2 and 3 may only remove actions or add escalation conditions. A broader
grant requires a new attributable human instruction or a new ratified charter
version. Models never infer permission from silence, previous sessions, or a
more permissive app file.

The resolver emits the effective text plus profile/source/version/hash.
Onboarding renders the automatic and gated preview. App custom restrictions
accept only narrowing statements beginning with `Ask before`, `Do not`,
`Never`, `Require human approval before`, or `Limit`; grant/bypass language is
rejected. A stale app snapshot fails closed to a conservative effective
charter.

## Harness composition

Role turns receive the effective charter through the existing native channels:
Codex developer instructions, Claude SDK system-prompt append, and Pi system
append. Every executable `brief.md` includes a compact `[authority]` section
with profile/source/version/hash; full prose remains in the native channel.
The reserved offline learning-replay namespace keeps independently validated
fixture briefs byte-exact; it still receives authority in native context and
records authority on the envelope.

Top-level sessions need project instruction projections. On org/app onboarding,
Operon manages a clearly delimited derived block in `AGENTS.md` and
`CLAUDE.md`. It never overwrites existing content. The block contains the
effective charter projection, canonical source path, version, and hash.
Re-running composition is idempotent; bytes outside the markers are preserved.
Malformed or duplicate markers fail before project-instruction writes.

Generated instruction blocks are projections, not additional authority
sources. The canonical org `AUTHORITY.md` remains the only grant; app policy
and task instructions only narrow it.

## Envelope and safety contract

Every updated run envelope stores:

```json
{
  "authority": {
    "sources": ["/org/AUTHORITY.md", "/app/.operon/AUTHORITY.md"],
    "version": "delegated-operator/v1+app-inherit/v1",
    "profile": "delegated-operator",
    "sha256": "..."
  }
}
```

Parent delegated-task records capture the same evidence at `operon task begin`.
Historical and deliberately low-level run fixtures may lack it and render as
legacy/unrecorded; production role context always resolves it first.

The authority resolver cannot modify `defaultGate`, approval scopes, release
policy, or adapter tool shaping. A charter is context and provenance, never a
gate bypass. Tests prove that external publication remains denied under the
broadest profile.

## Implemented contract

The implementation lives in `src/org/authority.ts`, `src/org/home.ts`,
`src/org/bootstrap.ts`, `src/org/context.ts`, and the run-envelope/task paths.
Focused coverage is in `test/authority.test.ts`, the onboarding tests, and the
pipeline envelope tests. The associated commit is recorded in
`implementation-plan.md` after the slice lands.
