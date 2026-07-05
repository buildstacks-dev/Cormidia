// The critical-ops gate (PURPOSE.md → Decided → Approval boundary).
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
    name: "destructive-or-irreversible",
    matches: (a) =>
      /\b(drop table|truncate|rm -rf|force[- ]?push|delete (database|bucket|droplet|dns))\b/.test(asText(a)),
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
    matches: (a) =>
      /\b(secret|api[_ ]?key|credential|rotate key|oauth client)\b|\.env\b/.test(asText(a)),
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
];

function isWrite(a: ToolAction): boolean {
  return /\b(write|edit|create|replace|append|mv|rm|sed -i|>\s)/.test(asText(a));
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
