import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhIssue } from "../src/loop/github.js";
import { executeApprovedDeliveries, githubIssueCommentAction, githubIssueCreateAction } from "../src/org/approval-delivery.js";
import { ApprovalStore } from "../src/org/approvals.js";
import type { AppsFile } from "../src/org/apps.js";
import { loadRoles } from "../src/org/roles.js";
import type { ToolAction } from "../src/runtime/types.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const APPS: AppsFile = {
  org: { name: "fixture", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100 },
  apps: [{ name: "service", repo: "fixture/service", status: "live", budgetUsdMonth: 100, cadence: {} }],
};
const NOW = new Date("2026-07-18T12:00:00Z");
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("durable approval delivery", () => {
  it("gives SRE and Builder on the same Codex runtime the same orchestrator-owned GitHub boundary", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ repo: "fixture/service" });
    try {
      const roles = await loadRoles(join(ROOT, "roles.yaml"));
      const builder = roles.roles.find((role) => role.name === "builder");
      const sre = roles.roles.find((role) => role.name === "sre");
      expect(builder?.runtime).toBe("codex");
      expect(sre?.runtime).toBe(builder?.runtime);

      const store = new ApprovalStore(home.root);
      for (const [role, suffix] of [["builder", "build"], ["sre", "incident"]] as const) {
        const action = githubIssueCreateAction({
          repo: "fixture/service",
          title: `Parity ${role}`,
          body: `Typed ${role} publication`,
          labels: role === "sre" ? ["op:incident"] : [],
          idempotency_key: `parity:service:${suffix}`,
        });
        const item = await store.raise({ app: "service", role, rule: "external-publishing", action, now: NOW });
        await store.decide(item.id, { decision: "approved", reason: "parity fixture", now: NOW });
      }
      const outcomes = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcomes.map((outcome) => outcome.status)).toEqual(["executed", "executed"]);
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(2);
    } finally { home.cleanup(); }
  });

  it("keeps approval separate from execution, then acknowledges exactly one content-bound incident", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ repo: "fixture/service" });
    try {
      const { store, action, id } = await approveIncident(home.root);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "approved", attempts: 0 });
      expect(gh.calls).toHaveLength(0);

      const outcomes = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcomes).toEqual([expect.objectContaining({ approvalId: id, status: "executed", remoteRef: "#1" })]);
      const issues = await gh.listIssues({ labels: ["op:incident"], state: "all" });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ title: "Incident: web down", labels: ["op:incident"] });
      expect(issues[0]!.body).toContain("Source event: health-1.json");
      expect(issues[0]!.body).toContain("<!-- operon:delivery id=incident:service:health-1 -->");
      expect((await store.show(id)).item).toMatchObject({
        action,
        execution: {
          state: "executed",
          attempts: 1,
          actor: "orchestrator/dispatch",
          result: "remote action acknowledged",
          nextAction: "none",
          remoteRef: "#1",
        },
      });
      expect(await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW })).toEqual([]);
      expect((await gh.listIssues({ labels: ["op:incident"], state: "all" }))).toHaveLength(1);
    } finally { home.cleanup(); }
  });

  it("executes a content-bound issue comment once through the same acknowledgement path", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ repo: "fixture/service", issues: [{ number: 9, title: "Tracked incident" }] });
    try {
      const action = githubIssueCommentAction({
        repo: "fixture/service",
        issue_number: 9,
        body: "Incident recovered",
        idempotency_key: "incident:service:recovery-comment",
      });
      const store = new ApprovalStore(home.root, { idSource: () => "approval-comment-1" });
      const pending = await store.raise({ app: "service", role: "sre", rule: "external-publishing", action, now: NOW });
      await store.decide(pending.id, { decision: "approved", reason: "publish recovery", now: NOW });
      const outcomes = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcomes).toEqual([expect.objectContaining({ status: "executed", remoteRef: "#9#comment" })]);
      expect(gh.issueComments.get(9)).toEqual([expect.stringContaining("incident:service:recovery-comment")]);
      expect(await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW })).toEqual([]);
      expect(gh.issueComments.get(9)).toHaveLength(1);
    } finally { home.cleanup(); }
  });

  it("reconciles a crash after the remote side effect without creating a duplicate", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ repo: "fixture/service" });
    let crash = true;
    try {
      const { store, id } = await approveIncident(home.root);
      await expect(executeApprovedDeliveries({
        stateHome: home.root,
        appsFile: APPS,
        ghFor: () => gh,
        now: () => NOW,
        fault: (boundary) => {
          if (boundary === "after_remote" && crash) { crash = false; throw new Error("simulated process death"); }
        },
      })).rejects.toThrow("simulated process death");
      expect((await store.show(id)).item.execution?.state).toBe("executing");
      expect(await gh.listIssues({ labels: ["op:incident"], state: "all" })).toHaveLength(1);

      const recovery = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(recovery).toEqual([expect.objectContaining({ status: "executed", summary: expect.stringContaining("recovered") })]);
      expect(await gh.listIssues({ labels: ["op:incident"], state: "all" })).toHaveLength(1);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "executed", attempts: 1 });
    } finally { home.cleanup(); }
  });

  it("makes an unacknowledged pre-remote crash ambiguous and never retries blindly", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({ repo: "fixture/service" });
    try {
      const { store, id } = await approveIncident(home.root);
      await expect(executeApprovedDeliveries({
        stateHome: home.root,
        appsFile: APPS,
        ghFor: () => gh,
        now: () => NOW,
        fault: (boundary) => { if (boundary === "after_claim") throw new Error("simulated process death"); },
      })).rejects.toThrow("simulated process death");
      const recovery = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(recovery).toEqual([expect.objectContaining({ status: "ambiguous", cause: "ambiguous_remote_response" })]);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "ambiguous", nextAction: "reconcile" });
      expect(await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW }))
        .toEqual([expect.objectContaining({ status: "skipped", summary: expect.stringContaining("human disposition") })]);
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
    } finally { home.cleanup(); }
  });

  it("fails closed on non-unique remote markers instead of creating another duplicate", async () => {
    const marker = "<!-- operon:delivery id=incident:service:health-1 -->";
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({
      repo: "fixture/service",
      issues: [
        { number: 10, title: "Incident duplicate one", body: marker, labels: ["op:incident"] },
        { number: 11, title: "Incident duplicate two", body: marker, labels: ["op:incident"] },
      ],
    });
    try {
      const { store, id } = await approveIncident(home.root);
      const outcome = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcome).toEqual([expect.objectContaining({ status: "ambiguous", cause: "ambiguous_remote_response" })]);
      expect((await store.show(id)).item.execution).toMatchObject({
        state: "ambiguous",
        attempts: 1,
        nextAction: "reconcile",
      });
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
    } finally { home.cleanup(); }
  });

  it("reconciles an existing marker even when its canonical label was removed", async () => {
    const marker = "<!-- operon:delivery id=incident:service:health-1 -->";
    const home = makeOrgHome({ approvals: true });
    const gh = new FakeGhOps({
      repo: "fixture/service",
      issues: [{ number: 12, title: "Existing incident", body: marker, labels: [] }],
    });
    try {
      const { store, id } = await approveIncident(home.root);
      const outcome = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcome).toEqual([expect.objectContaining({ status: "executed", remoteRef: "#12" })]);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "executed", attempts: 1 });
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
    } finally { home.cleanup(); }
  });

  it.each([
    ["sandbox_denied", "operation not permitted by sandbox", "failed"],
    ["dns_failure", "ENOTFOUND api.github.com DNS", "failed"],
    ["tls_failure", "TLS certificate verify failed", "failed"],
    ["authentication_failure", "HTTP 401 bad credentials", "failed"],
    ["remote_rejection", "HTTP 422 validation failed", "failed"],
    ["remote_api_failure", "HTTP 503 api.github.com unavailable", "ambiguous"],
  ] as const)("persists typed %s delivery failures", async (cause, message, state) => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FailingCreateGh(message);
    try {
      const { store, id } = await approveIncident(home.root);
      const outcomes = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcomes).toEqual([expect.objectContaining({ status: state, cause })]);
      expect((await store.show(id)).item.execution).toMatchObject({ state, failureCause: cause });
      const calls = gh.calls.filter((call) => call.op === "createIssue").length;
      await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(calls);
    } finally { home.cleanup(); }
  });

  it("types a DNS failure at the preflight read boundary without attempting the mutation", async () => {
    const home = makeOrgHome({ approvals: true });
    const gh = new FailingListGh("ENOTFOUND api.github.com DNS");
    try {
      const { store, id } = await approveIncident(home.root);
      const outcomes = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => gh, now: () => NOW });
      expect(outcomes).toEqual([expect.objectContaining({ status: "failed", cause: "dns_failure", summary: expect.stringContaining("preflight") })]);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "failed", failureCause: "dns_failure" });
      expect(gh.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
    } finally { home.cleanup(); }
  });

  it("requires explicit human disposition before a confirmed failure can retry", async () => {
    const home = makeOrgHome({ approvals: true });
    const failing = new FailingCreateGh("HTTP 401 bad credentials");
    const recovered = new FakeGhOps({ repo: "fixture/service" });
    try {
      const { store, id } = await approveIncident(home.root);
      await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => failing, now: () => NOW });
      await store.dispositionExecution({ id, disposition: "retry", reason: "credentials repaired; retry confirmed", actor: "human/operator", now: NOW });
      const outcome = await executeApprovedDeliveries({ stateHome: home.root, appsFile: APPS, ghFor: () => recovered, now: () => NOW });
      expect(outcome).toEqual([expect.objectContaining({ status: "executed" })]);
      expect((await store.show(id)).item.execution).toMatchObject({ state: "executed", attempts: 2 });
    } finally { home.cleanup(); }
  });
});

class FailingCreateGh extends FakeGhOps {
  constructor(private readonly failure: string) { super({ repo: "fixture/service" }); }
  override async createIssue(_input: { title: string; body: string; labels: string[] }): Promise<GhIssue> {
    throw new Error(this.failure);
  }
}

class FailingListGh extends FakeGhOps {
  constructor(private readonly failure: string) { super({ repo: "fixture/service" }); }
  override async listIssues(): Promise<GhIssue[]> { throw new Error(this.failure); }
}

async function approveIncident(stateHome: string): Promise<{ store: ApprovalStore; action: ToolAction; id: string }> {
  const action = githubIssueCreateAction({
    repo: "fixture/service",
    title: "Incident: web down",
    body: "Critical service incident.\n\nSource event: health-1.json",
    labels: ["op:incident"],
    idempotency_key: "incident:service:health-1",
  });
  const store = new ApprovalStore(stateHome, { idSource: () => "approval-delivery-1" });
  const pending = await store.raise({
    app: "service",
    role: "sre",
    rule: "external-publishing",
    action,
    ticketRef: "event:health-1.json",
    justification: "publish the grounded incident through the durable delivery boundary",
    now: NOW,
  });
  await store.decide(pending.id, { decision: "approved", reason: "incident filing approved", now: NOW });
  return { store, action, id: pending.id };
}
