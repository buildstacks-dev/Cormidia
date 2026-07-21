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
  const tool = action.tool.trim().toLowerCase();
  if (VERDICT_TOOLS.has(tool)) {
    return { tool, operation: "return_data", command: null, paths: [], destination: "orchestrator", effect: "typed_data" };
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
  const operation = VERDICT_TOOLS.has(tool)
    ? "return_data" as const
    : isDataMutationTool(tool) || (command !== null && shellWrites(command))
      ? "write" as const
      : /(?:^|[_-])(read|view|get)(?:$|[_-])/.test(tool)
        ? "read" as const
        : command !== null || isShellTool(tool)
          ? "execute" as const
          : "unknown" as const;
  const destination = typeof input?.["destination"] === "string" ? input["destination"].trim().toLowerCase() : null;
  const effect = typeof input?.["effect"] === "string" ? input["effect"].trim().toLowerCase() : null;
  return { tool, operation, command, paths, destination, effect };
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
    // Calibrated (Stage 6, approval-and-release-amendment): irreversible
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
        a.tool.toLowerCase() === "operon.github.issue.create" ||
        a.tool.toLowerCase() === "operon.github.issue.comment"
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
    // fetch while closing the leak path (docs/loop.md gate philosophy).
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
      return /\bgh\s+pr\s+(?:merge|review)\b/.test(t) || (/\bgh\b/.test(t) && /--admin\b/.test(t));
    },
  },
  {
    name: "protocol-self-edit", // agents don't rewrite their own rules
    matches: (a) => isWrite(a) && isProtocolSurface(asText(a)),
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
    // (learning/**) and the app repo (.operon/learning/**) alike. Only the
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
    matches: (a) => isWrite(a) && /\bapprovals\/(grants|pending|decided|log\.jsonl)\b/.test(asText(a)),
  },
];

function isWrite(a: ToolAction): boolean {
  const semantic = normalizeSemanticAction(a);
  if (semantic.operation === "write") return true;
  const t = asText(a);
  // Verbs are prefix-matched (append → appends); cp/tee are whole-word to
  // avoid cpu/teed false hits. Shell redirects get their own test: the old
  // `\b>\s` alternative was unsatisfiable after whitespace (no word
  // boundary exists between a space and `>`), so `echo x > roles.yaml`
  // classified routine. `>&` fd-duplication (2>&1) is not a file write.
  return /\b(write|edit|create|replace|append|mv|cp\b|tee\b|rm|sed -i)/.test(t) || hasMaterialRedirect(t);
}

/** Exact protocol filenames, matched anywhere in the repo tree (e.g. root
 *  `roles.yaml`, an app's `.operon/TASTE.md`, a nested `apps.yaml`). */
const PROTOCOL_FILENAMES =
  /\b(taste\.md|roles\.yaml|agents\.md|purpose\.md|pipelines\.yaml|apps\.yaml)\b/;

/** Path-qualified protocol directories, where the file basename varies and so
 *  the exact-filename check above can't catch it — e.g. `taste/reviewer.md`
 *  (role craft addenda; distinct from the root `TASTE.md` constitution) and
 *  `prompts/build/contract.md` (pass templates, docs/loop.md §2 rule 2). The
 *  old `\btaste\.md\b`-only check missed these: "taste/reviewer.md" has no
 *  "taste.md" substring. */
const PROTOCOL_DIRS = /\b(taste|prompts)\/[^\s"']+/;

/** `.operon/config.yaml` (app bootstrap config) doesn't share a basename with
 *  any of the above, so it gets its own exact match. */
const PROTOCOL_CONFIG_FILE = /\.operon\/config\.yaml\b/;

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
  const semantic = normalizeSemanticAction(action);
  const input = asRecord(action.input);
  const inputEnvironment = asRecord(input?.["env"] ?? input?.["environment"]);
  const environment = inputEnvironment === undefined ? [] : Object.keys(inputEnvironment).sort();
  if (semantic.command === null) {
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
  const shell = analyzeShell(semantic.command);
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
}

const FILE_ARGUMENT_TOOLS = new Set([
  "cat", "head", "tail", "less", "more", "wc", "stat", "readlink", "realpath",
  "rm", "mv", "cp", "tee", "touch", "chmod", "chown", "source", ".",
]);

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

function analyzeShell(raw: string, depth = 0): ShellEffects {
  if (depth > 4) return { executables: [], targets: [], redirections: [], environment: [] };
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
  const effects: ShellEffects = { executables: [], targets: [], redirections: [], environment: [] };
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
      const target = tokens[i + 1];
      if (target === undefined || target.kind !== "word") continue;
      i++;
      // `2>&1` / `>&2` duplicate a file descriptor; nothing is written to a
      // path. `>&file` (a real file target) keeps the fail-closed direction.
      const duplicatesFd = (token.text === ">&" || token.text === "<&") &&
        /^-?\d*-?$/.test(target.text);
      if (duplicatesFd || unquote(target.text) === "/dev/null") continue;
      effects.redirections.push(target.text);
      effects.targets.push(target.text);
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
  while (["sudo", "command", "builtin", "nohup"].includes(baseExecutable(argv[cursor] ?? ""))) cursor++;
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
  // peel command/builtin/nohup again after env consumed its assignments.
  while (["sudo", "command", "builtin", "nohup"].includes(baseExecutable(argv[cursor] ?? ""))) cursor++;
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
  if (executable === "sed" || executable === "awk") {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    return { verb: executable === "sed" && args.includes("-i") ? "-i" : "", targets: positional.slice(1) };
  }
  if (FILE_ARGUMENT_TOOLS.has(executable)) {
    return { verb: "", targets: args.filter((arg) => !arg.startsWith("-") && arg !== "-") };
  }
  if (["kubectl", "doctl", "npm", "pnpm", "helm", "terraform", "docker", "gcloud", "aws", "curl", "wget", "nc", "ncat", "scp", "sftp", "telnet"].includes(executable)) {
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
  const subcommand = args.find((arg) => !arg.startsWith("-")) ?? "";
  if (subcommand === "") return { verb: "", targets: [] };
  if (["log", "show", "diff", "grep", "status"].includes(subcommand)) {
    const delimiter = args.indexOf("--");
    return { verb: subcommand, targets: delimiter === -1 ? [] : args.slice(delimiter + 1) };
  }
  return {
    verb: [subcommand, ...args.filter((arg) => /^(?:--force|--force-with-lease|--force-push|-f)$/.test(arg))].join(" "),
    targets: [],
  };
}

function ghArguments(args: string[]): { verb: string; targets: string[] } {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg === "--admin");
  const verbParts = positional[0] === "api" ? positional.slice(0, 3) : positional.slice(0, 2);
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

/** One lexed shell token. `kind` separates grammar from data so the parser
 *  below never has to re-guess whether `>` is a redirection or a filename, and
 *  `quoted` keeps a quoted reserved word (`grep "if" src`) from being read as
 *  grammar. */
interface ShellToken {
  text: string;
  kind: "word" | "control" | "redirect";
  quoted: boolean;
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
  let quote: "'" | '"' | null = null;
  const flushWord = (): void => {
    if (text !== "") out.push({ text, kind: "word", quoted });
    text = "";
    quoted = false;
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
  const flush = (): void => {
    if (segment.length > 0) commands.push(segment);
    segment = [];
  };
  const inCommandPosition = (): boolean => !segment.some((token) => token.kind === "word");

  for (const token of tokens) {
    if (casePattern) {
      // `pattern|other)` is a match list, not a command.
      if (token.kind === "control" && token.text === ")") casePattern = false;
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
      }
      continue;
    }
    if (mode === "function-name") {
      if (token.kind === "word") mode = "normal";
      continue;
    }
    if (token.kind === "control") {
      flush();
      if (token.text === ";;" && caseDepth > 0) casePattern = true;
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

function shellWrites(command: string): boolean {
  const normalized = command.toLowerCase();
  return hasMaterialRedirect(normalized) || /\b(?:rm|mv|cp|tee|sed\s+-i)\b/.test(normalized);
}

/** A literal `/dev/null` sink cannot mutate the protocol path merely named
 * elsewhere in a compound read command. Keep every other redirect material:
 * real targets, variables, substitutions, and malformed/ambiguous syntax all
 * remain fail-closed. Removing the null redirect before the ordinary scan also
 * preserves a real write in commands such as
 * `echo x > AGENTS.md 2>/dev/null`. */
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
