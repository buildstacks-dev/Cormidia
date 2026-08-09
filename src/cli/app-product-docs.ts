import { resolve } from "node:path";
import { resolveCormidiaHomes } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import {
  executeProductDocDisposition,
  planProductDocDisposition,
  PRODUCT_DOC_DISPOSITIONS,
  type ProductDocDisposition,
} from "../org/product-doc-disposition.js";
import { reportCliInvocation } from "./invocation-audit.js";

export async function cmdAppProductDocs(
  appName: string,
  args: string[],
  homeFlags: { orgHome?: string; stateHome?: string },
): Promise<number> {
  let workdir: string | undefined;
  let disposition: ProductDocDisposition | undefined;
  let execute = false;
  let confirm: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--execute") execute = true;
    else if (arg === "--json") json = true;
    else if (arg === "--workdir") workdir = needValue(args, ++index, "--workdir");
    else if (arg === "--disposition") disposition = parseDisposition(needValue(args, ++index, "--disposition"));
    else if (arg === "--confirm") confirm = needValue(args, ++index, "--confirm");
    else throw new Error(`app product-docs: unknown flag "${arg}"`);
  }
  if (workdir === undefined) throw new Error("app product-docs: --workdir <app-checkout> is required");
  if (disposition === undefined) {
    throw new Error(`app product-docs: --disposition ${PRODUCT_DOC_DISPOSITIONS.join("|")} is required`);
  }
  const expectedConfirmation = `${appName}:${disposition}`;
  if (execute && confirm !== expectedConfirmation) {
    throw new Error(`app product-docs: --execute requires --confirm ${expectedConfirmation}`);
  }
  if (!execute && confirm !== undefined) throw new Error("app product-docs: --confirm applies only with --execute");

  const homes = await resolveCormidiaHomes(homeFlags);
  const app = homes.appsFile.apps.find((candidate) => candidate.name === appName);
  if (app === undefined) throw new Error(`app product-docs: unknown app "${appName}" in apps.yaml`);
  const input = { workdir: resolve(workdir), app: appName, repository: app.repo, disposition };
  const result = execute ? await executeProductDocDisposition(input) : await planProductDocDisposition(input);
  reportCliInvocation({
    org: homes.appsFile.org.name,
    app: appName,
    dryRun: !execute,
    outcome: execute ? `product-docs-${disposition}-recorded` : `product-docs-${disposition}-preview`,
    provenance: { workdir: result.workdir, disposition },
  });
  if (json) {
    console.log(stableJson({ ...result, executed: execute }).trimEnd());
    return result.blockers.length === 0 ? 0 : 2;
  }
  console.log(`product documents (${execute ? "recorded" : "preview"}): ${appName} -> ${disposition}`);
  if (result.migrates_legacy_scaffold) console.log("  migrates recognized pre-manifest new-app scaffold");
  for (const document of result.documents) console.log(`  ${document.path}: ${document.status}`);
  for (const path of result.remove_paths) console.log(`  would remove exact scaffold placeholder: ${path}`);
  for (const blocker of result.blockers) console.log(`  blocked: ${blocker}`);
  if (!execute && result.blockers.length === 0) {
    console.log(
      `execute: cormidia app product-docs ${shellQuote(appName)} --workdir ${shellQuote(result.workdir)} ` +
        `--disposition ${disposition} --execute --confirm ${shellQuote(expectedConfirmation)}`,
    );
  }
  return result.blockers.length === 0 ? 0 : 2;
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
