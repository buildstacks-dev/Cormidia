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
  return command.replace(
    /(?:^|\s)(?:--body|--message|--subject|--description|--notes|--title|-m)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi,
    (match: string, value: string) => (hasExecutableEffect(value) ? match : " "),
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

function classificationCommand(semantic: SemanticAction): string {
  return semantic.command === null ? "" : withoutMessageArgs(semantic.command);
}

export function semanticActionText(action: ToolAction): string {
  const semantic = normalizeSemanticAction(action);
  return [semantic.tool, semantic.operation, classificationCommand(semantic), ...semantic.paths]
    .join(" ")
    .toLowerCase();
}

const asText = (a: ToolAction): string => semanticActionText(a);
const effectText = (a: ToolAction): string => {
  const semantic = normalizeSemanticAction(a);
  return `${semantic.tool} ${classificationCommand(semantic)}`.toLowerCase();
};

/** v0 heuristics. Deliberately over-broad: false positives cost a human tap,
 *  false negatives cost an incident. Tighten with calibration data. */
export const CRITICAL_RULES: CriticalRule[] = [
  {
    name: "production-deploy",
    matches: (a) => /\b(deploy|rollout|release to prod|kubectl apply|doctl apps)\b/.test(effectText(a)),
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
      const rm = /\brm\s+(-[a-z]*\s+)*([^\s;|&]+)/.exec(t);
      if (rm === null || !/\brm\s+-[a-z]*r/.test(t)) return false;
      const target = rm[2] ?? "";
      return (
        target.startsWith("/") ||
        target.startsWith("~") ||
        target.startsWith("$home") ||
        target.includes("..")
      );
    },
  },
  {
    name: "dns-or-domain",
    matches: (a) => /\b(dns record|nameserver|domain transfer)\b/.test(effectText(a)),
  },
  {
    name: "external-publishing",
    matches: (a) => /\b(publish|post publicly|send email|tweet|npm publish)\b/.test(effectText(a)),
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
      return /\b(secrets?|api[_ ]?key|credentials?|rotate key|oauth client)\b|\.env\b|\b(id_rsa|id_ed25519)\b|\.(pem|npmrc|netrc)\b/.test(
        scrubbed,
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

/** Default policy: routine ops flow, critical ops are denied and escalated
 *  to the human approval surface. */
export const defaultGate: GateFn = (action: ToolAction): GateDecision => {
  const { cls, rule } = classify(action);
  if (cls === "critical") {
    return {
      allow: false,
      reason: `critical op (${rule}) requires human approval`,
      escalate: true,
    };
  }
  return { allow: true };
};

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
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) command = `${command} ${decoded}`;
    } catch {
      // Malformed base64 remains literal.
    }
  }
  return command.replace(/\s+/g, " ").trim();
}
