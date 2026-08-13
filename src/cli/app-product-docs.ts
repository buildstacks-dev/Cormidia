// `cormidia app product-docs` — record the keep/reconcile/remove decision for a
// new-app scaffold's optional product documents, and publish it (#369, #389).
//
// Execution deliberately does NOT stop at a local manifest edit. Live planning
// reads Cormidia's managed checkout, synchronized from the app remote, so a
// decision that never left the operator's working tree is invisible to the read
// side — which is how `recorded` and "no disposition" were both true at once.
// `--execute` therefore records AND publishes; `--publish` resumes a decision
// that is already recorded without re-recording it.

import { resolve } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeProductDocDisposition,
  planProductDocDisposition,
  PRODUCT_DOC_DISPOSITIONS,
  type ProductDocDisposition,
} from "../org/product-doc-disposition.js";
import {
  executeProductDocPublication,
  planProductDocPublication,
  type ProductDocPublicationPlan,
} from "../org/product-doc-publication.js";
import { inspectProductDocScaffold } from "../org/product-doc-record.js";
import { reportCliInvocation } from "./invocation-audit.js";

export async function cmdAppProductDocs(
  appName: string,
  args: string[],
  homeFlags: { orgHome?: string; stateHome?: string },
): Promise<number> {
  const parsed = parseArgs(appName, args);
  const homes = await resolveCormidiaHomes(homeFlags);
  const app = homes.appsFile.apps.find((candidate) => candidate.name === appName);
  if (app === undefined) throw new Error(`app product-docs: unknown app "${appName}" in apps.yaml`);
  const workdir = resolve(parsed.workdir);

  const disposition = parsed.publishOnly
    ? await recordedDisposition(workdir, appName, app.repo)
    : requireDisposition(parsed.disposition);
  const input = { workdir, app: appName, repository: app.repo, disposition };

  // Record first (unless resuming), then publish. `already_recorded` makes the
  // record half a no-op, so a resume never rewrites a decision it did not make.
  const result =
    parsed.execute && !parsed.publishOnly
      ? await executeProductDocDisposition(input)
      : await planProductDocDisposition(input);

  const publication = await resolvePublication({
    workdir,
    app: appName,
    repository: app.repo,
    disposition,
    stateHome: homes.stateHome,
    removePaths: result.remove_paths,
    execute: parsed.execute && result.blockers.length === 0,
  });

  reportCliInvocation({
    org: homes.appsFile.org.name,
    app: appName,
    dryRun: !parsed.execute,
    outcome: parsed.execute
      ? `product-docs-${disposition}-${publication.durability}`
      : `product-docs-${disposition}-preview`,
    provenance: { workdir: result.workdir, disposition },
  });

  if (parsed.json) {
    console.log(
      stableJson({ ...result, executed: parsed.execute, publication: publicationJson(publication) }).trimEnd(),
    );
    return result.blockers.length === 0 ? 0 : 2;
  }
  printText({ appName, parsed, disposition, result, publication });
  return result.blockers.length === 0 ? 0 : 2;
}

interface ParsedArgs {
  workdir: string;
  disposition?: ProductDocDisposition;
  execute: boolean;
  publishOnly: boolean;
  json: boolean;
}

async function resolvePublication(input: {
  workdir: string;
  app: string;
  repository: string;
  disposition: ProductDocDisposition;
  stateHome: string;
  removePaths: readonly string[];
  execute: boolean;
}): Promise<ProductDocPublicationPlan> {
  const planInput = { workdir: input.workdir, app: input.app, removePaths: input.removePaths };
  if (!input.execute) return planProductDocPublication(planInput);
  const executed = await executeProductDocPublication({
    ...planInput,
    stateHome: input.stateHome,
    repository: input.repository,
    disposition: input.disposition,
  });
  return executed.plan;
}

function printText(context: {
  appName: string;
  parsed: ParsedArgs;
  disposition: ProductDocDisposition;
  result: Awaited<ReturnType<typeof planProductDocDisposition>>;
  publication: ProductDocPublicationPlan;
}): void {
  const { appName, parsed, disposition, result, publication } = context;
  const verb = parsed.execute ? (parsed.publishOnly ? "publishing" : "recorded") : "preview";
  console.log(`product documents (${verb}): ${appName} -> ${disposition}`);
  if (result.migrates_legacy_scaffold) console.log("  migrates recognized pre-manifest new-app scaffold");
  for (const document of result.documents) console.log(`  ${document.path}: ${document.status}`);
  for (const path of result.remove_paths) console.log(`  would remove exact scaffold placeholder: ${path}`);
  for (const blocker of result.blockers) console.log(`  blocked: ${blocker}`);
  for (const blocker of publication.preflight.blockers) console.log(`  publication blocked: ${blocker}`);
  console.log(`  durability: ${publication.durability}`);
  console.log(`  next: ${publication.next_action}`);
  if (!parsed.execute && result.blockers.length === 0) {
    console.log(
      `execute: cormidia app product-docs ${shellQuote(appName)} --workdir ${shellQuote(result.workdir)} ` +
        `--disposition ${disposition} --execute --confirm ${shellQuote(`${appName}:${disposition}`)}`,
    );
  }
}

function publicationJson(plan: ProductDocPublicationPlan): Record<string, unknown> {
  return {
    durability: plan.durability,
    next_action: plan.next_action,
    publish_command: plan.publish_command,
    mode: plan.preflight.mode,
    branch: plan.preflight.branch,
    base: plan.preflight.base,
    owned_paths: plan.preflight.owned_paths,
    changed_paths: plan.preflight.changed_paths,
    blockers: plan.preflight.blockers,
    content_id: plan.preflight.content_id,
  };
}

/** The decision `--publish` resumes. Refusing here is the point: publishing
 *  "the recorded decision" when none exists would invent one. */
async function recordedDisposition(workdir: string, app: string, repository: string): Promise<ProductDocDisposition> {
  const inspected = await inspectProductDocScaffold({ workdir, app, repository });
  const recorded = inspected?.record.disposition?.value;
  if (recorded === undefined) {
    throw new Error(
      `app product-docs: --publish needs a disposition already recorded in ${workdir}; ` +
        `record one first with --disposition ${PRODUCT_DOC_DISPOSITIONS.join("|")} --execute`,
    );
  }
  return recorded;
}

function requireDisposition(disposition: ProductDocDisposition | undefined): ProductDocDisposition {
  if (disposition === undefined) {
    throw new Error(`app product-docs: --disposition ${PRODUCT_DOC_DISPOSITIONS.join("|")} is required`);
  }
  return disposition;
}

function parseArgs(appName: string, args: string[]): ParsedArgs {
  let workdir: string | undefined;
  let disposition: ProductDocDisposition | undefined;
  let execute = false;
  let publishOnly = false;
  let confirm: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--execute") execute = true;
    else if (arg === "--publish") publishOnly = true;
    else if (arg === "--json") json = true;
    else if (arg === "--workdir") workdir = needValue(args, ++index, "--workdir");
    else if (arg === "--disposition") disposition = parseDisposition(needValue(args, ++index, "--disposition"));
    else if (arg === "--confirm") confirm = needValue(args, ++index, "--confirm");
    else throw new Error(`app product-docs: unknown flag "${arg}"`);
  }
  if (workdir === undefined) throw new Error("app product-docs: --workdir <app-checkout> is required");
  if (publishOnly && disposition !== undefined) {
    throw new Error("app product-docs: --publish resumes the recorded decision; it takes no --disposition");
  }
  if (!publishOnly && disposition === undefined) {
    throw new Error(`app product-docs: --disposition ${PRODUCT_DOC_DISPOSITIONS.join("|")} is required`);
  }
  const expected = publishOnly ? `${appName}:publish` : `${appName}:${disposition ?? ""}`;
  if (execute && confirm !== expected) throw new Error(`app product-docs: --execute requires --confirm ${expected}`);
  if (!execute && confirm !== undefined) throw new Error("app product-docs: --confirm applies only with --execute");
  return { workdir, ...(disposition === undefined ? {} : { disposition }), execute, publishOnly, json };
}

function parseDisposition(value: string): ProductDocDisposition {
  const disposition = PRODUCT_DOC_DISPOSITIONS.find((candidate) => candidate === value);
  if (disposition === undefined) {
    throw new Error(`app product-docs: --disposition must be ${PRODUCT_DOC_DISPOSITIONS.join(" | ")}`);
  }
  return disposition;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`app product-docs: ${flag} requires a value`);
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
