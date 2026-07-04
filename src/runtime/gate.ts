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
    matches: (a) => /\b(taste\.md|roles\.yaml|agents\.md|purpose\.md)\b/.test(asText(a)) && isWrite(a),
  },
];

function isWrite(a: ToolAction): boolean {
  return /\b(write|edit|create|replace|append|mv|rm|sed -i|>\s)/.test(asText(a));
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
