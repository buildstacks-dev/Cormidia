import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  classify,
  defaultGate,
  normalizeSemanticAction,
} from "../src/runtime/gate.js";
import type { ToolAction } from "../src/runtime/types.js";
import {
  ACTION_IDENTITY_VERSION,
  ApprovalStore,
  SEMANTIC_INPUT_KEYS,
  actionHash,
  computeApprovalMetrics,
} from "../src/org/approvals.js";
import { composeGate } from "../src/org/gate-compose.js";
import { denialLessonsLedgerPath } from "../src/org/denial-lessons.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

interface ActionRow {
  id: string;
  class: "critical" | "routine";
  expected_rule?: string;
  tool: string;
  input: Record<string, unknown>;
  operation: string;
  path: string;
  destination: string;
  effect: string;
  role: string;
  app: string;
  ticket: string;
  near_miss?: string;
}

const rows = (parse(readFileSync("eval/corpora/actions.yaml", "utf8")) as { cases: ActionRow[] }).cases;
const action = (row: ActionRow): ToolAction => ({ tool: row.tool, input: row.input });

describe("Phase 3 semantic approval boundary", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("G-ACT-01 classifies the full typed corpus with every critical near-miss", () => {
    const observed = rows.map((row) => ({ row, classification: classify(action(row)) }));
    for (const { row, classification } of observed) {
      expect(classification.cls, row.id).toBe(row.class);
      if (row.expected_rule !== undefined) expect(classification.rule, row.id).toBe(row.expected_rule);
      const semantic = normalizeSemanticAction({
        tool: row.tool,
        input: { ...row.input, destination: row.destination, effect: row.effect },
      });
      expect(semantic.tool).toBe(row.tool.toLowerCase());
      expect(semantic.destination).toBe(row.destination);
      expect(semantic.effect).toBe(row.effect);
    }
    const critical = rows.filter((row) => row.class === "critical");
    expect(critical.every((row) => row.near_miss !== undefined && rows.some((candidate) => candidate.id === row.near_miss && candidate.class === "routine"))).toBe(true);
  });

  it("G-ACT-02 treats verdicts, plans, reviews, docs, and comments as data", () => {
    for (const tool of ["write", "edit", "create", "comment"]) {
      const data: ToolAction = {
        tool,
        input: { path: `docs/${tool}.md`, content: "kubectl apply; npm publish; rotate secrets; edit roles.yaml" },
      };
      expect(classify(data), tool).toEqual({ cls: "routine" });
    }
    expect(classify({ tool: "StructuredOutput", input: { plan: "deploy production and rotate auth" } })).toEqual({ cls: "routine" });
    expect(classify({ tool: "structuredoutput-exec", input: { command: "kubectl apply -f prod.yaml" } })).toEqual({ cls: "critical", rule: "production-deploy" });
  });

  it("G-ACT-03 wrappers, quoting, redirects, normalized/resolved paths, and encoding cannot evade rules", () => {
    const encoded = Buffer.from("kubectl apply -f prod.yaml").toString("base64");
    const cases: Array<[ToolAction, string]> = [
      [{ tool: "bash", input: { command: "bash -c 'kubectl apply -f prod.yaml'" } }, "production-deploy"],
      [{ tool: "bash", input: { command: "eval \"npm publish --access public\"" } }, "external-publishing"],
      [{ tool: "bash", input: { command: `echo ${encoded} | base64 -d | sh` } }, "production-deploy"],
      [{ tool: "bash", input: { command: "echo x > ./roles.yaml" } }, "protocol-self-edit"],
      [{ tool: "write", input: { path: "safe-link", resolved_path: "/Users/alice/.codex/AGENTS.md", content: "x" } }, "provider-global-memory"],
      [{ tool: "bash", input: { command: "kubectl%20apply%20-f%20prod.yaml" } }, "production-deploy"],
    ];
    for (const [candidate, rule] of cases) expect(classify(candidate)).toEqual({ cls: "critical", rule });
  });

  it("G-SHAPE-01 flat-denies role-forbidden actions without raising an approval", async () => {
    home = makeOrgHome();
    const store = new ApprovalStore(home.root, { idSource: () => "forbidden" });
    const gate = composeGate(defaultGate, store, { app: "app", role: "builder", ticketRef: "#1", orgHome: home.root });
    const decision = gate({ tool: "bash", input: { command: "gh pr merge 1 --squash" } });
    expect(decision).toMatchObject({ allow: false, escalate: false });
    expect(await store.listPending()).toEqual([]);
  });

  it("G-GRANT-01 enforces exact, ticket/app path, TTL, use, revocation, and never-scopeable bounds", async () => {
    home = makeOrgHome();
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `a${++n}` });
    const actionA: ToolAction = { tool: "read", input: { path: "config/credentials.json" } };
    const pending = await store.raise({ app: "app", role: "sre", rule: "secrets-or-auth", action: actionA, ticketRef: "#1", now: new Date("2026-07-14T00:00:00Z") });
    const approved = await store.decide(pending.id, { decision: "approved", scope: { kind: "ticket", pathContains: "config/credentials.json" }, maxUses: 2, ttlMs: 1000, now: new Date("2026-07-14T00:00:01Z") });
    const grant = store.findMatchingGrantSync({ app: "app", role: "sre", actionHash: actionHash(actionA), rule: "secrets-or-auth", actionText: "read config/credentials.json", ticketRef: "#1", now: new Date("2026-07-14T00:00:01Z") });
    expect(grant?.grantId).toBe(approved.grantId);
    expect(store.findMatchingGrantSync({ app: "app", role: "sre", actionHash: actionHash(actionA), rule: "secrets-or-auth", actionText: "read config/credentials.json", ticketRef: "#2", now: new Date("2026-07-14T00:00:01Z") })).toBeUndefined();
    store.consumeGrantSync(grant!.grantId, new Date("2026-07-14T00:00:01Z"));
    store.revokeGrantSync(grant!.grantId, new Date("2026-07-14T00:00:01Z"));
    expect(store.findMatchingGrantSync({ app: "app", role: "sre", actionHash: actionHash(actionA), rule: "secrets-or-auth", actionText: "read config/credentials.json", ticketRef: "#1", now: new Date("2026-07-14T00:00:01Z") })).toBeUndefined();
    const merge = await store.raise({ app: "app", role: "sre", rule: "self-merge-or-approve", action: { tool: "bash", input: { command: "gh pr merge 1" } } });
    await expect(store.decide(merge.id, { decision: "approved", scope: { kind: "app" } })).rejects.toThrow(/never scopeable/);
  });

  it("G-DEDUPE-01 reuses identical pending/denied requests but preserves effect near-misses", async () => {
    home = makeOrgHome();
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `d${++n}` });
    const deploy: ToolAction = { tool: "bash", input: { command: "kubectl apply -f prod.yaml" } };
    const first = await store.raise({ app: "app", role: "sre", rule: "production-deploy", action: deploy, ticketRef: "#1" });
    expect((await store.raise({ app: "app", role: "sre", rule: "production-deploy", action: deploy, ticketRef: "#1" })).id).toBe(first.id);
    expect((await store.raise({ app: "app", role: "sre", rule: "production-deploy", action: { tool: "bash", input: { command: "kubectl apply -f staging.yaml" } }, ticketRef: "#1" })).id).not.toBe(first.id);
    await store.decide(first.id, { decision: "denied", reason: "change window closed" });
    const gate = composeGate(defaultGate, store, { app: "app", role: "sre", ticketRef: "#1", orgHome: home.root });
    expect(gate(deploy)).toMatchObject({ allow: false, escalate: false });
    expect((await store.listPending()).map((item) => item.id)).not.toContain(first.id);
  });

  it("G-DENY-01 writes schema-valid app/role-scoped lessons once and suppresses unchanged recurrence", async () => {
    home = makeOrgHome();
    const store = new ApprovalStore(home.root, { idSource: () => "denied" });
    const deploy: ToolAction = { tool: "bash", input: { command: "kubectl apply -f prod.yaml" } };
    const pending = await store.raise({ app: "app", role: "sre", rule: "production-deploy", action: deploy, ticketRef: "#1" });
    await store.decide(pending.id, { decision: "denied", reason: "owner denied this deployment" });
    const gate = composeGate(defaultGate, store, { app: "app", role: "sre", ticketRef: "#1", orgHome: home.root, now: () => new Date("2026-07-14T01:00:00Z") });
    gate(deploy);
    gate(deploy);
    const records = readFileSync(denialLessonsLedgerPath(home.root, "sre"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ schema_version: 1, role: "sre", app: "app", rule: "production-deploy" });
  });

  it("G-MET-01 reports 100% known-corpus precision/recall and truthful recurrence/decision time", async () => {
    home = makeOrgHome();
    const tp = rows.filter((row) => row.class === "critical" && classify(action(row)).cls === "critical").length;
    const fp = rows.filter((row) => row.class === "routine" && classify(action(row)).cls === "critical").length;
    const fn = rows.filter((row) => row.class === "critical" && classify(action(row)).cls === "routine").length;
    expect(tp / (tp + fp)).toBe(1);
    expect(tp / (tp + fn)).toBe(1);

    const store = new ApprovalStore(home.root, { idSource: () => "metric" });
    const item = await store.raise({ app: "app", role: "sre", rule: "production-deploy", action: { tool: "bash", input: { command: "kubectl apply -f prod.yaml" } }, now: new Date("2026-07-14T00:00:00Z") });
    await store.decide(item.id, { decision: "approved", now: new Date("2026-07-14T00:00:05Z") });
    const metrics = computeApprovalMetrics(await store.listDecided(), await store.readLog(), (approval) => classify(approval.action).cls === "critical");
    expect(metrics).toMatchObject({ precision: 1, recurrence: 0, meanDecisionMs: 5_000 });
  });
});

// A-002: the authorization identity must bind the payload the human saw, so a
// grant for Write X does not authorize Write Y on the same (tool, path) pair.
// The CLASSIFICATION projection stays payload-blind (docs that mention a
// protocol surface are not a self-edit); only the actionHash used for grants
// and dedupe is content-bound. Mirrors publisher.ts final_diff_hash.
describe("A-002 content-bound approval identity", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  const rolesWrite = (content: string): ToolAction => ({
    tool: "Write",
    input: { file_path: "roles.yaml", content },
  });
  const benign = rolesWrite("# harmless tweak");
  const evil = rolesWrite("# ATTACKER PAYLOAD: exfiltrate everything");

  it("G-BIND-01 a grant for the approved payload does not cover a different-content write", async () => {
    // (a) The malicious write hashes differently from the benign one the human
    // approved (they were BYTE-IDENTICAL — 61f09557… — before this fix).
    expect(actionHash(benign)).not.toBe(actionHash(evil));

    home = makeOrgHome();
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `b${++n}` });
    const raised = await store.raise({ app: "app", role: "builder", rule: "protocol-self-edit", action: benign, ticketRef: "#1" });
    await store.decide(raised.id, { decision: "approved" });

    const gate = composeGate(defaultGate, store, { app: "app", role: "builder", ticketRef: "#1", orgHome: home.root });
    // The evil write is NOT covered by the benign grant: it escalates a fresh
    // critical op rather than riding the human's approval (grant untouched).
    expect(gate(evil)).toMatchObject({ allow: false, escalate: true });
    expect((await store.listPending()).map((item) => item.action.input)).toContainEqual(evil.input);
    // The exact payload the human approved still passes on its own.
    expect(gate(benign)).toEqual({ allow: true });
  });

  it("G-BIND-02 a different-content raise creates a NEW pending item; identical content still dedupes", async () => {
    home = makeOrgHome();
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `d${++n}` });
    const raise = (action: ToolAction) => store.raise({ app: "app", role: "builder", rule: "protocol-self-edit", action, ticketRef: "#1" });
    const first = await raise(benign);
    const second = await raise(evil);
    // (b) The malicious raise no longer collapses into the item the human is
    // reading — it stands as its own pending decision.
    expect(second.id).not.toBe(first.id);
    expect((await store.listPending())).toHaveLength(2);
    // A genuine identical re-raise still dedupes (no churn on retries).
    expect((await raise(benign)).id).toBe(first.id);
    expect((await store.listPending())).toHaveLength(2);
  });

  it("G-BIND-03 classification stays payload-blind while the identity binds content", () => {
    // (c) The semantic projection and classification are IDENTICAL for two
    // writes that differ only in payload — the payload is bound ONLY in the
    // authorization identity (actionHash), never in classification.
    expect(normalizeSemanticAction(benign)).toEqual(normalizeSemanticAction(evil));
    expect(classify(benign)).toEqual({ cls: "critical", rule: "protocol-self-edit" });
    expect(classify(evil)).toEqual(classify(benign));
    // A doc that merely NAMES a protocol surface in its body is still routine.
    expect(classify({ tool: "write", input: { path: "docs/guide.md", content: "edit roles.yaml to add a role" } })).toEqual({ cls: "routine" });
    expect(actionHash(benign)).not.toBe(actionHash(evil));
  });

  it("G-BIND-04 a pre-v2 grant never matches and the miss path re-raises cleanly, no exception", async () => {
    // A grant persisted before the identity bump: NO identityVersion, and its
    // actionHash is the CURRENT hash of the action — so ONLY the version gate
    // can reject it, proving the migration mechanism rather than an incidental
    // hash mismatch. (Human decision, 2026-07-17: old-format grants stop
    // matching; agents re-raise; the failure mode is a fresh item, never a crash.)
    const legacyGrant = {
      grantId: "grant-legacy",
      approvalId: "legacy",
      app: "app",
      role: "builder",
      actionHash: actionHash(benign),
      expiresAt: "2999-01-01T00:00:00.000Z",
      uses: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    home = makeOrgHome({ approvals: { grants: { "grant-legacy": legacyGrant } } });
    const store = new ApprovalStore(home.root, { idSource: () => "mig1" });

    // Sanity: the bump is a real version change, and the legacy grant predates it.
    expect(legacyGrant).not.toHaveProperty("identityVersion");
    expect(ACTION_IDENTITY_VERSION).toBeGreaterThanOrEqual(2);

    // Direct: despite an equal actionHash, the legacy grant is refused.
    expect(store.findMatchingGrantSync({ app: "app", role: "builder", actionHash: actionHash(benign), now: new Date() })).toBeUndefined();

    // Behavioral: the miss path raises a fresh approval item — it must not throw.
    const gate = composeGate(defaultGate, store, { app: "app", role: "builder", ticketRef: "#1", orgHome: home.root });
    let decision: ReturnType<typeof gate> | undefined;
    expect(() => { decision = gate(benign); }).not.toThrow();
    expect(decision).toMatchObject({ allow: false, escalate: true });
    expect(await store.listPending()).toHaveLength(1);
  });

  // Regression pin for the SEMANTIC_INPUT_KEYS maintenance comment
  // (src/org/approvals.ts): a denylisted key is excluded from the residual
  // payload on the assumption normalizeSemanticAction (src/runtime/gate.ts)
  // already binds it into `semantic`. If that assumption ever goes stale —
  // a key is listed here but gate.ts stops reading it (OVER-listing) — the
  // key is bound in NEITHER projection and two actions differing only in it
  // hash identically: a silent A-002 regression. This asserts the invariant
  // ITSELF (behaviorally, via actionHash) rather than pinning the key list
  // as a string-equality snapshot, so it fails the moment the binding
  // actually breaks, for exactly the reason it broke.
  it("SEMANTIC_INPUT_KEYS binds every denylisted key (behavioral, not string-list, pin)", () => {
    expect(SEMANTIC_INPUT_KEYS.size).toBeGreaterThan(0);
    for (const key of SEMANTIC_INPUT_KEYS) {
      const base = { file_path: "base.txt", content: "unchanged payload" };
      const withA: ToolAction = { tool: "Write", input: { ...base, [key]: "value-a" } };
      const withB: ToolAction = { tool: "Write", input: { ...base, [key]: "value-b" } };
      expect(actionHash(withA), `key "${key}" must be bound (semantic or residual)`).not.toBe(actionHash(withB));
    }
  });
});
