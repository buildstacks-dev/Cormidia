// Opt-in L3 campaign. Missing authorization is a hard test failure; provider,
// GitHub, launchd and unattended-profile evidence are durable after each case.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { ClaudeRuntime } from "../../src/runtime/adapters/claude.js";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { CursorRuntime } from "../../src/runtime/adapters/cursor.js";
import { MuseRuntime } from "../../src/runtime/adapters/muse.js";
import { PiRuntime } from "../../src/runtime/adapters/pi.js";
import { toErrorMessage as errorMessage } from "../../src/runtime/error-message.js";
import type { Runtime, RuntimeKind } from "../../src/runtime/types.js";
import { ApprovalStore } from "../../src/org/approvals.js";
import {
  authorizeUnattendedValidationAction,
  createUnattendedValidationProfile,
} from "../../src/org/validation-test-mode.js";
import { buildSchedulerExpectation } from "../../src/org/scheduler/definition.js";
import { installScheduler, schedulerDefinitionStatus, uninstallScheduler } from "../../src/org/scheduler/lifecycle.js";
import { PlatformSchedulerManager } from "../../src/org/scheduler/manager.js";
import { assertCompletedCampaignPass, DurableCampaignRunner } from "../campaign/campaign-runner.js";
import { assertCampaignRepositoryBinding } from "../campaign/repository-binding.js";
import { ADAPTER_CONFORMANCE_CASES, runAdapterConformance } from "../fixtures/adapters/conformance.js";
import { GITHUB_CONFORMANCE_CLAUSE_COUNT, runGithubConformance } from "../fixtures/github-double/conformance/suite.js";
import { liveCampaignRequiredCaseIds, loadLiveCampaignConfig, type LiveCampaignConfigV1 } from "./config.js";
import { releaseGithubConformanceOptions } from "./github-conformance-policy.js";
import { githubConformanceCaseResult } from "./github-conformance-result.js";
import { RealGithubConformanceSurface } from "./real-github-surface.js";

let config: LiveCampaignConfigV1;
let campaign: DurableCampaignRunner;
let workdir = "";
let decidedBefore = new Set<string>();

beforeAll(async () => {
  ({ config } = await loadLiveCampaignConfig());
  await assertCampaignRepositoryBinding({ commit: config.commit, policyPath: config.policy_path });
  workdir = await mkdtemp(join(tmpdir(), "cormidia-live-adapter-"));
  await mkdir(join(workdir, ".git"), { recursive: true });
  decidedBefore = new Set((await new ApprovalStore(config.state_home).listDecidedReadOnly()).map((row) => row.id));
  const required = liveCampaignRequiredCaseIds(config);
  const ceiling = config.campaign_kind === "release" ? { turns: 24, usd: 100 } : { turns: 2, usd: 5 };
  const profile = config.unattended.enabled ? createUnattendedValidationProfile(config.sandbox) : undefined;
  campaign = new DurableCampaignRunner({
    stateHome: config.state_home,
    campaignId: config.campaign_id,
    lane: "L3",
    campaignKind: config.campaign_kind,
    trigger: `human:${config.human_authorization.authorized_by}:${config.human_authorization.purpose}`,
    policyPath: config.policy_path,
    commit: config.commit,
    apps: [config.sandbox.app],
    scopes: required,
    tuples: config.adapters.map((target) => `${target.runtime}/${target.model}/${target.effort}`),
    requiredCaseIds: required,
    maxProviderTurns: ceiling.turns,
    maxEquivUsd: ceiling.usd,
    decisionStatus: "ratified",
    ...(profile === undefined
      ? {}
      : {
          profile: {
            identity: profile.identity,
            sandbox_target: `${profile.sandbox.org}/${profile.sandbox.app}@${profile.sandbox.repo}`,
            permitted_auto_grant_categories: [...profile.permitted_auto_grant_categories],
            human_decision_rows: 0,
          },
        }),
  });
  await campaign.start();
});

afterAll(async () => {
  if (campaign !== undefined) {
    const report = await campaign.finish();
    assertCompletedCampaignPass(report);
  }
  if (workdir !== "") await rm(workdir, { recursive: true, force: true });
});

describe("authorized L3 campaign", () => {
  it("runs the selected real adapter conformance pairs within the campaign envelope", async () => {
    const errors: string[] = [];
    for (const target of config.adapters) {
      const caseId = ADAPTER_CONFORMANCE_CASES[target.runtime];
      try {
        await campaign.runCase(caseId, { providerTurns: 2, maxEquivUsd: target.max_turn_budget_usd * 2 }, async () => {
          const result = await runAdapterConformance(
            runtime(target.runtime),
            {
              runtime: target.runtime,
              model: target.model,
              effort: target.effort,
              maxTurnBudgetUsd: target.max_turn_budget_usd,
            },
            workdir,
          );
          return {
            providerTurns: result.providerTurns,
            equivUsd: result.equivUsd,
            violationIds: result.violationIds,
            evidenceRefs: [`native-session:${target.runtime}:${result.sessionId}`],
          };
        });
      } catch (error) {
        errors.push(`${caseId}: ${errorMessage(error)}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it("runs the real GitHub conformance surface only on the exact sandbox repo", async () => {
    const errors: string[] = [];
    if (!config.github.enabled) return;
    let surface: RealGithubConformanceSurface | undefined;
    try {
      surface = await RealGithubConformanceSurface.create(config.github.repo);
      await campaign.runCase("CF-B01-L3", { providerTurns: 0, maxEquivUsd: 0 }, async () => {
        const report = await runGithubConformance(surface!, releaseGithubConformanceOptions());
        await surface!.cleanup();
        return githubConformanceCaseResult(config.github.repo, report);
      });
    } catch (error) {
      errors.push(`CF-B01-L3: ${errorMessage(error)}`);
    } finally {
      try {
        await surface?.cleanup();
      } catch (error) {
        errors.push(`CF-B01-L3-cleanup: ${errorMessage(error)}`);
      }
    }
    expect(GITHUB_CONFORMANCE_CLAUSE_COUNT).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it("installs, inspects and removes a uniquely identified real launchd definition", async () => {
    const errors: string[] = [];
    if (!config.launchd.enabled) return;
    const root = await mkdtemp(join(tmpdir(), "cormidia-live-launchd-"));
    const orgHome = join(root, "org");
    const stateHome = join(root, "state");
    await mkdir(orgHome, { recursive: true });
    await mkdir(stateHome, { recursive: true });
    const manager = new PlatformSchedulerManager({ backend: "launchd", platform: "darwin" });
    const input = {
      backend: "launchd" as const,
      orgName: config.launchd.label,
      orgHome,
      stateHome,
      packageEntryPath: resolve("tests/live/launchd-noop.mjs"),
      executablePath: process.execPath,
      cadenceMinutes: 60,
      manager,
    };
    const expected = buildSchedulerExpectation(input);
    try {
      await campaign.runCase("CF-J16-A", { providerTurns: 0, maxEquivUsd: 0 }, async () => {
        const installed = await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
        const status = await schedulerDefinitionStatus(input);
        const tickPath = join(stateHome, "scheduler", "launchd-proof-tick.json");
        await waitForFile(tickPath);
        const tick = JSON.parse(await readFile(tickPath, "utf8")) as {
          org_home?: unknown;
          state_home?: unknown;
          at?: unknown;
        };
        const attributableTick =
          tick.org_home === orgHome && tick.state_home === stateHome && typeof tick.at === "string";
        const removed = await uninstallScheduler({ ...input, execute: true, confirm: config.launchd.label });
        const afterRemoval = await schedulerDefinitionStatus(input);
        const exactRemoval = removed.changed && !afterRemoval.installed && afterRemoval.loaded === false;
        const violations = [
          ...(!(installed.changed && status.installed && status.loaded === true && attributableTick)
            ? ["CORMIDIA-C-B05-001:launchd-not-loaded"]
            : []),
          ...(!exactRemoval ? ["CORMIDIA-C-B05-001:launchd-not-removed"] : []),
        ];
        return {
          providerTurns: 0,
          equivUsd: 0,
          violationIds: violations,
          evidenceRefs: [
            `launchd:${expected.metadata.scheduler_id}:loaded=${String(status.loaded)}:tick=${String(attributableTick)}:removed=${String(exactRemoval)}`,
          ],
        };
      });
    } catch (error) {
      errors.push(`CF-J16-A: ${errorMessage(error)}`);
    } finally {
      try {
        await uninstallScheduler({ ...input, execute: true, confirm: config.launchd.label });
      } catch (error) {
        errors.push(`CF-J16-A-cleanup: ${errorMessage(error)}`);
      }
      await rm(root, { recursive: true, force: true });
    }
    expect(errors).toEqual([]);
  });

  it("proves the unattended profile adds zero human decisions and cannot widen to publication", async () => {
    if (!config.unattended.enabled) return;
    await campaign.runCase("CF-J18-A", { providerTurns: 0, maxEquivUsd: 0 }, async () => {
      const profile = createUnattendedValidationProfile(config.sandbox);
      const ceiling =
        config.campaign_kind === "release"
          ? { provider_turns: 24, equiv_usd: 100, release_campaign: true }
          : { provider_turns: 2, equiv_usd: 5, release_campaign: false };
      const budget = authorizeUnattendedValidationAction(profile, config.sandbox, {
        kind: "campaign_budget",
        ...ceiling,
      });
      const publication = authorizeUnattendedValidationAction(profile, config.sandbox, {
        kind: "external_publication",
        target: config.sandbox.repo,
      });
      const decidedAfter = (await new ApprovalStore(config.state_home).listDecidedReadOnly()).filter(
        (row) => !decidedBefore.has(row.id),
      );
      const violations = [
        ...(!budget.authorized ? ["CORMIDIA-C-B09B-001:profile-budget-not-authorized"] : []),
        ...(publication.authorized ? ["CORMIDIA-C-B09B-001:publication-widened"] : []),
        ...(decidedAfter.length > 0 ? ["CORMIDIA-C-B09B-001:human-decision-row-created"] : []),
      ];
      return {
        providerTurns: 0,
        equivUsd: 0,
        violationIds: violations,
        evidenceRefs: [`profile:${profile.identity}:human-decisions:${decidedAfter.length}`],
      };
    });
  });
});

/** Never a silent fall-through: an unwired kind in the token-spending lane
 *  must fail loudly, not quietly run a different provider's adapter. */
function runtime(kind: RuntimeKind): Runtime {
  if (kind === "claude") return new ClaudeRuntime();
  if (kind === "codex") return new CodexRuntime();
  if (kind === "cursor") return new CursorRuntime();
  if (kind === "muse") return new MuseRuntime();
  if (kind === "pi") return new PiRuntime();
  throw new Error(`live campaign: no real adapter wired for runtime ${JSON.stringify(kind)}`);
}
async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`launchd attributable tick did not appear: ${path}`);
}
