// The critical-ops gate (docs/PURPOSE.md → Decided → Approval boundary).
// v0 is a pattern classifier + a default policy that denies-and-escalates
// anything critical. Every adapter must route every tool action — including
// subagents' — through a GateFn; the conformance suite in
// test/gate.test.ts is the contract.

import type { GateDecision, GateFn, ToolAction } from "./types.js";

export type OpClass = "critical" | "routine";

interface CriticalRule {
  name: string;
  matches: (a: ToolAction) => boolean;
}

/** Effect-bearing fields used by classification and persisted with an
 * approval request. Free-text payloads are deliberately absent: message and
 * review bodies, search patterns, comments, and heredoc content are data, not
 * executable intent. */
export interface ActionEffectFields {
  tool: string;
  operation: SemanticAction["operation"];
  executables: string[];
  targets: string[];
  redirections: string[];
  environment: string[];
  destination: string | null;
  effect: string | null;
}

export interface CriticalActionEvidence {
  schemaVersion: 1;
  rule: string;
  reason: string;
  matchedAction: ActionEffectFields;
}

export interface SemanticAction {
  tool: string;
  operation: "read" | "write" | "execute" | "return_data" | "unknown";
  command: string | null;
  paths: string[];
  destination: string | null;
  effect: string | null;
}

/** Normalize only the semantics a tool can actually enact. In particular,
 * write/edit payload prose is data, not an executable command: documentation
 * that says `kubectl apply` cannot become a production deploy approval. */
export function normalizeSemanticAction(action: ToolAction): SemanticAction {
  return semanticActionWithShell(action).semantic;
}

/** `normalizeSemanticAction` plus the shell projection it had to build to
 *  decide the operation, so `actionEffectFields` does not parse twice. */
function semanticActionWithShell(action: ToolAction): { semantic: SemanticAction; shell: ShellEffects | null } {
  const tool = action.tool.trim().toLowerCase();
  if (VERDICT_TOOLS.has(tool)) {
    return {
      semantic: { tool, operation: "return_data", command: null, paths: [], destination: "orchestrator", effect: "typed_data" },
      shell: null,
    };
  }
  const input = asRecord(action.input);
  const explicitCommand =
    typeof input?.["command"] === "string"
      ? input["command"]
      : typeof input?.["cmd"] === "string"
        ? input["cmd"]
        : typeof action.input === "string" && !isDataMutationTool(tool)
          ? action.input
          : undefined;
  const command = explicitCommand === undefined ? null : unwrapCommand(explicitCommand);
  const paths = [
    input?.["path"],
    input?.["file_path"],
    input?.["target"],
    input?.["destination"],
    input?.["resolved_path"],
    input?.["real_path"],
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizePath)
    .filter((value, index, all) => value !== "" && all.indexOf(value) === index)
    .sort();
  // ISSUE-027: the operation of a shell action comes from WHAT ITS PROGRAMS DO,
  // never from the fact that it named a file. The old test was
  // `shellWrites(command)` — a regex for a `>` anywhere in the raw string plus a
  // handful of verbs — and it recorded `/bin/zsh -lc 'wc -l AGENTS.md …
  // 2>/dev/null'` as a WRITE (the literal-stderr-sink exemption only fired
  // before whitespace/EOL, so the wrapper's closing quote made a null sink look
  // like a real redirect). `operation: "write"` plus the protocol paths in
  // `targets` is exactly the `protocol-self-edit` predicate, so counting lines
  // in the scaffold terminalized a fresh app's first ticket. The parsed
  // projection below knows which programs run, which redirections are material,
  // and which flags mutate in place — so a read stays a read and every
  // write-shaped signal still escalates.
  const shell = command === null ? null : analyzeShell(command);
  const operation = VERDICT_TOOLS.has(tool)
    ? "return_data" as const
    : isDataMutationTool(tool) || shell?.writes === true
      ? "write" as const
      : /(?:^|[_-])(read|view|get)(?:$|[_-])/.test(tool) || readsOnly(shell)
        ? "read" as const
        : command !== null || isShellTool(tool)
          ? "execute" as const
          : "unknown" as const;
  const destination = typeof input?.["destination"] === "string" ? input["destination"].trim().toLowerCase() : null;
  const effect = typeof input?.["effect"] === "string" ? input["effect"].trim().toLowerCase() : null;
  return { semantic: { tool, operation, command, paths, destination, effect }, shell };
}

/** A command whose every program is a read-only utility and which carries no
 *  write-shaped signal is a READ, whichever paths it names (ISSUE-027 rule 1). */
function readsOnly(shell: ShellEffects | null): boolean {
  return shell !== null && shell.ranCommand && !shell.ranOtherCommand && !shell.writes;
}

/** Strip agent-authored free-text argument VALUES — a commit message
 *  (`-m`/`--message`), a PR/review body (`--body`), a release note
 *  (`--notes`), etc. — from a command before it feeds the classification
 *  rules. Those values are metadata the agent writes, not an effect the
 *  command enacts, so matching rules against them is the L1-05 prose defect:
 *  a review body that merely *discusses and rules out* "auth"/"secret"
 *  concerns tripped `secrets-or-auth`, and one that named a protocol file
 *  while using a write verb ("edits roles.yaml") tripped `protocol-self-edit`
 *  — 9/9 false positives in the live campaign — while the action's real
 *  effect (the `gh pr review` verb) reached the right rule only by accident.
 *  This mirrors the VERDICT_TOOLS exemption (payload prose is data, not an
 *  action) and deliberately does NOT touch normalizeSemanticAction, so the
 *  authorization identity (actionHash) is unchanged. The command's actual
 *  file arguments and verbs are untouched, so a real secret-file read or
 *  protocol-surface write still classifies critical.
 *
 *  EXCEPTION (the prompt-injected-builder threat model): a value is only
 *  stripped when it is inert prose. A value carrying a shell command
 *  substitution or expansion — `$(...)`, a backtick, or `${...}` — is NOT
 *  prose: the shell executes/expands it, so `git commit -m "$(cat .env)"`
 *  reads .env and `gh pr create --body "$(cat ~/.ssh/id_rsa)"` reads a private
 *  key at commit/PR time. Stripping those blinded the classifier and turned a
 *  CRITICAL exfil into a ROUTINE op. Such a value is left in place so the
 *  embedded command text still reaches the rules — the `.env`/`id_rsa` read
 *  trips secrets-or-auth, an `rm -rf ~` trips destructive-or-irreversible, a
 *  `curl` trips outbound-network. */
function withoutMessageArgs(command: string): string {
  return stripMessageArgs(command, { keepExecutable: true });
}

/** The message/free-text flag names whose VALUES are agent-authored metadata
 *  rather than an effect the command enacts — a commit message (`-m`/
 *  `--message`), a PR/review body (`--body`), a release note (`--notes`), and
 *  the title/subject/description variants. One list, two consumers with a
 *  deliberate behavioral fork (see stripMessageArgs). */
const MESSAGE_FLAG_ARG =
  /(?:^|\s)(?:--body|--message|--subject|--description|--notes|--title|-m)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi;

/** Strip message-flag argument VALUES from a command. The `keepExecutable`
 *  fork is the whole point of sharing one flag list between two callers with
 *  OPPOSITE fail-safe directions:
 *   - CLASSIFICATION (`keepExecutable: true`, via withoutMessageArgs): a value
 *     carrying a shell construct (`$(...)`, backtick, `${...}`) is KEPT so the
 *     embedded effect still reaches the rules — `git commit -m "$(cat .env)"`
 *     must stay CRITICAL (L1-05). Inert prose is dropped.
 *   - GRANT-SCOPE (`keepExecutable: false`, from grantScopeText in
 *     gate-compose.ts): EVERY message value is dropped, with no executable
 *     carve-out, so no agent free text can reach a `pathContains` bound and
 *     widen a scoped grant (P0-04c/A-005). Narrower is the fail-closed
 *     direction for authorization scope — a stripped legitimate value merely
 *     costs one human re-approval, whereas keeping `$(cat .npmrc)` (or a
 *     `# .npmrc` smuggled inside a quoted value) would let it widen a
 *     .npmrc-scoped grant to arbitrary reads. */
export function stripMessageArgs(command: string, options: { keepExecutable: boolean }): string {
  return command.replace(MESSAGE_FLAG_ARG, (match: string, value: string) =>
    options.keepExecutable && hasExecutableEffect(value) ? match : " ",
  );
}

/** True when a message VALUE contains a shell construct the shell would run or
 *  expand rather than treat as literal text: command substitution `$(...)`, a
 *  backtick, or parameter/`${IFS}`-style expansion `${...}`. Checked on the raw
 *  value regardless of the surrounding quote style — an inert single-quoted
 *  `$(...)` costs at most one human tap if kept, whereas reasoning about shell
 *  quoting to save that tap would risk a false negative (fail closed). */
function hasExecutableEffect(value: string): boolean {
  return value.includes("$(") || value.includes("`") || value.includes("${");
}

export function semanticActionText(action: ToolAction): string {
  const fields = actionEffectFields(action);
  return [
    fields.tool,
    fields.operation,
    ...fields.executables,
    ...fields.targets,
    ...fields.redirections,
    ...fields.environment,
    fields.destination ?? "",
    fields.effect ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

const asText = (a: ToolAction): string => semanticActionText(a);
const effectText = (a: ToolAction): string => asText(a);

/**
 * The org runtime's OWN command line is an effect surface, and its
 * human-gated verbs were invisible here: `cormidia app reset --execute` removes
 * an app's managed state and closes its tracked GitHub work, `cormidia org
 * upgrade --execute` rewrites the ratified org surfaces, and `cormidia plan
 * ratify-ticket-budget --execute` publishes GitHub issues — all three
 * classified routine, while `rm -rf`, an `echo > roles.yaml` and a
 * `gh issue create` with exactly those effects are critical. An agent that can
 * shell out can reach them, so each verb is routed to the rule its EFFECT
 * belongs to rather than to a new catch-all: the executor allowlist, the
 * never-scopeable list and role shaping all key off the rule name.
 *
 * Read-only invocations (`cormidia roles`, `status`, `doctor`, `budget`,
 * `context`, `episode explain`, a `--dry-run`) are deliberately absent: the
 * point is the boundary, not friction on inspection.
 */
const CORMIDIA_VERB = {
  /** Rewrites or re-points the org's ratified protocol surfaces. */
  protocolWrite: /\bcormidia\s+org\s+(?:upgrade|init|use)\b/,
  /** Archives and removes managed state, or deletes durable run records. */
  destructive: /\bcormidia\s+(?:app\s+reset|prune-runs)\b/,
  /** Publishes to GitHub: bootstrap draft PRs, ratified ticket issues. */
  publish: /\bcormidia\s+(?:plan\s+ratify-ticket-budget|bootstrap\s+publish)\b/,
  /** Decides, revokes or dispositions approvals — the gate's root of trust. */
  approvalWrite: /\bcormidia\s+approvals\s+(?:review|revoke|disposition)\b/,
} as const;

/** The canonical `gh api` projection built by ghApiVerbParts, as it appears in
 *  the flattened effect text: `gh api <method> <endpoint>`. */
const GH_API_PROJECTION = /\bgh api (get|head|post|put|patch|delete|unknown)(?: (\S+))?/g;

type GhApiRoute = "self-merge-or-approve" | "external-publishing" | "destructive-or-irreversible";

/** `gh api` is the GitHub CLI's raw REST/GraphQL escape hatch: `gh api
 *  --method PUT repos/o/r/pulls/7/merge` performs the same merge as
 *  `gh pr merge`, reached by a route the subcommand patterns never see
 *  (HB-010; INV-002 requires the gate to be total over direct API calls).
 *  Mirroring CORMIDIA_VERB, each MUTATING call routes to the rule its EFFECT
 *  belongs to rather than a new catch-all — the executor allowlist, the
 *  never-scopeable list and role shaping all key off the rule name:
 *   - `pulls/{n}/merge` and `…/reviews` are the raw-API spellings of
 *     `gh pr merge` / `gh pr review` → self-merge-or-approve;
 *   - `releases`, `issues`, `comments` are the raw-API spellings of
 *     `gh release|issue|pr create/comment` → external-publishing;
 *   - anything else (git/refs deletes, workflow dispatches, …) is an
 *     arbitrary remote mutation → destructive-or-irreversible ("irreversible
 *     remote/data operations stay critical unconditionally").
 *  GET/HEAD calls route nowhere: the read/poll shape stays routine (the
 *  orchestrator's own GhOps never pass through this gate, but agent turns
 *  poll the same endpoints, and false positives there are availability
 *  damage). `graphql` is POSTed whatever the flags say and a read-only query
 *  is indistinguishable from a mutation without parsing GraphQL the
 *  projection does not carry, so every graphql call fails closed as a
 *  mutation — no product path invokes `gh api graphql` (verified by grep over
 *  src/ 2026-07-31), so the over-breadth costs at most a human tap on an
 *  exploratory query. */
function ghApiRoutesTo(text: string, rule: GhApiRoute): boolean {
  for (const match of text.matchAll(GH_API_PROJECTION)) {
    const method = match[1]!;
    const endpoint = match[2] ?? "";
    const route: GhApiRoute | null =
      endpoint === "graphql" || endpoint.startsWith("graphql/")
        ? "destructive-or-irreversible"
        : method === "get" || method === "head"
          ? null
          : /\bpulls\/[^\s/]+\/merge\b/.test(endpoint) || /(?:^|\/)reviews\b/.test(endpoint)
            ? "self-merge-or-approve"
            : /(?:^|\/)(?:releases|issues|comments)\b/.test(endpoint)
              ? "external-publishing"
              : "destructive-or-irreversible";
    if (route === rule) return true;
  }
  return false;
}

/** v0 heuristics. Deliberately over-broad: false positives cost a human tap,
 *  false negatives cost an incident. Tighten with calibration data. */
export const CRITICAL_RULES: CriticalRule[] = [
  {
    name: "production-deploy",
    matches: (a) => {
      const t = effectText(a);
      return (
        /\bkubectl\s+(?:apply|rollout|delete|patch|replace|scale)\b/.test(t) ||
        /\bdoctl\s+apps\s+(?:create-deployment|update|create|delete)\b/.test(t) ||
        /\bgh\s+workflow\s+run\b/.test(t) ||
        /\b(?:helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy))\b/.test(t) ||
        /\b(?:deploy|deploy\.sh|release-to-prod)\b/.test(actionEffectFields(a).executables.join(" ")) ||
        (actionEffectFields(a).destination === "production" && actionEffectFields(a).effect === "deploy")
      );
    },
  },
  {
    // Calibrated (Stage 6, docs/approvals/design.md): irreversible
    // remote/data operations stay critical unconditionally, but `rm -rf` on a
    // RELATIVE path is bounded by the sandbox cwd (the ticket worktree) and
    // is routine — the 2026-07-10 episode escalated deleting a temp folder
    // inside the worktree while twelve hours of human attention flowed
    // freely. Absolute paths, `~`, `$HOME`, and parent escapes (`..`) remain
    // critical.
    name: "destructive-or-irreversible",
    matches: (a) => {
      const t = asText(a);
      if (/\b(drop table|truncate|force[- ]?push|delete (database|bucket|droplet|dns))\b/.test(t)) {
        return true;
      }
      if (/\bgit\s+push\s+(?:--force(?:-with-lease)?|-f)\b/.test(t)) return true;
      if (CORMIDIA_VERB.destructive.test(t)) return true;
      // The raw-API default: a mutating `gh api` whose endpoint no tighter
      // rule recognizes (and every `gh api graphql`, fail closed) is an
      // arbitrary remote mutation — see ghApiRoutesTo.
      if (ghApiRoutesTo(t, "destructive-or-irreversible")) return true;
      const fields = actionEffectFields(a);
      if (!fields.executables.includes("rm")) return false;
      return fields.targets.some((target) =>
        target.startsWith("/") ||
        target.startsWith("~") ||
        /^\$\{?home\}?/i.test(target) ||
        target.includes(".."),
      );
    },
  },
  {
    name: "dns-or-domain",
    matches: (a) => /\b(dns record|nameserver|domain transfer)\b/.test(effectText(a)),
  },
  {
    name: "secrets-or-auth",
    // `secrets?`/`credentials?` (not word-bounded `secret`/`credential`) so
    // plural secret-bearing filenames — `secrets.json`, `credentials.json` —
    // trip too; plus the common credential FILES (SSH keys, PEM material,
    // .npmrc/.netrc) an exfil would target by name.
    //
    // Calibrated (Stage 6): a REPO-LOCAL `.npmrc`/`.netrc` (relative path, no
    // `~`/absolute/home prefix) no longer trips the rule by name alone — the
    // episode burned 24 escalations and its final $30 pass on a repo `.npmrc`
    // containing only `engine-strict=true`. User/global variants (`~/.npmrc`,
    // absolute paths) and every other secret pattern still escalate, and
    // exfiltration channels are closed independently by outbound-network.
    matches: (a) => {
      const scrubbed = asText(a).replace(
        /(^|[\s"'=([])(?:\.\/)?\.(npmrc|netrc)\b/g,
        "$1repo-local-rc-file",
      );
      return (
        /\bprintenv\b/.test(scrubbed) ||
        /\bgh\s+(?:auth\s+(?:login|logout|refresh)|secret\s+(?:set|delete))\b|\bnpm\s+(?:login|logout|token)\b/.test(scrubbed) ||
        /\b(?:docker\s+(?:login|logout)|gcloud\s+auth\s+(?:login|revoke)|aws\s+configure|kubectl\s+config\s+set-credentials)\b/.test(scrubbed) ||
        /\b(secrets?|api[_ ]?key|credentials?|rotate key|oauth client)\b|\.env\b|\b(id_rsa|id_ed25519)\b|\.(pem|npmrc|netrc)\b/.test(scrubbed)
      );
    },
  },
  {
    name: "external-publishing",
    matches: (a) => {
      const t = effectText(a);
      return (
        /\bnpm\s+publish\b|\b(?:sendmail|mail|tweet)\b/.test(t) ||
        /\bgh\s+(?:issue\s+(?:create|comment)|pr\s+(?:create|comment)|release\s+create)\b/.test(t) ||
        // The raw-API spellings of the same publications: a mutating `gh api`
        // against releases/issues/comments (see ghApiRoutesTo, HB-010).
        ghApiRoutesTo(t, "external-publishing") ||
        CORMIDIA_VERB.publish.test(t) ||
        a.tool.toLowerCase() === "cormidia.github.issue.create" ||
        a.tool.toLowerCase() === "cormidia.github.issue.comment"
      );
    },
  },
  {
    // Global provider memory/config (~/.claude, ~/.codex, $CODEX_HOME…) is
    // outside every app boundary: an agent writing there rewires its own
    // future behavior across apps. The episode denied this by hand eight
    // times; the rule makes it a named class (and role shaping in
    // src/org/gate-compose.ts auto-denies it for builder/reviewer without
    // burning a human decision).
    name: "provider-global-memory",
    matches: (a) => {
      const t = asText(a);
      return (
        isWrite(a) &&
        /(~|\$home|\/users\/[^\s/]+|\/home\/[^\s/]+)\/\.(claude|codex|gemini|config\/(claude|codex))\b|\$codex_home|\$claude_home/.test(
          t,
        )
      );
    },
  },
  {
    // Outbound network from a build turn is the exfiltration channel: a
    // prompt-injected agent piping secrets to an attacker host. The build
    // protocol pushes code via git (its own routine verbs), so treating the
    // raw egress tools as critical costs at most a human tap on a legitimate
    // fetch while closing the leak path (docs/loop/design.md gate philosophy).
    name: "outbound-network",
    matches: (a) => /\b(curl|wget|ncat|nc|scp|sftp|telnet)\b/.test(effectText(a)),
  },
  {
    // Self-merge / self-approve bypasses the review boundary the whole org
    // depends on: an agent must never merge its own PR or post a review of
    // one — reviews travel as typed verdicts; the orchestrator turns them into
    // GhOps that do NOT pass through this gate. The rule therefore matches
    // EVERY `gh pr merge`/`gh pr review` regardless of flag (not just
    // `--approve`): `gh pr review --comment` is the self-approval marker's
    // publish channel (A-001) and must classify critical too, matching the
    // Claude deny pattern `Bash(gh pr review:*)` in role-shaping.ts. Read-only
    // `gh pr view/list/checkout` stay routine.
    name: "self-merge-or-approve",
    matches: (a) => {
      const t = asText(a);
      return (
        /\bgh\s+pr\s+(?:merge|review)\b/.test(t) ||
        (/\bgh\b/.test(t) && /--admin\b/.test(t)) ||
        // The raw-API spellings of the same boundary: a mutating `gh api`
        // against `pulls/*/merge` or `…/reviews` (see ghApiRoutesTo, HB-010).
        ghApiRoutesTo(t, "self-merge-or-approve")
      );
    },
  },
  {
    name: "protocol-self-edit", // agents don't rewrite their own rules
    matches: (a) => {
      const t = asText(a);
      // `cormidia org upgrade|init|use` writes/re-points those same surfaces
      // through the org runtime's own CLI, where no file path appears in the
      // action for isProtocolSurface to see.
      return CORMIDIA_VERB.protocolWrite.test(t) || (isWrite(a) && isProtocolSurface(t));
    },
  },
  {
    name: "scorecard-tamper", // scorecards are orchestrator-written only, never
    // self-reported (docs/architecture.md §6) — an agent write is a distinct
    // integrity concern from rewriting the org's own rules, hence its own rule
    matches: (a) => isWrite(a) && /\bscorecards\/[^\s"']+/.test(asText(a)),
  },
  {
    // The learning loop's governance surfaces (docs/learning-loop/ spec §1):
    // active bundles, manifests, policy, quarantine, evals, reviews, the
    // rejection ledger, experiments, and interventions — in the org home
    // (learning/**) and the app repo (.cormidia/learning/**) alike. Only the
    // deterministic publisher and humans write inside them; an agent write is
    // active-context self-modification (a prompt-injection persistence
    // channel, design §11). learning/candidates/** and learning/proposals/**
    // are deliberately NOT matched: agents emit candidate notes and draft
    // proposals freely — those carry no authority until reviewed.
    name: "learning-surface-tamper",
    matches: (a) =>
      isWrite(a) &&
      /\blearning\/(bundle|quarantine|evals|reviews|experiments|interventions|manifest\.yaml|policy\.yaml|rejections\.jsonl)\b/.test(
        asText(a),
      ),
  },
  {
    // The approval store (<org-home>/approvals/{grants,pending,decided}/*.json
    // + log.jsonl) is the ROOT OF TRUST for the whole gate: composeGate lets
    // any op through if a matching single-use grant file exists (src/org/
    // gate-compose.ts, src/org/approvals.ts). An agent that can write there
    // could forge a grant (or bump uses/expiresAt) and self-approve a critical
    // op with no human tap. Only the Codex adapter's workspace-write sandbox
    // blocks this today; the gate must classify these writes as critical so
    // the boundary holds on every adapter. Reads stay routine.
    name: "approval-store-tamper",
    matches: (a) => {
      const t = asText(a);
      // Deciding an approval from inside a turn is self-approval by CLI: the
      // same forged grant, reached through the supported command instead of a
      // file write.
      return CORMIDIA_VERB.approvalWrite.test(t) ||
        (isWrite(a) && /\bapprovals\/(grants|pending|decided|log\.jsonl)\b/.test(t));
    },
  },
];

function isWrite(a: ToolAction): boolean {
  const semantic = normalizeSemanticAction(a);
  if (semantic.operation === "write") return true;
  // A SHELL action's write-ness is settled structurally by the projection
  // (ISSUE-027): the parse already saw every program, every material
  // redirection and every in-place flag, so re-deriving it from the flattened
  // evidence text can only add false positives — the flattened text contains
  // the command's file arguments, which is how `wc -l AGENTS.md` became a
  // protocol self-edit. Actions with no command have nothing to parse and keep
  // the name/path heuristics below.
  if (semantic.command !== null) return false;
  const t = asText(a);
  // Verbs are prefix-matched (append → appends); cp/tee are whole-word to
  // avoid cpu/teed false hits. Shell redirects get their own test: the old
  // `\b>\s` alternative was unsatisfiable after whitespace (no word
  // boundary exists between a space and `>`), so `echo x > roles.yaml`
  // classified routine. `>&` fd-duplication (2>&1) is not a file write.
  return WRITE_VERB_NAME.test(t) || hasMaterialRedirect(t);
}

/** The legacy name heuristic: a tool or program whose NAME carries a write verb
 *  writes. Kept verbatim (prefix-matched verbs; `cp`/`tee` whole-word) and
 *  applied in two places — to a payload action's tool/paths in `isWrite`, and
 *  to an otherwise-unknown shell executable in `mutatesFiles`, so
 *  `./create-config.sh AGENTS.md` stays a write while `wc` does not. */
const WRITE_VERB_NAME = /\b(write|edit|create|replace|append|mv|cp\b|tee\b|rm|sed -i)/;

/** Exact protocol filenames, matched anywhere in the repo tree (e.g. root
 *  `roles.yaml`, an app's `.cormidia/TASTE.md`, a nested `apps.yaml`). */
const PROTOCOL_FILENAMES =
  /\b(taste\.md|roles\.yaml|agents\.md|purpose\.md|pipelines\.yaml|apps\.yaml)\b/;

/** Path-qualified protocol directories, where the file basename varies and so
 *  the exact-filename check above can't catch it — e.g. `taste/reviewer.md`
 *  (role craft addenda; distinct from the root `TASTE.md` constitution) and
 *  `prompts/build/contract.md` (pass templates, docs/loop/design.md §2 rule 2). The
 *  old `\btaste\.md\b`-only check missed these: "taste/reviewer.md" has no
 *  "taste.md" substring. */
const PROTOCOL_DIRS = /\b(taste|prompts)\/[^\s"']+/;

/** `.cormidia/config.yaml` (app bootstrap config) doesn't share a basename with
 *  any of the above, so it gets its own exact match. */
const PROTOCOL_CONFIG_FILE = /\.cormidia\/config\.yaml\b/;

function isProtocolSurface(text: string): boolean {
  return (
    PROTOCOL_FILENAMES.test(text) || PROTOCOL_DIRS.test(text) || PROTOCOL_CONFIG_FILE.test(text)
  );
}

/** The structured-output pseudo-tool is the typed verdict channel back to
 *  the orchestrator (TurnRequest.verdictSchema): calling it performs no
 *  action — the orchestrator validates the payload and acts itself. Its
 *  CONTENT must therefore never be classified: a plan that *talks about*
 *  deployment is not an attempt *to deploy*. Without this, the 2026-07-11
 *  A4 live run deadlocked — four StructuredOutput attempts blocked under
 *  three different rules, and the planner (correctly refusing to reword
 *  its way past a human gate) failed the turn. Real tools with side
 *  effects keep full pattern matching. */
const VERDICT_TOOLS = new Set(["structuredoutput", "structured_output"]);

export function classify(action: ToolAction): { cls: OpClass; rule?: string } {
  if (VERDICT_TOOLS.has(action.tool.toLowerCase())) return { cls: "routine" };
  for (const rule of CRITICAL_RULES) {
    if (rule.matches(action)) return { cls: "critical", rule: rule.name };
  }
  return { cls: "routine" };
}

/** Detailed form used at the approval boundary. `classify()` intentionally
 * keeps its compact compatibility shape for callers that only need the rule;
 * approval evidence gets the structured action fields that explain why the
 * rule fired without persisting prose as executable intent. */
export function classifyWithEvidence(action: ToolAction):
  | { cls: "routine" }
  | { cls: "critical"; rule: string; evidence: CriticalActionEvidence } {
  const classification = classify(action);
  if (classification.cls === "routine" || classification.rule === undefined) return { cls: "routine" };
  return {
    cls: "critical",
    rule: classification.rule,
    evidence: {
      schemaVersion: 1,
      rule: classification.rule,
      reason: `critical action matched ${classification.rule}`,
      matchedAction: actionEffectFields(action),
    },
  };
}

/** Default policy: routine ops flow, critical ops are denied and escalated
 *  to the human approval surface. */
export const defaultGate: GateFn = (action: ToolAction): GateDecision => {
  const classification = classifyWithEvidence(action);
  if (classification.cls === "critical") {
    return {
      allow: false,
      reason: `critical op (${classification.rule}) requires human approval`,
      escalate: true,
    };
  }
  return { allow: true };
};

/** Resolve the action fields that can actually produce effects. The shell
 * projection is intentionally small and conservative: it understands command
 * boundaries, wrappers, redirects, common read/write tools, GitHub verbs, and
 * search/message/heredoc data positions. Unknown commands contribute their
 * executable and flags, but not arbitrary prose arguments. */
export function actionEffectFields(action: ToolAction): ActionEffectFields {
  const { semantic, shell } = semanticActionWithShell(action);
  const input = asRecord(action.input);
  const inputEnvironment = asRecord(input?.["env"] ?? input?.["environment"]);
  const environment = inputEnvironment === undefined ? [] : Object.keys(inputEnvironment).sort();
  if (semantic.command === null || shell === null) {
    return {
      tool: semantic.tool,
      operation: semantic.operation,
      executables: semantic.operation === "return_data" ? [] : [semantic.tool],
      targets: [...semantic.paths],
      redirections: [],
      environment,
      destination: semantic.destination,
      effect: semantic.effect,
    };
  }
  return {
    tool: semantic.tool,
    operation: semantic.operation,
    executables: shell.executables,
    targets: [...new Set([...semantic.paths, ...shell.targets])].sort(),
    redirections: shell.redirections,
    environment: [...new Set([...environment, ...shell.environment])].sort(),
    destination: semantic.destination,
    effect: semantic.effect,
  };
}

interface ShellEffects {
  executables: string[];
  targets: string[];
  redirections: string[];
  environment: string[];
  /** A write-shaped signal was seen: a material output redirection, a mutating
   *  program, an in-place flag, or a destination the projection could not
   *  resolve. Only this makes an action a WRITE (ISSUE-027 rule 2). */
  writes: boolean;
  /** At least one real program ran (shell grammar and inert builtins do not
   *  count), so "every program was read-only" is a claim about something. */
  ranCommand: boolean;
  /** At least one program was NOT a read-only utility. */
  ranOtherCommand: boolean;
}

const FILE_ARGUMENT_TOOLS = new Set([
  "cat", "head", "tail", "less", "more", "wc", "stat", "readlink", "realpath",
  "file", "cksum", "md5", "md5sum", "shasum", "sha1sum", "sha256sum", "nl",
  "ls", "du", "diff", "sort", "cut", "uniq",
  "rm", "mv", "cp", "tee", "touch", "chmod", "chown", "chgrp", "install", "ln",
  "truncate", "mkdir", "mkfifo", "rmdir", "unlink", "shred", "rsync", "patch",
  "ed", "source", ".",
]);

/** Utilities whose invocation READS the paths it names, whatever those paths
 *  are (ISSUE-027 rule 1). This is the set that had to exist: the classifier
 *  inferred `operation` from "this command has file arguments", so counting
 *  lines in `AGENTS.md` and `.cormidia/config.yaml` — the literal instruction a
 *  bare-template builder is given on its first ticket — recorded a write and
 *  raised `protocol-self-edit`, a rule the orchestrator may never discharge
 *  mechanically. Membership here is not a licence: a read-only program in a
 *  command that ALSO redirects, or runs a mutating program, still writes, and
 *  `sed`/`awk`/`sort`/`find` are read-only only while their mutating flags are
 *  absent (see `mutatingFlag`). */
const READ_ONLY_EXECUTABLES = new Set([
  "awk", "basename", "cat", "cksum", "column", "comm", "cut", "diff", "dirname",
  "du", "egrep", "fgrep", "file", "find", "grep", "head", "jq", "less", "ls",
  "md5", "md5sum", "more", "nl", "od", "pwd", "readlink", "realpath", "rg",
  "ripgrep", "sed", "sha1sum", "sha256sum", "shasum", "sort", "stat", "tail",
  "tr", "uniq", "wc", "which", "xxd",
]);

/** Programs whose whole job is to change the filesystem. Naming a path with one
 *  of these IS the write-shaped signal — no redirection required. */
const MUTATING_EXECUTABLES = new Set([
  "chgrp", "chmod", "chown", "cp", "dd", "ed", "install", "ln", "mkdir",
  "mkfifo", "mv", "patch", "rm", "rmdir", "rsync", "shred", "tee", "touch",
  "truncate", "unlink",
]);

/** `git` subcommands that only report. Every other subcommand — `commit`,
 *  `checkout`, `restore`, `apply`, `clean`, `stash` — changes the worktree or
 *  the repository, so it is treated as a write (fail closed, ISSUE-027 rule 3).
 *  Shared with `gitArguments` so "which git subcommands are reads" is stated
 *  exactly once. */
const GIT_READ_SUBCOMMANDS = new Set([
  "log", "show", "diff", "status", "rev-parse", "cat-file", "grep", "blame",
  "describe", "ls-files", "ls-tree", "ls-remote", "shortlog",
  // #204: plumbing that only reports. `git check-ignore` is the one that cost
  // a promotion — the Reviewer ran it to PROVE the secret-protection criterion
  // (`git check-ignore -v .env .env.local`), the classifier called the whole
  // command a write because `check-ignore` was not on this list, and the
  // resulting `secrets-or-auth` approval blocked `app verify` at 16/17 green.
  // A reviewer penalized for doing security verification verifies less.
  "check-ignore", "check-attr", "check-ref-format", "rev-list", "merge-base",
  "name-rev", "for-each-ref", "diff-tree", "diff-index", "diff-files",
  "verify-commit", "verify-tag", "count-objects", "whatchanged", "cherry",
  "annotate", "var",
]);

/** Subcommands that read or write depending on how they are invoked, with the
 *  exact invocations that only read. Anything not listed here fails closed as
 *  a write — `git config user.email x` sets, `git remote add` adds,
 *  `git symbolic-ref HEAD ref` repoints. Deliberately small: a subcommand
 *  earns a place here with evidence, not by looking harmless. */
const GIT_CONDITIONAL_READ_SUBCOMMANDS: Record<string, (args: readonly string[]) => boolean> = {
  // `--get`/`--get-all`/`--get-regexp`/`--get-urlmatch`/`--list`/`-l` report;
  // every other form assigns, unsets, renames, or edits.
  config: (args) =>
    args.some((arg) => /^(?:--get(?:-all|-regexp|-urlmatch)?|--list|-l)$/.test(arg)),
  // `get-url`, `show`, and the bare/verbose listing report; `add`, `remove`,
  // `rename`, `set-url`, `prune`, and `update` change the repository.
  remote: (args) => {
    const verb = args.find((arg) => !arg.startsWith("-") && arg !== "remote");
    return verb === undefined || verb === "get-url" || verb === "show";
  },
};

/** Output redirections. `<`, `<<`, `<<<` and `<&` feed a command its input:
 *  `patch AGENTS.md < p.diff` writes because `patch` writes, and
 *  `while read -r line; do …; done < notes.txt` writes nothing. */
const OUTPUT_REDIRECTS = new Set([">", ">>", "&>", "&>>", ">&"]);

/** True when this invocation mutates in place through a FLAG rather than a
 *  redirection: `sed -i`, `perl -i`, `awk -i inplace`, `sort -o`, and the
 *  `find` actions that act on what they match. `find -exec` can run anything,
 *  so it counts as a write — the ambiguous case fails closed. */
function mutatingFlag(executable: string, args: readonly string[]): boolean {
  switch (executable) {
    case "sed":
    case "gsed":
    case "perl":
    case "ruby":
      // `-i`, `-i.bak`, `-pi`, `--in-place[=SUFFIX]`.
      return args.some((arg) => IN_PLACE_SHORT_FLAG.test(arg) || /^--in-place(?:=|$)/.test(arg));
    case "awk":
    case "gawk":
    case "mawk":
      // `awk -i inplace` loads the in-place extension.
      return args.some((arg) => IN_PLACE_SHORT_FLAG.test(arg) || /^--include(?:=|$)/.test(arg));
    case "sort":
      return args.some((arg) => OUTPUT_SHORT_FLAG.test(arg) || /^--output(?:=|$)/.test(arg));
    case "find":
      return args.some((arg) => FIND_ACTING_PREDICATES.has(arg));
    default:
      return false;
  }
}

/** A short-flag cluster carrying `-i` / `-o` (`-i`, `-i.bak`, `-pi`, `-o`).
 *  Long options are excluded so `--include`/`--output` are matched exactly
 *  rather than by the letter they happen to contain. */
const IN_PLACE_SHORT_FLAG = /^-(?!-)[a-z]*i/;
const OUTPUT_SHORT_FLAG = /^-(?!-)[a-z]*o/;

/** `find` predicates that ACT on what they match rather than print it.
 *  `-exec`/`-ok` can run anything at all, so they fail closed as writes. */
const FIND_ACTING_PREDICATES = new Set([
  "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls",
]);

/** Whether running `executable` with `args` changes files. Order matters: a
 *  mutating flag beats read-only membership (`sed -i` writes), read-only
 *  membership beats the name heuristic (`wc`, `cksum` and `readlink` must never
 *  be read as write verbs), and only then does an unknown program fall back to
 *  its name. */
function mutatesFiles(executable: string, args: readonly string[]): boolean {
  if (MUTATING_EXECUTABLES.has(executable)) return true;
  if (mutatingFlag(executable, args)) return true;
  if (READ_ONLY_EXECUTABLES.has(executable)) return false;
  if (executable === "git") return !gitInvocationReads(args);
  return WRITE_VERB_NAME.test(executable);
}

/** Whether running `executable` with `args` only reads. Deliberately narrower
 *  than `!mutatesFiles`: an unknown program is neither a proven write nor a
 *  proven read, so it leaves the action as `execute`. */
function readsFiles(executable: string, args: readonly string[]): boolean {
  if (executable === "git") return gitInvocationReads(args);
  return READ_ONLY_EXECUTABLES.has(executable) && !mutatingFlag(executable, args);
}

/** Git's own global options, which precede the subcommand. Skipping them is
 *  what makes `git -C <dir> status` a read: the naive "first non-flag argument"
 *  answered `<dir>`, which is in no read set, so every `-C`- or `-c`-prefixed
 *  invocation classified as a write no matter what it actually did (#204).
 *  Narrowing only: a write subcommand behind `-C` still resolves to itself. */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
  "--config-env", "--super-prefix", "--attr-source",
]);

function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index += 1; // its value is not the subcommand
      continue;
    }
    if (arg.startsWith("-")) continue; // valueless global flag, or `--opt=value`
    return arg;
  }
  return "";
}

/** Arguments belonging to the git SUBCOMMAND, i.e. everything after it. The
 *  conditional-read predicates must not see git's own global options. */
function gitSubcommandArgs(args: readonly string[]): readonly string[] {
  const subcommand = gitSubcommand(args);
  const at = args.indexOf(subcommand);
  return at === -1 ? [] : args.slice(at + 1);
}

/** Whether this exact `git` invocation only reports. */
function gitInvocationReads(args: readonly string[]): boolean {
  const subcommand = gitSubcommand(args);
  if (GIT_READ_SUBCOMMANDS.has(subcommand)) return true;
  const conditional = GIT_CONDITIONAL_READ_SUBCOMMANDS[subcommand];
  return conditional !== undefined && conditional(gitSubcommandArgs(args));
}

/** Shell RESERVED WORDS. They are grammar, not programs: `if`, `then`, `for`,
 *  `done` never name an executable, and the pre-ISSUE-019 splitter reported
 *  seven of them as "executables" on one live command. Worse, treating them as
 *  argv[0] SWALLOWED the real command — `if curl --fail --silent URL; then`
 *  projected `if --fail --silent` and no `curl` at all, so an outbound-network
 *  exfil hidden one keyword deep classified ROUTINE. Recognized only in
 *  command position and only unquoted (`grep if src` still searches for "if").
 *  `for`/`select`/`case`/`function` need their own header handling below. */
const RESERVED_WORDS = new Set([
  "if", "then", "elif", "else", "fi",
  "while", "until", "do", "done",
  "esac", "in",
  "{", "}", "!", "time", "coproc",
]);

/** Shell builtins with no reachable effect of their own. They contribute no
 *  executable to the projection; any redirection attached to them is still
 *  captured by the redirect scan (`: > roles.yaml` remains a protocol write).
 *  Suppressed for the same reason as reserved words: `break` is not a program,
 *  and listing it as one both misleads the operator reading the escalation and
 *  dilutes the evidence that names the real effect. */
const INERT_BUILTINS = new Set([
  "break", "continue", "return", "exit", "shift", "true", "false", ":",
  "[", "[[", "]]", "test",
]);

function emptyShellEffects(): ShellEffects {
  return {
    executables: [],
    targets: [],
    redirections: [],
    environment: [],
    writes: false,
    ranCommand: false,
    ranOtherCommand: false,
  };
}

function analyzeShell(raw: string, depth = 0): ShellEffects {
  // A command nested deeper than the projection follows is unanalyzed, not
  // proven harmless: it counts as a non-read-only program so the action cannot
  // be reported as a read.
  if (depth > 4) return { ...emptyShellEffects(), ranCommand: true, ranOtherCommand: true };
  const unwrapped = unwrapCommand(raw);
  // Heredoc payload is data, including any Markdown backticks or illustrative
  // `$()` fragments. Remove it before every executable-intent projection, not
  // only before the top-level tokenizer (ISSUE-019).
  const withoutHeredocs = stripHeredocBodies(unwrapped);
  const nested = extractCommandSubstitutions(withoutHeredocs)
    .map((command) => analyzeShell(command, depth + 1));
  const executableMessages = [...withoutHeredocs.matchAll(MESSAGE_FLAG_ARG)]
    .map((match) => match[1] ?? "")
    .filter(hasExecutableEffect)
    .map((value) => analyzeShell(unquote(value).replace(/\$\{IFS\}/gi, " "), depth + 1));
  const command = stripShellComments(withoutMessageArgs(withoutHeredocs)).replace(/\$\{IFS\}/gi, " ");
  const parsed = parseShell(lexShell(command));
  const effects: ShellEffects = emptyShellEffects();
  const aliases = new Map<string, string>();
  const variables = new Map<string, string>();
  for (const segment of parsed.commands) {
    analyzeSegment(segment, effects, depth, aliases, variables);
  }
  // A `for`/`select`/`case` word list is an OPERAND list the loop body consumes
  // (`for f in .env ~/.ssh/id_rsa; do cat "$f"; done`), so its words are real
  // targets. Only whitespace-free words qualify: a quoted prose word
  // ("secrets.json is fine") is data and must never reach a rule or a scoped
  // grant's pathContains bound (A-005).
  effects.targets.push(...parsed.operands);
  for (const child of nested) mergeShellEffects(effects, child);
  for (const child of executableMessages) mergeShellEffects(effects, child);
  effects.executables = [...new Set(effects.executables)].sort();
  effects.targets = [...new Set(effects.targets)].sort();
  effects.redirections = [...new Set(effects.redirections)].sort();
  effects.environment = [...new Set(effects.environment)].sort();
  return effects;
}

function analyzeSegment(
  tokens: readonly ShellToken[],
  effects: ShellEffects,
  depth: number,
  aliases: Map<string, string>,
  variables: Map<string, string>,
): void {
  const argv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === "redirect") {
      const writesOutput = OUTPUT_REDIRECTS.has(token.text);
      const target = tokens[i + 1];
      if (target === undefined || target.kind !== "word") {
        // A destination the projection cannot name — a process substitution,
        // `2>$(printf /dev/null)`, a truncated tail. Unknown is not harmless:
        // an output redirection with an unresolved target is a write.
        if (writesOutput) effects.writes = true;
        continue;
      }
      i++;
      // `2>&1` / `>&2` duplicate a file descriptor; nothing is written to a
      // path. `>&file` (a real file target) keeps the fail-closed direction.
      const duplicatesFd = (token.text === ">&" || token.text === "<&") &&
        /^-?\d*-?$/.test(target.text);
      // The literal `/dev/null` sink is the ONE known-harmless destination, and
      // only when it is spelled completely: a word left open by an unterminated
      // quote (`2>"/dev/null`) is malformed input, not a proven null sink.
      const literalNullSink = unquote(target.text) === "/dev/null" && target.malformed !== true;
      if (duplicatesFd || literalNullSink) continue;
      effects.redirections.push(target.text);
      effects.targets.push(target.text);
      if (writesOutput) effects.writes = true;
      continue;
    }
    argv.push(token.text);
  }
  if (argv.length === 0) return;

  let cursor = 0;
  while (isAssignment(argv[cursor])) {
    const assignment = argv[cursor]!;
    const equals = assignment.indexOf("=");
    const name = assignment.slice(0, equals);
    effects.environment.push(name);
    variables.set(name.toLowerCase(), assignment.slice(equals + 1));
    cursor++;
  }
  while (["sudo", "command", "builtin", "nohup", "exec"].includes(baseExecutable(argv[cursor] ?? ""))) cursor++;
  if (baseExecutable(argv[cursor] ?? "") === "env") {
    cursor++;
    while (cursor < argv.length && (argv[cursor]!.startsWith("-") || isAssignment(argv[cursor]))) {
      if (isAssignment(argv[cursor])) {
        const assignment = argv[cursor]!;
        const equals = assignment.indexOf("=");
        const name = assignment.slice(0, equals);
        effects.environment.push(name);
        variables.set(name.toLowerCase(), assignment.slice(equals + 1));
      }
      cursor++;
    }
  }
  // `env KEY=value command kubectl ...` is the common nested-wrapper form;
  // peel command/builtin/nohup/exec again after env consumed its assignments.
  while (["sudo", "command", "builtin", "nohup", "exec"].includes(baseExecutable(argv[cursor] ?? ""))) cursor++;
  if (baseExecutable(argv[cursor] ?? "") === "xargs") {
    cursor++;
    while (cursor < argv.length && argv[cursor]!.startsWith("-")) cursor++;
  }
  const executable = baseExecutable(argv[cursor] ?? "");
  if (executable === "") return;
  const args = argv.slice(cursor + 1);

  const variableName = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(argv[cursor] ?? "")?.[1]?.toLowerCase();
  const variableCommand = variableName === undefined ? undefined : variables.get(variableName);
  if (variableCommand !== undefined) {
    mergeShellEffects(effects, analyzeShell([variableCommand, ...args].join(" "), depth + 1));
    return;
  }

  if (executable === "alias") {
    for (const definition of args) {
      const equals = definition.indexOf("=");
      if (equals > 0) aliases.set(definition.slice(0, equals).toLowerCase(), definition.slice(equals + 1));
    }
    return;
  }
  const alias = aliases.get(executable);
  if (alias !== undefined) {
    mergeShellEffects(effects, analyzeShell([alias, ...args].join(" "), depth + 1));
    return;
  }

  if (executable === "export") {
    for (const assignment of args.filter(isAssignment)) {
      const equals = assignment.indexOf("=");
      const name = assignment.slice(0, equals);
      effects.environment.push(name);
      variables.set(name.toLowerCase(), assignment.slice(equals + 1));
    }
    return;
  }
  if (executable === "unset") {
    effects.environment.push(...args.filter((arg) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)));
    return;
  }

  if (["bash", "sh", "zsh", "ksh", "dash"].includes(executable)) {
    // Any combined flag cluster ending in `c` carries the script: `-c`, and the
    // login/interactive forms `-lc` / `-ic` / `-lic` the adapters actually emit
    // (`/bin/zsh -lc '<script>'` is the exact shape of every captured run-3
    // approval). The script is a nested command, not an argument.
    const commandIndex = args.findIndex((arg) => /^-[a-z]*c$/.test(arg));
    if (commandIndex !== -1 && args[commandIndex + 1] !== undefined) {
      mergeShellEffects(effects, analyzeShell(args[commandIndex + 1]!, depth + 1));
      return;
    }
    const script = args.find((arg) => !arg.startsWith("-"));
    if (script !== undefined) effects.targets.push(script);
  }
  if (executable === "eval" && args[0] !== undefined) {
    mergeShellEffects(effects, analyzeShell(args.join(" "), depth + 1));
    return;
  }
  // A no-effect builtin names no program. Its redirections were already
  // captured above, so suppressing it here removes noise without removing
  // evidence.
  if (INERT_BUILTINS.has(executable)) return;

  effects.executables.push(executable);
  // A read-only utility contributes no write signal whichever paths it names
  // (ISSUE-027 rule 1); everything else is at least unproven, and a proven
  // mutation makes the whole action a write (rule 2).
  effects.ranCommand = true;
  if (!readsFiles(executable, args)) {
    effects.ranOtherCommand = true;
    if (mutatesFiles(executable, args)) effects.writes = true;
  }
  const relevant = relevantArguments(executable, args);
  effects.targets.push(...relevant.targets);
  // Render structured command verbs into the executable projection. This
  // preserves rule matching without retaining free-text values.
  if (relevant.verb !== "") effects.executables.push(`${executable} ${relevant.verb}`);
}

function relevantArguments(executable: string, args: string[]): { verb: string; targets: string[] } {
  if (["echo", "printf", "logger"].includes(executable)) return { verb: "", targets: [] };
  if (["rg", "ripgrep", "grep", "egrep", "fgrep"].includes(executable)) {
    return searchArguments(args);
  }
  if (executable === "git") return gitArguments(args);
  if (executable === "gh") return ghArguments(args);
  // Script-then-files tools: the first positional is the PROGRAM (data — a
  // `s/a/b/` expression is not a path), everything after it is a file operand.
  // `perl`/`ruby` join `sed`/`awk` here because `perl -i -pe … AGENTS.md`
  // rewrites the file it names and must reach the rules with that name.
  if (["sed", "gsed", "awk", "gawk", "mawk", "perl", "ruby"].includes(executable)) {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    return { verb: mutatingFlag(executable, args) ? "-i" : "", targets: positional.slice(1) };
  }
  // `find` carries its operands and its actions in one flag soup: the paths it
  // names must reach the rules (`find . -name AGENTS.md -delete` is a protocol
  // write) while `{}` and `;` are punctuation, not files.
  if (executable === "find") {
    return {
      verb: args.filter((arg) => arg.startsWith("-")).join(" "),
      targets: args.filter((arg) => !arg.startsWith("-") && looksLikePathOrUrl(arg)),
    };
  }
  // `dd` names its destination in `of=`, not positionally.
  if (executable === "dd") {
    return {
      verb: "",
      targets: args.filter((arg) => /^(?:if|of)=./.test(arg)).map((arg) => arg.slice(3)),
    };
  }
  if (FILE_ARGUMENT_TOOLS.has(executable)) {
    return { verb: "", targets: args.filter((arg) => !arg.startsWith("-") && arg !== "-") };
  }
  // `cormidia` and `npx` are multiplexers too. Without the verb, every `cormidia`
  // invocation projected to the bare executable plus its flags, so
  // `cormidia app reset --execute` and `cormidia roles` were the same action to
  // every rule — which is how the CLI's own human-gated verbs classified
  // routine while the shell equivalents of the same effects did not.
  if (["kubectl", "doctl", "npm", "pnpm", "npx", "cormidia", "helm", "terraform", "docker", "gcloud", "aws", "curl", "wget", "nc", "ncat", "scp", "sftp", "telnet"].includes(executable)) {
    return {
      verb: leadingSubcommands(args).join(" "),
      targets: args.filter(looksLikePathOrUrl),
    };
  }
  return { verb: args.filter((arg) => arg.startsWith("-")).join(" "), targets: [] };
}

/** The leading SUBCOMMAND words of a multiplexer CLI (`kubectl config
 *  set-credentials`, `doctl apps create-deployment`, `npm publish`), stopping
 *  at the first positional that is an OPERAND rather than a subcommand. A
 *  subcommand is a lowercase word, optionally hyphen/colon-segmented; a host,
 *  port, path, id, or version is not. Without the stop rule, operands rode into
 *  the executable projection — `pnpm preview 127.0.0.1 1` in the run-3 capture
 *  — which reads as an executable named after a host and buries the real verb.
 *  Three words is the longest verb any rule needs. */
function leadingSubcommands(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    if (!/^[a-z][a-z0-9]*(?:[-:][a-z0-9]+)*$/.test(arg)) break;
    out.push(arg);
    if (out.length === 3) break;
  }
  return out;
}

function searchArguments(args: string[]): { verb: string; targets: string[] } {
  const positional: string[] = [];
  const optionsWithValue = new Set(["-e", "--regexp", "-g", "--glob", "-t", "--type", "--type-add"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (optionsWithValue.has(arg)) { i++; continue; }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  // First positional is the pattern (data); remaining positionals are paths.
  return { verb: "search", targets: positional.slice(1) };
}

function gitArguments(args: string[]): { verb: string; targets: string[] } {
  const subcommand = gitSubcommand(args);
  if (subcommand === "") return { verb: "", targets: [] };
  // Everything after `--` is a PATHSPEC, whichever subcommand it belongs to.
  // Only the read subcommands used to project it, so `git diff -- AGENTS.md`
  // (a read) reached the rules with its path while `git checkout -- AGENTS.md`
  // (which overwrites that file) reached them with no path at all and could
  // never match protocol-self-edit.
  const delimiter = args.indexOf("--");
  const targets = delimiter === -1 ? [] : args.slice(delimiter + 1);
  if (gitInvocationReads(args)) return { verb: subcommand, targets };
  return {
    verb: [subcommand, ...args.filter((arg) => /^(?:--force|--force-with-lease|--force-push|-f)$/.test(arg))].join(" "),
    targets,
  };
}

function ghArguments(args: string[]): { verb: string; targets: string[] } {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg === "--admin");
  const verbParts = positional[0] === "api" ? ghApiVerbParts(args) : positional.slice(0, 2);
  const verb = [...verbParts, ...flags].join(" ");
  const targets: string[] = [];
  if (positional[0] === "gist" && positional[1] === "create") targets.push(...positional.slice(2));
  for (let i = 0; i < args.length; i++) {
    if (["--repo", "-R", "--body-file"].includes(args[i]!) && args[i + 1] !== undefined) {
      const value = args[++i]!;
      if (value !== "-") targets.push(value);
    }
  }
  return { verb, targets };
}

/** `gh api` flags that take a separate VALUE which must never be mistaken for
 *  the endpoint (`-H "Accept: …"`, `--jq .name`, `-t <template>`, …). */
const GH_API_VALUE_FLAGS = new Set([
  "-H", "--header", "--hostname", "--jq", "-q", "-t", "--template",
  "--cache", "-p", "--preview",
]);

/** Body-carrying `gh api` flags. Their presence with no explicit method is the
 *  CLI's documented implicit-POST form: `gh api repos/o/r/issues -f title=x`
 *  CREATES an issue with no `--method` in sight. */
const GH_API_BODY_FLAG = /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)/;
const GH_API_BODY_FLAG_INLINE = /^-[fF].+/;

const GH_API_METHODS = new Set(["get", "head", "post", "put", "patch", "delete"]);

/** Canonical projection of a `gh api` invocation: `["api", <method>,
 *  <endpoint>]` — lowercase method, `unknown` when a method flag's value could
 *  not be resolved or names no known HTTP verb (unknown is MUTATING to the
 *  router: an unproven read fails closed). The method must be surfaced HERE
 *  (HB-010): the old projection kept raw positionals only, so `--method PUT`
 *  reached the rules by accident of word order and `--method=PUT` / `-XPUT` /
 *  the implicit-POST field forms not at all — a self-merge spelled
 *  `gh api --method PUT repos/o/r/pulls/7/merge` classified ROUTINE. */
function ghApiVerbParts(args: readonly string[]): string[] {
  let method: string | null = null;
  let implicitPost = false;
  let endpoint: string | null = null;
  let sawApi = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--method" || arg === "-X") {
      const value = args[i + 1];
      // A method flag whose value cannot be resolved is not a proven read.
      if (value === undefined || value.startsWith("-")) {
        method = "unknown";
        continue;
      }
      method = value.toLowerCase();
      i++;
      continue;
    }
    const inline = /^(?:--method=|-X=?)(.+)$/.exec(arg);
    if (inline !== null) {
      method = inline[1]!.toLowerCase();
      continue;
    }
    if (GH_API_BODY_FLAG.test(arg) || GH_API_BODY_FLAG_INLINE.test(arg)) {
      implicitPost = true;
      if (/^(?:-f|-F|--field|--raw-field|--input)$/.test(arg)) i++;
      continue;
    }
    if (GH_API_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (!sawApi) {
      sawApi = arg === "api";
      continue;
    }
    // First whitespace-free positional after `api` is the endpoint; a word
    // with spaces is a quoted data value, never a path.
    if (endpoint === null && !/\s/.test(arg)) endpoint = arg;
  }
  const resolved = method ?? (implicitPost ? "post" : "get");
  const canonical = GH_API_METHODS.has(resolved) ? resolved : "unknown";
  return endpoint === null ? ["api", canonical] : ["api", canonical, endpoint];
}

/** One lexed shell token. `kind` separates grammar from data so the parser
 *  below never has to re-guess whether `>` is a redirection or a filename, and
 *  `quoted` keeps a quoted reserved word (`grep "if" src`) from being read as
 *  grammar. */
interface ShellToken {
  text: string;
  kind: "word" | "control" | "redirect";
  quoted: boolean;
  /** The word ran off the end of the input inside an unterminated quote, so its
   *  text is a guess. Only the known-harmless `/dev/null` sink cares: a
   *  malformed word may never be treated as one. */
  malformed?: boolean;
}

/** Operator table, longest match first. Everything the classifier needs to see
 *  a command boundary: pipelines, `&&`/`||`/`;` sequencing, background `&`,
 *  case `;;`, subshell parentheses, and every redirection form. */
const SHELL_OPERATORS: readonly { text: string; kind: "control" | "redirect" }[] = [
  { text: "&>>", kind: "redirect" },
  { text: "<<<", kind: "redirect" },
  { text: "<<-", kind: "redirect" },
  { text: "&&", kind: "control" },
  { text: "||", kind: "control" },
  { text: ";;", kind: "control" },
  { text: "&>", kind: "redirect" },
  { text: ">>", kind: "redirect" },
  { text: "<<", kind: "redirect" },
  { text: ">&", kind: "redirect" },
  { text: "<&", kind: "redirect" },
  { text: "|", kind: "control" },
  { text: "&", kind: "control" },
  { text: ";", kind: "control" },
  { text: "(", kind: "control" },
  { text: ")", kind: "control" },
  { text: ">", kind: "redirect" },
  { text: "<", kind: "redirect" },
];

/** Lex a command into words and operators. This replaces whitespace splitting:
 *  a token knows whether it is grammar or data, quoting is honoured, an IO
 *  number (`2` in `2>&1`) is consumed by its redirection instead of becoming an
 *  argument, and `$(` opens a substitution rather than producing a `$` word. */
function lexShell(command: string): ShellToken[] {
  const out: ShellToken[] = [];
  let text = "";
  let quoted = false;
  let malformed = false;
  let quote: "'" | '"' | null = null;
  const flushWord = (): void => {
    if (text !== "") out.push(malformed ? { text, kind: "word", quoted, malformed } : { text, kind: "word", quoted });
    text = "";
    quoted = false;
    malformed = false;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && command[i + 1] !== undefined) text += command[++i]!;
      else text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; quoted = true; continue; }
    if (ch === "\\" && command[i + 1] !== undefined) { text += command[++i]!; continue; }
    if (/\s/.test(ch)) {
      flushWord();
      if (ch === "\n") out.push({ text: "\n", kind: "control", quoted: false });
      continue;
    }
    // A backtick substitution's body is analyzed separately
    // (extractCommandSubstitutions); here it is only a command boundary.
    if (ch === "`") { flushWord(); out.push({ text: "`", kind: "control", quoted: false }); continue; }
    const operator = SHELL_OPERATORS.find((candidate) => command.startsWith(candidate.text, i));
    if (operator !== undefined) {
      if (operator.kind === "redirect" && !quoted && /^\d+$/.test(text)) {
        // Leading IO number: `2>file` redirects fd 2, it does not run `2`.
        text = "";
      } else if (operator.text === "(" && !quoted && text.endsWith("$")) {
        text = text.slice(0, -1);
      }
      flushWord();
      out.push({ text: operator.text, kind: operator.kind, quoted: false });
      i += operator.text.length - 1;
      continue;
    }
    text += ch;
  }
  // An unterminated quote swallowed the rest of the input, so the word it
  // produced is a reconstruction rather than the shell's own reading.
  if (quote !== null) malformed = true;
  flushWord();
  return out;
}

interface ParsedShell {
  /** One token list per simple command, reserved words removed. */
  commands: ShellToken[][];
  /** `for`/`select`/`case` word-list operands (see analyzeShell). */
  operands: string[];
}

/**
 * Split lexed tokens into SIMPLE COMMANDS, honouring shell grammar (ISSUE-019).
 *
 * The pre-fix splitter had no grammar at all: every whitespace-separated token
 * was a candidate executable, so reserved words were reported as programs and —
 * far worse — a reserved word in argv[0] hid the real command behind it. This
 * walk understands compound commands (`if`/`while`/`until`/`for`/`select`/
 * `case`/`{...}`/`function`), pipelines, `&&`/`||`/`;`/`&` sequencing,
 * subshells, and redirections, so `curl` inside an `if` condition reaches the
 * outbound-network rule exactly as it would at the top level.
 *
 * Deliberately NOT a full shell parser: it does not expand anything, and every
 * construct it does not recognize degrades to "treat these words as a command",
 * which is the over-detecting direction.
 */
function parseShell(tokens: readonly ShellToken[]): ParsedShell {
  const commands: ShellToken[][] = [];
  const operands: string[] = [];
  let segment: ShellToken[] = [];
  let mode: "normal" | "loop-header" | "case-header" | "function-name" = "normal";
  let sawLoopIn = false;
  let caseDepth = 0;
  let casePattern = false;
  let patternSawWord = false;
  const flush = (): void => {
    if (segment.length > 0) commands.push(segment);
    segment = [];
  };
  const inCommandPosition = (): boolean => !segment.some((token) => token.kind === "word");

  for (const token of tokens) {
    if (casePattern) {
      // `pattern|other)` is a match list, not a command. Two escapes matter as
      // much as the `)`, because the skip is BLIND and a blind classifier is a
      // safety hole, not a false-negative curiosity:
      //   1. `esac` closes the statement without any `)`. The `;;` ending the
      //      last arm re-arms the skip, so without this every command after
      //      the `esac` — `gh pr create`, `kubectl apply`, `rm -rf` — would be
      //      invisible for the rest of the script.
      //   2. An unquoted pattern list cannot span a newline, so a newline
      //      after a pattern word (and not after a `|` continuation) means the
      //      text is not a match list at all. Give up and re-read it as a
      //      command: over-detecting is the safe direction, staying blind is
      //      not.
      if (token.kind === "word" && !token.quoted && token.text === "esac") {
        casePattern = false;
        if (caseDepth > 0) caseDepth--;
        flush();
        continue;
      }
      if (token.kind === "control" && token.text === ")") { casePattern = false; continue; }
      if (token.kind === "control" && token.text === "|") { patternSawWord = false; continue; }
      if (token.kind === "control" && token.text === "\n" && patternSawWord) {
        casePattern = false;
        continue;
      }
      if (token.kind === "word") patternSawWord = true;
      continue;
    }
    if (mode === "loop-header") {
      if (token.kind === "control") {
        if (token.text === ";" || token.text === "\n") mode = "normal";
        continue;
      }
      if (token.kind === "redirect") continue;
      if (!token.quoted && token.text === "do") { mode = "normal"; continue; }
      if (!token.quoted && token.text === "in" && !sawLoopIn) { sawLoopIn = true; continue; }
      // Whitespace-free words only (a quoted prose word is data), and never a
      // bare number — `for attempt in 1 2 3 4 5` is a counter, not a path.
      if (sawLoopIn && !/\s/.test(token.text) && !/^\d+$/.test(token.text)) {
        operands.push(token.text);
      }
      continue;
    }
    if (mode === "case-header") {
      if (token.kind === "control") {
        if (token.text === ";" || token.text === "\n") mode = "normal";
        continue;
      }
      if (token.kind === "word" && !token.quoted && token.text === "in") {
        mode = "normal";
        casePattern = true;
        patternSawWord = false;
      }
      continue;
    }
    if (mode === "function-name") {
      if (token.kind === "word") mode = "normal";
      continue;
    }
    if (token.kind === "control") {
      flush();
      if (token.text === ";;" && caseDepth > 0) { casePattern = true; patternSawWord = false; }
      continue;
    }
    if (token.kind === "redirect") {
      segment.push(token);
      continue;
    }
    if (!token.quoted && inCommandPosition()) {
      if (token.text === "esac") {
        if (caseDepth > 0) caseDepth--;
        flush();
        continue;
      }
      if (RESERVED_WORDS.has(token.text)) { flush(); continue; }
      if (token.text === "for" || token.text === "select") {
        flush();
        mode = "loop-header";
        sawLoopIn = false;
        continue;
      }
      if (token.text === "case") {
        flush();
        caseDepth++;
        mode = "case-header";
        continue;
      }
      if (token.text === "function") { flush(); mode = "function-name"; continue; }
    }
    segment.push(token);
  }
  flush();
  return { commands, operands };
}

/** Remove shell comments without interpreting quoted `#` characters. Exported
 * so grant-scope matching uses the same parser boundary as classification. */
export function stripShellComments(command: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(command[i - 1]!))) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function stripHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  let delimiter: string | undefined;
  for (const line of lines) {
    if (delimiter !== undefined) {
      if (line.trim() === delimiter) delimiter = undefined;
      continue;
    }
    const delimiters: string[] = [];
    const header = line.replace(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g, (_match, a: string, b: string, c: string) => {
      delimiters.push(a || b || c);
      return " ";
    });
    out.push(header);
    delimiter = delimiters[0];
  }
  return out.join("\n");
}

function extractCommandSubstitutions(command: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < command.length; i++) {
    if (command[i] === "$" && command[i + 1] === "(") {
      let depth = 1;
      let body = "";
      i += 2;
      for (; i < command.length && depth > 0; i++) {
        const ch = command[i]!;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth > 0) body += ch;
      }
      out.push(body);
      i--;
    } else if (command[i] === "`") {
      let body = "";
      for (i++; i < command.length && command[i] !== "`"; i++) body += command[i]!;
      if (body !== "") out.push(body);
    }
  }
  return out;
}

function mergeShellEffects(target: ShellEffects, source: ShellEffects): void {
  target.executables.push(...source.executables);
  target.targets.push(...source.targets);
  target.redirections.push(...source.redirections);
  target.environment.push(...source.environment);
  target.writes ||= source.writes;
  target.ranCommand ||= source.ranCommand;
  target.ranOtherCommand ||= source.ranOtherCommand;
}

function isAssignment(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function baseExecutable(value: string): string {
  return value.split("/").pop()?.toLowerCase() ?? "";
}

function unquote(value: string): string {
  return value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function looksLikePathOrUrl(value: string): boolean {
  return /^(?:\.?\.?\/|\/|~\/|\$[A-Za-z_]|https?:\/\/)/.test(value) || /\.[A-Za-z0-9_-]+$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isShellTool(tool: string): boolean {
  return ["bash", "shell", "sh", "zsh", "terminal", "exec", "exec_command"].includes(tool);
}

function isDataMutationTool(tool: string): boolean {
  return /^(?:write|edit|create|replace|append|delete|remove|move|copy)(?:$|[_-])/.test(tool);
}

/** A literal `/dev/null` sink cannot mutate a path merely named elsewhere in a
 * compound read command. Keep every other redirect material: real targets,
 * variables, substitutions, and malformed/ambiguous syntax all remain
 * fail-closed. Used only for actions with NO parsable command — a shell action
 * gets the structural redirect scan in `analyzeSegment` instead, which is what
 * ISSUE-027 turned on: this regex's sink exemption only fired before whitespace
 * or end-of-string, so the closing quote of `/bin/zsh -lc '… 2>/dev/null'` made
 * the null sink look like a real redirect and a `wc -l` a protocol write. */
function hasMaterialRedirect(command: string): boolean {
  const withoutLiteralNullSinks = command.replace(
    /\d*>>?\s*(?:"\/dev\/null"|'\/dev\/null'|\/dev\/null)(?=$|[\s;|&])/g,
    "",
  );
  return />>?(?!&)/.test(withoutLiteralNullSinks);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

/** Decode common execution wrappers without executing anything. This makes
 * semantically identical shell actions classify identically across adapters. */
function unwrapCommand(value: string): string {
  let command = value.trim();
  try {
    command = decodeURIComponent(command);
  } catch {
    // Invalid percent escapes remain literal and still pass ordinary rules.
  }
  for (let depth = 0; depth < 4; depth++) {
    const wrapper = /^(?:(?:sudo|command)\s+|(?:\/usr\/bin\/)?env(?:\s+[A-Za-z_][A-Za-z0-9_]*=[^\s]+)*\s+)*(?:bash|sh|zsh)\s+-c\s+(["'])([\s\S]*)\1$/.exec(command);
    if (wrapper?.[2] !== undefined) {
      command = wrapper[2].trim();
      continue;
    }
    const evaluated = /^eval\s+(["'])([\s\S]*)\1$/.exec(command);
    if (evaluated?.[2] !== undefined) {
      command = evaluated[2].trim();
      continue;
    }
    break;
  }
  const encoded = /(?:echo|printf)\s+['"]?([A-Za-z0-9+/]{12,}={0,2})['"]?\s*\|\s*base64\s+(?:--decode|-d)\b/.exec(command);
  if (encoded?.[1] !== undefined) {
    try {
      const decoded = Buffer.from(encoded[1], "base64").toString("utf8");
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) command = `${command}; ${decoded}`;
    } catch {
      // Malformed base64 remains literal.
    }
  }
  // Preserve line boundaries: heredoc payloads are data and the shell parser
  // needs their delimiters intact to exclude them from executable intent.
  return command.trim();
}
