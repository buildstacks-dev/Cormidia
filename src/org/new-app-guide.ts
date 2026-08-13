import { CANONICAL_LABELS } from "../loop/plan-tickets.js";
import { parseRepositoryIdentity } from "../runtime/repo-identity.js";

interface NewAppGuideOptions {
  appName: string;
  repoSlug: string;
  targetDir: string;
  goal: string;
  template: "typescript-node" | "bare";
  packageRoot: string;
  orgHome: string;
  stateHome: string | null;
  setupCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
}

export function renderNextCommandsGuide(options: NewAppGuideOptions): string {
  // Defense in depth: this file's whole purpose is emitting executable `gh`
  // commands, so an unresolved identity must never reach it — the guide claims
  // its commands use the app's exact identities, and that claim has to be true.
  const identity = parseRepositoryIdentity(options.repoSlug, "new-app guide");
  const app = shellQuote(options.appName);
  const repo = shellQuote(identity.slug);
  const target = shellQuote(options.targetDir);
  const confirmation = (disposition: string) => shellQuote(`${options.appName}:${disposition}`);
  const productDocs = (disposition: string, execute = false) =>
    [
      "cormidia app product-docs",
      app,
      "--workdir",
      target,
      "--disposition",
      disposition,
      ...(execute ? ["--execute", "--confirm", confirmation(disposition)] : []),
    ].join(" ");
  const plan = (disposition: "keep" | "reconcile" | "remove", dryRun: boolean) =>
    [
      "cormidia plan",
      app,
      "--auto",
      "--goal",
      shellQuote(options.goal),
      ...(disposition === "keep"
        ? ["--source", shellQuote("docs/VISION.md"), "--source", shellQuote("docs/REQUIREMENTS.md")]
        : ["--source", shellQuote("<repo-relative-authoritative-corpus>")]),
      "--workdir",
      target,
      ...(dryRun ? ["--dry-run"] : []),
    ].join(" ");
  const labelCommands = CANONICAL_LABELS.map(
    (label) =>
      `gh label create ${shellQuote(label.name)} --color ${shellQuote(label.color)} --description ${shellQuote(label.description)} --force --repo ${repo}`,
  ).join("\n");
  const gateSection =
    options.template === "bare"
      ? `The bare template intentionally has no setup/test/lint command yet. The first planned dependency uses
\`executionGroup: bare-stack-and-gates-v1\` to select the stack and add meaningful gates. Until that reviewed PR
merges, \`cormidia app verify ${options.appName}\` is expected to remain blocked; do not add no-op or zero-test commands.`
      : `The generated checkout is immediately testable with the exact configured commands:

\`\`\`bash
cd ${target}
${options.setupCommand}
${options.testCommand}
${options.lintCommand}
\`\`\`

Expected result: setup succeeds and both configured gates pass before any Planner token is spent.`;
  const firstLoop =
    options.template === "bare"
      ? `cormidia loop --app ${app} --once --allow-network`
      : `cormidia loop --app ${app} --once`;

  return `# ${options.appName}: first milestone lifecycle

Goal: ${options.goal}

Template: \`${options.template}\`

This guide is checkpointed. Stop when an expected result is missing; a later checkpoint never repairs an earlier
one silently. Commands are one-line and use the generated app's exact identities.

## Checkpoint 0 — Know the four homes

- Package root: \`${options.packageRoot}\` — the installed Cormidia implementation and packaged templates.
- Org home: \`${options.orgHome}\` — committed roles, apps, prompts, policy, and authority.
- State home: \`${options.stateHome ?? "not supplied"}\` — local clones, worktrees, runs, approvals, budgets, and evidence.
- App repo: \`${options.targetDir}\` → \`${options.repoSlug}\` — product code, product truth, and app-owned \`.cormidia/\` files.

Inspect the resolved identities before mutation:

\`\`\`bash
cormidia context --json
\`\`\`

Expected result: the package/org/state paths above and app \`${options.appName}\` agree.

## Checkpoint 1 — Review the scaffold and decide product-document truth

The generated \`docs/VISION.md\`, \`docs/REQUIREMENTS.md\`, and \`docs/ARCHITECTURE.md\` are optional scaffold
documents. These previews are token-free and non-mutating, so compare the alternatives before choosing:

\`\`\`bash
${productDocs("keep")}
${productDocs("reconcile")}
${productDocs("remove")}
\`\`\`

- **keep**: you reviewed or replaced every document; no documentation ticket is added.
- **reconcile**: you will supply a repository-relative authoritative corpus; Cormidia creates governed documentation
  work for Builder and Reviewer, and orders product implementation after it.
- **remove**: Cormidia deletes only byte-identical scaffold placeholders; a replacement is never deleted, and planning
  must use another authoritative \`--source\`.

After reviewing the previews, choose exactly one mutually exclusive path. Never execute more than one disposition
for this checkpoint.

### If you chose keep

\`\`\`bash
${productDocs("keep", true)}
\`\`\`

### If you chose reconcile

\`\`\`bash
${productDocs("reconcile", true)}
\`\`\`

### If you chose remove

\`\`\`bash
${productDocs("remove", true)}
\`\`\`

Expected result: \`.cormidia/bootstrap/product-docs.json\` records one content-bound disposition and the command
reports its durability. Before this repository has a remote (which is the case here — Checkpoint 3 creates it) that is
\`local_only\`: the decision is recorded and Cormidia claims nothing beyond this checkout, which is correct because the
initial commit below carries it. Planning refuses if the record is not reachable from the app remote, or if those
document bytes drift afterward.

Running this command LATER, once the repository exists, publishes the decision instead: it stages only the manifest
(plus, for \`remove\`, the exact placeholders it deletes), cuts a dedicated branch, and opens a draft pull request for
review. It reports \`pending_merge\` until a human merges it — planning is not unblocked before that, and the refusal
names the merge, never another disposition run. \`--publish --execute --confirm ${options.appName}:publish\` resumes a
publication that did not finish; it does not re-record the decision.

## Checkpoint 2 — Prove the local readiness path

${gateSection}

## Checkpoint 3 — Create and push the private repository

Review \`git status --short\` before the initial commit. These are the first outward mutations:

\`\`\`bash
git -C ${target} init
git -C ${target} status --short
git -C ${target} add .
git -C ${target} commit -m ${shellQuote(`Bootstrap ${options.appName}`)}
gh repo create ${repo} --private --source ${target} --remote origin --push
\`\`\`

Expected result: \`${options.repoSlug}\` exists privately and its default branch contains the recorded disposition.

Install the canonical labels idempotently:

\`\`\`bash
cat ${target}/.cormidia/LABELS.md
${labelCommands}
\`\`\`

Expected result: \`.cormidia/LABELS.md\` and the remote label definitions agree.

## Checkpoint 4 — Preview and publish the first plan

If reconcile/remove was selected, first copy the authoritative design corpus into a reviewed repository path such as
\`design/approved/\`; replace \`<repo-relative-authoritative-corpus>\` below with that path. Required \`--source\`
inputs are content-hashed, bounded, and resolved from \`${options.targetDir}\` before a provider starts.

Run exactly one section: the pair matching the recorded disposition. In each section, the first line is token-free
and GitHub-write-free; inspect it before running the live second line.

### If the recorded disposition is keep

\`\`\`bash
${plan("keep", true)}
${plan("keep", false)}
\`\`\`

### If the recorded disposition is reconcile

\`\`\`bash
${plan("reconcile", true)}
${plan("reconcile", false)}
\`\`\`

### If the recorded disposition is remove

\`\`\`bash
${plan("remove", true)}
${plan("remove", false)}
\`\`\`

Expected result: the live command publishes one bounded TicketPlan. Reconcile publishes one documentation unit and
keeps product implementation dependency-locked; bare also publishes the stack-and-gates unit first. Keep adds no
unnecessary documentation work. Remove never regenerates the optional documents.

## Checkpoint 5 — Deliver through Builder and Reviewer

Preview the next claim, then run it:

\`\`\`bash
cormidia loop --app ${app} --once --dry-run
${firstLoop}
\`\`\`

Expected result: the dependency-free unit moves through Builder, configured gates, and independent Reviewer into one
PR. The bare stack unit alone receives temporary network permission; omit \`--allow-network\` from later runs.

Inspect approvals and the exact PR/HEAD before merge:

\`\`\`bash
cormidia approvals list --json
cormidia approvals review --by '<operator-identity>'
gh pr list --repo ${repo} --state open
gh pr view '<pr-number>' --repo ${repo} --web
\`\`\`

Critical operations wait in the approval queue. When app/repository policy requires human merge, only a human merges
the reviewed exact HEAD after required checks are green:

\`\`\`bash
gh pr merge '<pr-number>' --repo ${repo} --squash --delete-branch
\`\`\`

Expected result: merge evidence exists before dependent issues become ready. Repeat the loop preview/live pair until
the first milestone's dependency graph is complete.

## Checkpoint 6 — Verify, promote, and confirm the merge

\`\`\`bash
cormidia app verify ${app} --json
cormidia app promote ${app} --to live --json
cormidia app promote ${app} --to live --execute --json
cormidia app verify ${app} --json
\`\`\`

Expected result: verification proves the merged gates and runtime readiness; the first promote command is a preview,
the second performs only that reviewed lifecycle transition, and the final verification reads the live state.

Build-complete is not release authorization. Deployment, package/tag publication, website publication, and external
communication are separate content-bound actions, each requiring its own human approval and supported release path.

## Checkpoint 7 — Operate and maintain

Scheduler installation changes the host scheduler. Stop after its preview until a human authorizes the exact
reported definition and confirmation identity.

\`\`\`bash
cormidia status --app ${app}
cormidia budget
cormidia report --app ${app} --period 30d
cormidia observe --app ${app} --open
gh issue list --repo ${repo} --state open
sed -n '1,240p' '<reviewed-ticket.md>'
gh issue create --repo ${repo} --title '<maintenance outcome>' --body-file '<reviewed-ticket.md>'
cormidia scheduler status --json
cormidia scheduler install --json
cormidia scheduler install --execute --confirm '<scheduler-id>'
\`\`\`

Expected result: status/budget/report/observer remain read-only; review the backlog before creating a maintenance
ticket; scheduler install is preview-first and only schedules apps already promoted to live.
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
