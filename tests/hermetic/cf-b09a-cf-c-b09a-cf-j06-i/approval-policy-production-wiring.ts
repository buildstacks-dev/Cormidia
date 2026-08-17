// CF-B09a · CF-C-B09A · HB-P5 — B-09a §3 policy-configured approval TTLs.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdApprovals } from "../../../src/cli/approvals.js";
import { ApprovalStore, type ApprovalGrant } from "../../../src/org/approvals.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const HOUR_MS = 60 * 60 * 1000;
const START = new Date("2026-08-16T10:00:00.000Z");
const homes: TempOrgHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

async function configuredOrg(name: string): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name });
  homes.push(home);
  const appsPath = join(home.orgHome, "apps.yaml");
  const apps = await readFile(appsPath, "utf8");
  const anchor = `org:\n  name: ${name}\n  max_concurrent_turns: 2`;
  if (!apps.includes(anchor)) throw new Error(`apps fixture lacks expected org anchor: ${anchor}`);
  await writeFile(
    appsPath,
    apps.replace(anchor, `${anchor}\n  approval_policy:\n    grant_ttl_hours: 2\n    pending_ttl_hours: 1`),
    "utf8",
  );
  return home;
}

async function runApprovals(home: TempOrgHome, args: string[]): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...chunks: unknown[]) => {
    lines.push(chunks.map(String).join(" "));
  });
  try {
    expect(await cmdApprovals(["--org-home", home.orgHome, "--state-home", home.stateHome, ...args])).toBe(0);
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

function grantLifetimeProblems(grant: ApprovalGrant | undefined, decidedAt: Date): string[] {
  if (grant === undefined) return ["decision did not mint a grant"];
  return new Date(grant.expiresAt).getTime() - decidedAt.getTime() === 2 * HOUR_MS
    ? []
    : ["grant did not use the configured 2h lifetime"];
}

async function raise(home: TempOrgHome, at: Date): Promise<string> {
  const item = await new ApprovalStore(home.stateHome).raise({
    app: "app-a",
    role: "sre",
    rule: "external-publishing",
    action: { tool: "bash", input: { command: "gh release create v1.0.0" } },
    now: at,
  });
  return item.id;
}

export function registerApprovalPolicyProductionWiringTests(): void {
  describe("CF-B09a — production approval-policy wiring", () => {
    it("real cmdApprovals mints the configured 2h grant", async () => {
      const home = await configuredOrg("approval-policy-grant");
      const id = await raise(home, START);
      await runApprovals(home, [
        "decide",
        id,
        "--approve",
        "--reason",
        "approved for the bounded release action",
        "--by",
        "human/test-owner",
        "--confirm",
        id,
        "--now",
        START.toISOString(),
        "--json",
      ]);
      const { grant } = await new ApprovalStore(home.stateHome).show(id);
      expect(grantLifetimeProblems(grant, START)).toEqual([]);
    });

    it("real cmdApprovals list/reconcile expires a configured 1h pending item by 2h", async () => {
      const home = await configuredOrg("approval-policy-pending");
      const id = await raise(home, START);
      const output: unknown = JSON.parse(
        await runApprovals(home, ["list", "--now", new Date(START.getTime() + 2 * HOUR_MS).toISOString(), "--json"]),
      );
      expect(output).toMatchObject({ pendingCount: 0, pending: [] });
      expect((await new ApprovalStore(home.stateHome).show(id)).item.status).toBe("expired");
    });

    it("negative control: the old unconfigured store fails the configured-lifetime oracle", async () => {
      const home = await configuredOrg("approval-policy-negative");
      const legacyStore = new ApprovalStore(home.stateHome, { now: () => START });
      const id = await raise(home, START);
      await legacyStore.decide(id, {
        decision: "approved",
        decidedBy: { kind: "human", identity: "test-owner" },
        now: START,
      });
      const { grant } = await legacyStore.show(id);
      expect(grantLifetimeProblems(grant, START)).toEqual(["grant did not use the configured 2h lifetime"]);
      expect(new Date(grant?.expiresAt ?? 0).getTime() - START.getTime()).toBe(48 * HOUR_MS);
    });
  });
}
