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

const asText = (a: ToolAction): string =>
  `${a.tool} ${JSON.stringify(a.input ?? "")} ${a.description ?? ""}`.toLowerCase();

/** v0 heuristics. Deliberately over-broad: false positives cost a human tap,
 *  false negatives cost an incident. Tighten with calibration data. */
export const CRITICAL_RULES: CriticalRule[] = [
  {
    name: "production-deploy",
    matches: (a) => /\b(deploy|rollout|release to prod|kubectl apply|doctl apps)\b/.test(asText(a)),
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
    matches: (a) => /\b(dns record|nameserver|domain transfer)\b/.test(asText(a)),
  },
  {
    name: "external-publishing",
    matches: (a) => /\b(publish|post publicly|send email|tweet|npm publish)\b/.test(asText(a)),
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
    matches: (a) => /\b(curl|wget|ncat|nc|scp|sftp|telnet)\b/.test(asText(a)),
  },
  {
    // Self-merge / self-approve bypasses the review boundary the whole org
    // depends on: an agent must never merge its own PR, approve a review, or
    // use an --admin override. The orchestrator's own merges do not pass
    // through this gate (they are GhOps, not agent tool calls).
    name: "self-merge-or-approve",
    matches: (a) => {
      const t = asText(a);
      return (
        /\bgh\s+pr\s+merge\b/.test(t) ||
        (/\bgh\s+pr\s+review\b/.test(t) && /--approve\b/.test(t)) ||
        (/\bgh\b/.test(t) && /--admin\b/.test(t))
      );
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
  const t = asText(a);
  // Verbs are prefix-matched (append → appends); cp/tee are whole-word to
  // avoid cpu/teed false hits. Shell redirects get their own test: the old
  // `\b>\s` alternative was unsatisfiable after whitespace (no word
  // boundary exists between a space and `>`), so `echo x > roles.yaml`
  // classified routine. `>&` fd-duplication (2>&1) is not a file write.
  return /\b(write|edit|create|replace|append|mv|cp\b|tee\b|rm|sed -i)/.test(t) || />>?(?!&)/.test(t);
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

export function classify(action: ToolAction): { cls: OpClass; rule?: string } {
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
