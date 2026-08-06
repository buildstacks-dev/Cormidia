// Objective-grant CLI (#296 Stage 3; proposal §4.1/§6/§7). Human-facing only:
// this is the ONE write path for objective grants, exactly as `approvals` is
// for A1 grants — the store rejects agent-namespaced identities, and the gate
// classifies `cormidia objective grant|grant-critical|revoke` from inside a
// turn as approval-store-tamper.
//
// `grant-critical` is deliberately a DISTINCT VERB, not a flag on `grant`:
// §4.1 requires that covering a human-only class is unreachable by muscle
// memory. It names exactly one class per invocation, requires a bounded
// per-class scope, and enforces TTL/use caps strictly shorter than the
// ordinary defaults.

import { join, resolve } from "node:path";
import { loadApps } from "../org/apps.js";
import { resolveCormidiaHomes } from "../org/home.js";
import {
  ObjectiveGrantStore,
  type CreateObjectiveGrantInput,
  type ObjectiveGrant,
} from "../org/objective-grants.js";
import { extractHomeFlags } from "./home-flags.js";

interface ParsedObjectiveArgs {
  subcommand: "grant" | "grant-critical" | "list" | "revoke";
  app?: string;
  objective?: string;
  classes: string[];
  criticalClass?: string;
  scope?: string;
  precondition?: string;
  repo?: string;
  by?: string;
  ceilingUsd?: number;
  ttlHours?: number;
  uses?: number;
  grantId?: string;
  now: Date;
  json: boolean;
}

export async function cmdObjective(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "objective");
  const parsed = parseArgs(common.rest);
  const homes = await resolveCormidiaHomes(common);
  const stateHome = common.stateHome ? resolve(common.stateHome) : homes.stateHome;
  const store = new ObjectiveGrantStore(stateHome);

  if (parsed.subcommand === "list") {
    const grants = store
      .listSync()
      .filter((grant) => parsed.app === undefined || grant.app === parsed.app)
      .map((grant) => ({ ...grant, spentUsd: store.ledgerTotalSync(grant.grantId) }));
    if (parsed.json) {
      console.log(JSON.stringify({ schema_version: 1, kind: "objective-grants", grants }, null, 2));
    } else if (grants.length === 0) {
      console.log("no objective grants");
    } else {
      for (const grant of grants) {
        const state = grant.revokedAt !== undefined
          ? "revoked"
          : new Date(grant.expiresAt).getTime() <= parsed.now.getTime()
            ? "expired"
            : "live";
        console.log(
          `${grant.grantId}  ${grant.app}  ${state}  $${grant.spentUsd.toFixed(2)}/$${grant.spendCeilingUsd}  ` +
            `uses ${grant.usesRemaining}  ${grant.objective}`,
        );
      }
    }
    return 0;
  }

  if (parsed.subcommand === "revoke") {
    if (parsed.grantId === undefined) throw new Error("objective revoke: grant id required");
    const revoked = store.revokeSync(parsed.grantId, parsed.now);
    if (parsed.json) {
      console.log(JSON.stringify({ schema_version: 1, kind: "objective-grant-revocation", revoked }, null, 2));
    } else {
      console.log(`revoked ${revoked.grantId} (${revoked.objective})`);
    }
    return 0;
  }

  // grant / grant-critical — the two creation verbs.
  if (parsed.app === undefined) throw new Error(`objective ${parsed.subcommand}: --app required`);
  if (parsed.objective === undefined) throw new Error(`objective ${parsed.subcommand}: --objective required`);
  if (parsed.by === undefined) throw new Error(`objective ${parsed.subcommand}: --by <identity> required`);
  if (parsed.repo === undefined) throw new Error(`objective ${parsed.subcommand}: --repo <owner/repo> required`);

  // The ceiling default is CONFIGURED, never hardcoded: resolved from the
  // org registry exactly like budget_usd_month (per-app objective_budget_usd,
  // falling back to defaults.objective_budget_usd).
  let ceilingUsd = parsed.ceilingUsd;
  if (ceilingUsd === undefined) {
    const apps = await loadApps(join(homes.orgHome, "apps.yaml"));
    const app = apps.apps.find((entry) => entry.name === parsed.app);
    if (app === undefined) {
      throw new Error(
        `objective ${parsed.subcommand}: app "${parsed.app}" is not registered; ` +
          `pass --ceiling <usd> or register the app first`,
      );
    }
    ceilingUsd = app.objectiveBudgetUsd;
  }

  const input: CreateObjectiveGrantInput = {
    app: parsed.app,
    objective: parsed.objective,
    createdBy: parsed.by,
    repoNamespace: parsed.repo,
    spendCeilingUsd: ceilingUsd,
    now: parsed.now,
    ...(parsed.ttlHours !== undefined ? { ttlMs: parsed.ttlHours * 60 * 60 * 1000 } : {}),
    ...(parsed.uses !== undefined ? { useCap: parsed.uses } : {}),
  };

  let grant: ObjectiveGrant;
  if (parsed.subcommand === "grant-critical") {
    if (parsed.criticalClass === undefined) {
      throw new Error("objective grant-critical: --class <rule> required (exactly one per invocation)");
    }
    if (parsed.scope === undefined) {
      throw new Error(
        'objective grant-critical: --scope <bound> required — "publish anything" is a blank cheque',
      );
    }
    if (parsed.classes.length > 0) {
      throw new Error("objective grant-critical: use --class, never --classes (one class per invocation)");
    }
    grant = store.createSync({
      ...input,
      criticalClasses: [
        {
          rule: parsed.criticalClass,
          scope: parsed.scope,
          ...(parsed.precondition !== undefined ? { precondition: parsed.precondition } : {}),
        },
      ],
    });
  } else {
    if (parsed.classes.length === 0) {
      throw new Error("objective grant: --classes <rule[,rule...]> required");
    }
    if (parsed.criticalClass !== undefined || parsed.scope !== undefined) {
      throw new Error(
        "objective grant: --class/--scope belong to the grant-critical ceremony verb — " +
          "covering a human-only class is deliberately not reachable from the ordinary path",
      );
    }
    grant = store.createSync({ ...input, classes: parsed.classes });
  }

  if (parsed.json) {
    console.log(JSON.stringify({ schema_version: 1, kind: "objective-grant", grant }, null, 2));
  } else {
    console.log(
      `created ${grant.grantId} for ${grant.app}: ${grant.objective}\n` +
        `  covers ${[...grant.classes, ...grant.criticalClasses.map((c) => `${c.rule} (scope: ${c.scope})`)].join(", ")}\n` +
        `  ceiling $${grant.spendCeilingUsd}, uses ${grant.usesRemaining}, expires ${grant.expiresAt}\n` +
        `  revoke with: cormidia objective revoke ${grant.grantId}`,
    );
  }
  return 0;
}

function parseArgs(args: string[]): ParsedObjectiveArgs {
  let subcommand: ParsedObjectiveArgs["subcommand"] | undefined;
  const parsed: Omit<ParsedObjectiveArgs, "subcommand"> = { classes: [], now: new Date(), json: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--now") parsed.now = new Date(needValue(args, ++i, "--now"));
    else if (arg === "--app") parsed.app = needValue(args, ++i, "--app");
    else if (arg === "--objective") parsed.objective = needValue(args, ++i, "--objective");
    else if (arg === "--classes") {
      parsed.classes = needValue(args, ++i, "--classes").split(",").map((value) => value.trim()).filter(Boolean);
    } else if (arg === "--class") parsed.criticalClass = needValue(args, ++i, "--class");
    else if (arg === "--scope") parsed.scope = needValue(args, ++i, "--scope");
    else if (arg === "--precondition") parsed.precondition = needValue(args, ++i, "--precondition");
    else if (arg === "--repo") parsed.repo = needValue(args, ++i, "--repo");
    else if (arg === "--by") parsed.by = needValue(args, ++i, "--by");
    else if (arg === "--ceiling") parsed.ceilingUsd = positiveNumber(needValue(args, ++i, "--ceiling"), "--ceiling");
    else if (arg === "--ttl-hours") parsed.ttlHours = positiveNumber(needValue(args, ++i, "--ttl-hours"), "--ttl-hours");
    else if (arg === "--uses") parsed.uses = positiveNumber(needValue(args, ++i, "--uses"), "--uses");
    else if (["grant", "grant-critical", "list", "revoke"].includes(arg) && subcommand === undefined) {
      subcommand = arg as ParsedObjectiveArgs["subcommand"];
    } else if (subcommand === "revoke" && parsed.grantId === undefined && !arg.startsWith("--")) {
      parsed.grantId = arg;
    } else {
      throw new Error(`objective: unknown argument "${arg}"`);
    }
  }
  if (subcommand === undefined) {
    throw new Error("objective: subcommand required (grant | grant-critical | list | revoke)");
  }
  return { subcommand, ...parsed };
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`objective: ${flag} requires a value`);
  return value;
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`objective: ${flag} must be a positive number`);
  return parsed;
}
