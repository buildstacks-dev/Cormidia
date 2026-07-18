import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cmdApprovals } from "../src/cli/approvals.js";
import { githubIssueCreateAction } from "../src/org/approval-delivery.js";
import { ApprovalStore } from "../src/org/approvals.js";
import { initOrgHome } from "../src/org/home.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("approvals execution CLI", () => {
  it("shows attempt/actor/result/next action and requires an exact confirmed retry disposition", async () => {
    const home = makeOrgHome({ approvals: true });
    const orgHome = join(home.root, "org");
    await initOrgHome({
      target: orgHome,
      name: "approval-cli",
      stateHome: home.root,
      homeDir: join(home.root, "operator-home"),
    });
    const homeArgs = ["--org-home", orgHome, "--state-home", home.root];
    const now = new Date("2026-07-18T12:00:00Z");
    const store = new ApprovalStore(home.root, { idSource: () => "delivery-cli-1" });
    const action = githubIssueCreateAction({
      repo: "fixture/service",
      title: "Incident",
      body: "Source event: fixture.json",
      labels: ["op:incident"],
      idempotency_key: "incident:fixture:cli",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const pending = await store.raise({ app: "service", role: "sre", rule: "external-publishing", action, now });
      await store.decide(pending.id, { decision: "approved", reason: "approved", now });
      await store.beginExecution(pending.id, "orchestrator/dispatch", now);
      await store.finishExecution({
        id: pending.id,
        state: "failed",
        actor: "orchestrator/dispatch",
        result: "authentication_failure: bad credentials",
        failureCause: "authentication_failure",
        now,
      });

      expect(await cmdApprovals(["status", ...homeArgs])).toBe(0);
      const status = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(status).toContain("failed");
      expect(status).toContain("orchestrator/dispatch");
      expect(status).toContain("authentication_failure: bad credentials");
      expect(status).toContain("retry_with_disposition");
      expect(status).toContain(now.toISOString());

      await expect(cmdApprovals([
        "disposition", pending.id, "--retry", "--reason", "credentials repaired", "--confirm", "wrong-id",
        ...homeArgs, "--now", now.toISOString(),
      ])).rejects.toThrow("must exactly match");
      expect(await cmdApprovals([
        "disposition", pending.id, "--retry", "--reason", "credentials repaired", "--confirm", pending.id,
        ...homeArgs, "--now", now.toISOString(),
      ])).toBe(0);
      expect((await store.show(pending.id)).item.execution).toMatchObject({
        state: "approved",
        actor: "human/operator",
        result: "credentials repaired",
        nextAction: "dispatch",
      });
    } finally {
      log.mockRestore();
      home.cleanup();
    }
  });
});
