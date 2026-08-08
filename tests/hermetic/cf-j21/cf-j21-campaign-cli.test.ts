// CF-J21-R (L2) — the entry point refuses before it spends.
//
// The authorization block is the whole gate. There is NO global L-ACC ceiling,
// so a campaign that ran without one would be spending against a bound nobody
// set — and the shipped template deliberately cannot run, which is asserted
// here so a future edit cannot quietly make it runnable.

import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSpendAuthorization,
  CampaignAuthorizationError,
  preflightCampaign,
  readCampaignFile,
  renderDryRun,
  type AcceptanceCampaignFile,
} from "../../campaign/acceptance/campaign-cli.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const templatePath = join(repoRoot, "acceptance", "campaigns", "run-1.example.yaml");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function stateHome(name: string): Promise<TempStateHome> {
  const fixture = await makeTempStateHome({ name });
  cleanups.push(fixture.cleanup);
  return fixture;
}

function file(overrides: Partial<AcceptanceCampaignFile> = {}): AcceptanceCampaignFile {
  return {
    schema_version: 1,
    authorization: {
      authorized_by: "bikramgupta",
      authorized_on: "2026-08-08",
      statement: "Run L-ACC run 1 up to 400k output tokens and $120.",
      max_output_tokens: 400_000,
      max_equiv_usd: 120,
    },
    campaign: {
      campaignId: "l-acc-run-1",
      commit: "a".repeat(40),
      policyPath: "/repo/validation-design/validation-policy.yaml",
      campaignOrg: "cormidia-sandbox",
      envelope: { maxOutputTokens: 400_000, maxEquivUsd: 120, authorization: "bikramgupta 2026-08-08" },
      planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
      scenarios: [
        {
          id: "S-ACC-1",
          kind: "app",
          appSlug: "cormidia-sandbox/acc-1",
          worktree: "/sandbox/acc-1",
          matrix: {
            planner: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
            builder: { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" },
            reviewer: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
          },
        },
      ],
      adaptiveAssignments: [
        {
          id: "claude-sonnet-5-xhigh",
          assignment: { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" },
          providerFamily: "anthropic",
          capabilityRef: "docs/harness/capability-matrix.md#claude",
          conservativeEstimate: 12,
          qualificationRef: "research/2026-07-15_model-assignment-refresh.md",
        },
      ],
      graderPlan: [{ axis: "P-1", mechanical: true }],
    },
    ...overrides,
  };
}

function refusal(run: () => unknown): CampaignAuthorizationError {
  try {
    run();
  } catch (error) {
    if (error instanceof CampaignAuthorizationError) return error;
    throw error;
  }
  throw new Error("expected a CampaignAuthorizationError, but the campaign was authorized");
}

describe("CF-J21-R the shipped template cannot run", () => {
  it("parses, but refuses because it carries no authorization", async () => {
    const parsed = await readCampaignFile(templatePath);
    expect(parsed.schema_version).toBe(1);
    const error = refusal(() => assertSpendAuthorization(parsed));
    expect(error.message).toContain("no `authorization:` block");
    expect(error.message).toContain("NO global ceiling");
  });

  it("ships zeroed ceilings so a copied template cannot spend by accident", async () => {
    const parsed = await readCampaignFile(templatePath);
    expect(parsed.campaign.envelope?.maxOutputTokens).toBe(0);
    expect(parsed.campaign.envelope?.maxEquivUsd).toBe(0);
  });
});

describe("CF-J21-R the authorization gate", () => {
  it("accepts a complete, attributable authorization", () => {
    const authorization = assertSpendAuthorization(file());
    expect(authorization.authorized_by).toBe("bikramgupta");
    expect(authorization.max_equiv_usd).toBe(120);
  });

  it("negative control: a role is not an attributable identity", () => {
    for (const who of ["the operator", "operator", "human", "me", "Owner"]) {
      const error = refusal(() =>
        assertSpendAuthorization(file({ authorization: { ...file().authorization!, authorized_by: who } })),
      );
      expect(error.message).toContain("not an attributable identity");
    }
  });

  it("negative control: a blank statement, date or identity refuses", () => {
    for (const field of ["authorized_by", "authorized_on", "statement"] as const) {
      expect(() =>
        assertSpendAuthorization(file({ authorization: { ...file().authorization!, [field]: "  " } })),
      ).toThrow(CampaignAuthorizationError);
    }
  });

  it("negative control: a non-ISO authorization date refuses", () => {
    expect(
      refusal(() =>
        assertSpendAuthorization(file({ authorization: { ...file().authorization!, authorized_on: "8 Aug 2026" } })),
      ).message,
    ).toContain("ISO date");
  });

  it("negative control: zero or negative ceilings refuse", () => {
    for (const field of ["max_output_tokens", "max_equiv_usd"] as const) {
      expect(() => assertSpendAuthorization(file({ authorization: { ...file().authorization!, [field]: 0 } }))).toThrow(
        /positive number/,
      );
    }
  });

  it("negative control: envelope and authorization disagreeing means two ceilings", () => {
    const base = file();
    const error = refusal(() =>
      assertSpendAuthorization({
        ...base,
        campaign: { ...base.campaign, envelope: { ...base.campaign.envelope!, maxEquivUsd: 500 } },
      }),
    );
    expect(error.message).toContain("two ceilings");
  });
});

describe("CF-J21-R preflight stops before anything is touched", () => {
  it("summarizes a fresh campaign and names its uncertified tuples", async () => {
    const home = await stateHome("cli-preflight");
    const base = file();
    const summary = await preflightCampaign(
      {
        ...base,
        campaign: {
          ...base.campaign,
          adaptiveAssignments: [
            {
              id: "gpt-5.6-sol-xhigh",
              assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
              providerFamily: "openai",
              capabilityRef: "docs/harness/capability-matrix.md#codex",
              conservativeEstimate: 20,
              uncertified: "no ratified qualification reference for this tuple",
            },
          ],
        },
      },
      home.stateHome,
    );
    expect(summary.identity).toBe("fresh");
    expect(summary.campaignOrg).toBe("cormidia-sandbox");
    expect(summary.uncertifiedCandidateIds).toEqual(["gpt-5.6-sol-xhigh"]);
    expect(summary.configSha256).toHaveLength(64);
  });

  it("the dry run states plainly that nothing was spent and that L-ACC gates nothing", async () => {
    const home = await stateHome("cli-dry-run");
    const rendered = renderDryRun(await preflightCampaign(file(), home.stateHome));
    expect(rendered).toContain("DRY RUN — nothing was provisioned, no binary was spawned, no token was spent.");
    expect(rendered).toContain("never a release signal");
    expect(rendered).toContain("400000 output tokens / $120");
    expect(rendered).toContain("bikramgupta on 2026-08-08");
  });

  it("negative control: a config defect refuses at preflight, before any spend", async () => {
    const home = await stateHome("cli-defect");
    const base = file();
    // `exactOptionalPropertyTypes`: the OMISSION is what the contract refuses.
    const campaign = { ...base.campaign };
    delete campaign.planGate;
    await expect(preflightCampaign({ ...base, campaign }, home.stateHome)).rejects.toThrow(/plan-gate-undeclared/);
  });

  it("round-trips a written config file", async () => {
    const home = await stateHome("cli-roundtrip");
    const path = join(home.stateHome, "run-1.yaml");
    await writeFile(path, stringify(file()), "utf8");
    const summary = await preflightCampaign(await readCampaignFile(path), home.stateHome);
    expect(summary.campaignId).toBe("l-acc-run-1");
  });
});
