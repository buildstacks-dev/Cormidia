// Strict, explicit authorization envelope for the token-spending / external-
// target L3 lane. Environment flags select a reviewed file; they never carry
// enough information to widen target or spend scope by themselves.

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { RELEASE_L3_REQUIRED_CASES } from "../../src/org/release-evidence.js";
import type { Effort, RuntimeKind } from "../../src/runtime/types.js";

export interface LiveAdapterTarget {
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  max_turn_budget_usd: number;
}

export interface LiveCampaignConfigV1 {
  schema_version: 1;
  campaign_id: string;
  campaign_kind: "pre_merge_adapter" | "github_smoke" | "launchd_proof" | "release";
  human_authorization: {
    human_initiated: true;
    authorized_by: string;
    authorized_at: string;
    purpose: string;
  };
  state_home: string;
  policy_path: string;
  commit: string;
  sandbox: { org: string; app: string; repo: string };
  adapters: LiveAdapterTarget[];
  github: { enabled: boolean; repo: string };
  launchd: { enabled: boolean; label: string };
  unattended: { enabled: boolean; permitted_auto_grant_categories: ["campaign_budget"] };
}

export async function loadLiveCampaignConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: LiveCampaignConfigV1; path: string }> {
  if (env["CORMIDIA_LIVE"] !== "1")
    throw new Error("live validation refused: CORMIDIA_LIVE=1 is required (lane is incomplete, not skipped)");
  const configured = env["CORMIDIA_LIVE_CONFIG"];
  if (configured === undefined || configured.trim() === "")
    throw new Error("live validation refused: CORMIDIA_LIVE_CONFIG must name a reviewed authorization file");
  if (!isAbsolute(configured))
    throw new Error("live validation refused: CORMIDIA_LIVE_CONFIG must be an absolute path");
  const path = resolve(configured);
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  validate(value);
  return { config: value, path };
}

/** Keep the durable L3 report's ordered identity on the same canonical source
 * as the RQ-1 manifest. Case execution may occur in a different safe order;
 * report identity may not be reconstructed independently (#303). */
export function liveCampaignRequiredCaseIds(config: LiveCampaignConfigV1): string[] {
  if (config.campaign_kind === "release") return [...RELEASE_L3_REQUIRED_CASES];
  return [
    ...config.adapters.map(
      (target) =>
        ({
          claude: "CF-B02-L3",
          codex: "CF-B03-L3",
          pi: "CF-B04-L3",
          muse: "CF-B26-L3",
        })[target.runtime],
    ),
    ...(config.github.enabled ? ["CF-B01-L3"] : []),
    ...(config.launchd.enabled ? ["CF-J16-A"] : []),
    ...(config.unattended.enabled ? ["CF-J18-A"] : []),
  ];
}

function validate(value: unknown): asserts value is LiveCampaignConfigV1 {
  const root = object(value, "live config");
  exact(root, [
    "schema_version",
    "campaign_id",
    "campaign_kind",
    "human_authorization",
    "state_home",
    "policy_path",
    "commit",
    "sandbox",
    "adapters",
    "github",
    "launchd",
    "unattended",
  ]);
  if (root["schema_version"] !== 1) throw new Error("live config schema_version must be 1");
  required(root["campaign_id"], "campaign_id");
  const campaignKind = oneOf(
    root["campaign_kind"],
    ["pre_merge_adapter", "github_smoke", "launchd_proof", "release"],
    "campaign_kind",
  );
  for (const name of ["state_home", "policy_path"] as const) {
    const path = required(root[name], name);
    if (!isAbsolute(path)) throw new Error(`${name} must be absolute`);
  }
  if (!/^[a-f0-9]{40}$/.test(required(root["commit"], "commit")))
    throw new Error("commit must be an exact 40-character git oid");

  const authorization = object(root["human_authorization"], "human_authorization");
  exact(authorization, ["human_initiated", "authorized_by", "authorized_at", "purpose"]);
  if (authorization["human_initiated"] !== true) throw new Error("human_authorization.human_initiated must be true");
  required(authorization["authorized_by"], "human_authorization.authorized_by");
  required(authorization["purpose"], "human_authorization.purpose");
  if (!Number.isFinite(Date.parse(required(authorization["authorized_at"], "human_authorization.authorized_at"))))
    throw new Error("human_authorization.authorized_at must be an instant");

  const sandbox = object(root["sandbox"], "sandbox");
  exact(sandbox, ["org", "app", "repo"]);
  required(sandbox["org"], "sandbox.org");
  required(sandbox["app"], "sandbox.app");
  const repo = required(sandbox["repo"], "sandbox.repo");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("sandbox.repo must be an exact owner/repo slug");

  if (!Array.isArray(root["adapters"])) throw new Error("adapters must be an array");
  for (const [index, unknownAdapter] of root["adapters"].entries()) {
    const adapter = object(unknownAdapter, `adapters[${index}]`);
    exact(adapter, ["runtime", "model", "effort", "max_turn_budget_usd"]);
    oneOf(adapter["runtime"], ["claude", "codex", "pi", "muse"], `adapters[${index}].runtime`);
    required(adapter["model"], `adapters[${index}].model`);
    oneOf(adapter["effort"], ["low", "medium", "high", "xhigh", "max"], `adapters[${index}].effort`);
    positive(adapter["max_turn_budget_usd"], `adapters[${index}].max_turn_budget_usd`);
  }
  if (
    new Set((root["adapters"] as Array<Record<string, unknown>>).map((entry) => entry["runtime"])).size !==
    root["adapters"].length
  ) {
    throw new Error("adapters must contain at most one target per runtime");
  }
  const github = object(root["github"], "github");
  exact(github, ["enabled", "repo"]);
  bool(github["enabled"], "github.enabled");
  if (required(github["repo"], "github.repo") !== repo)
    throw new Error("github.repo must equal the exact sandbox repo");
  const launchd = object(root["launchd"], "launchd");
  exact(launchd, ["enabled", "label"]);
  bool(launchd["enabled"], "launchd.enabled");
  required(launchd["label"], "launchd.label");
  const unattended = object(root["unattended"], "unattended");
  exact(unattended, ["enabled", "permitted_auto_grant_categories"]);
  bool(unattended["enabled"], "unattended.enabled");
  if (JSON.stringify(unattended["permitted_auto_grant_categories"]) !== JSON.stringify(["campaign_budget"]))
    throw new Error("unattended profile permits only campaign_budget");

  const runtimes = new Set((root["adapters"] as Array<Record<string, unknown>>).map((entry) => entry["runtime"]));
  const shape = {
    adapters: root["adapters"].length,
    github: github["enabled"] === true,
    launchd: launchd["enabled"] === true,
    unattended: unattended["enabled"] === true,
  };
  if (
    campaignKind === "pre_merge_adapter" &&
    (shape.adapters !== 1 || shape.github || shape.launchd || shape.unattended)
  ) {
    throw new Error("pre_merge_adapter must target exactly one changed adapter and no other live obligation");
  }
  if (campaignKind === "github_smoke" && (shape.adapters !== 0 || !shape.github || shape.launchd || shape.unattended)) {
    throw new Error("github_smoke must target only the exact sandbox GitHub repo");
  }
  if (
    campaignKind === "launchd_proof" &&
    (shape.adapters !== 0 || shape.github || !shape.launchd || shape.unattended)
  ) {
    throw new Error("launchd_proof must target only the exact launchd definition");
  }
  if (campaignKind === "release") {
    const allAdapters = runtimes.size === 3 && ["claude", "codex", "pi"].every((runtime) => runtimes.has(runtime));
    if (!allAdapters || !shape.github || !shape.launchd || !shape.unattended) {
      throw new Error(
        "release campaign requires all three adapters, sandbox GitHub, launchd proof, and the unattended profile",
      );
    }
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) throw new Error(`unknown live config field(s): ${extra.join(", ")}`);
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}
function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}
function oneOf<const T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}
