# Delegated-operator charter design

## Canonical source

Each org owns one human-ratified, versioned `AUTHORITY.md` at its org root.
It has machine-readable frontmatter:

```yaml
schema_version: 1
charter_version: delegated-operator/v1
profile: delegated-operator
ratified_by: <human identity>
ratified_at: <ISO timestamp>
```

The body defines automatic ordinary actions and hard escalation boundaries.
Its normalized SHA-256 is the run provenance key. App onboarding may create
`.operon/authority.yaml` containing restrictions only; it cannot restate or
expand the grant.

## Profiles

### Conservative

Automatic: read-only inspection, local analysis, and explicitly requested
edits/tests. Ask before branches, issues, PRs, network use, or meaningful spend.

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

The human supplies a charter file. Operon validates that required critical-op
gates remain present and records the source identity/hash.

`operon org init` previews the selected profile in two lists: automatic and
human-gated. Non-interactive initialization requires an explicit profile;
interactive initialization may recommend delegated-operator but must record
the human selection.

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

The resolver emits the exact effective text plus source/version/hash and a
machine-readable allow/escalate summary. A monotonic narrowing validator rejects
an app file that attempts to add authority.

## Harness composition

Role turns receive the effective charter through the existing native channels:
Codex developer instructions, Claude SDK system-prompt append, and Pi system
append. The brief includes an authority section with the source/version/hash
and the effective automatic/human-gated summary.

Top-level sessions need project instruction projections. On org/app onboarding,
Operon manages a clearly delimited derived block in `AGENTS.md` and
`CLAUDE.md`. It never overwrites existing content. The block contains the
effective charter text, canonical source path, version, and hash. Re-running is
idempotent; changes outside the markers are preserved byte-for-byte. If a file
cannot be composed safely, onboarding stops before writing and reports the
manual snippet.

Generated instruction blocks are projections, not additional authority
sources. The canonical org `AUTHORITY.md` remains the only grant; app policy
and task instructions only narrow it.

## Envelope and safety contract

Every run envelope stores:

```json
{
  "authority": {
    "source": "/org/AUTHORITY.md",
    "charter_version": "delegated-operator/v1",
    "profile": "delegated-operator",
    "sha256": "...",
    "app_restrictions": "/app/.operon/authority.yaml"
  }
}
```

The authority resolver cannot modify `defaultGate`, approval scopes, release
policy, or adapter tool shaping. A charter is context and provenance, never a
gate bypass. Tests must prove that every critical operation remains denied or
queued under the broadest profile.
