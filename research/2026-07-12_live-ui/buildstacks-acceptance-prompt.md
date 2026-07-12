# buildstacks.dev Live UI acceptance slice

Operate through `Bikram-Org` on the registered `buildstacks.dev` app and the
private repository `buildstacks-dev/buildstacks.dev`.

Use these files as product truth:

- `docs/design/buildstacks-design-spec.md`
- `docs/design/buildstacks-prototype.html`

Plan and deliver one bounded, meaningful v1 slice: establish the static Astro
foundation and the engineered-calm home page (design build order items 1–3).
The slice should include the central design tokens, self-hosted specified
fonts, shared head/header/footer, trust ladder, home sections, dark mode,
360px responsiveness, visible keyboard focus, and reduced-motion behavior.
Keep content pages static and avoid unrelated routes or deployment work.

Completion requires:

1. A schema-valid Operon plan and canonical GitHub delivery ticket(s).
2. Dependency-free work labeled `op:ready` and claimed normally.
3. Builder implementation on an `op/` branch from `main`.
4. Green setup/tests/lint/build and all selected mechanical gates.
5. Independent Operon Reviewer evidence against the exact PR head.
6. The normal authorized terminal outcome: a reviewed, green squash merge is
   allowed; no production deployment, DNS, cloud, secret, or infrastructure
   action is allowed.
7. Honest parent-task, run, event, telemetry, invocation, GitHub, and approval
   evidence suitable for reconciliation with `operon observe`.

The read-only observer must already be running before planning. During an
active pass, verify refresh, SSE reconnect, observer restart, liveness,
prompt/output/activity evidence, and usage settlement from durable state. Do
not pipe CLI output into the UI and do not mark the parent task complete if
Planner, Builder, Reviewer, gates, or the authorized terminal outcome is
missing.
