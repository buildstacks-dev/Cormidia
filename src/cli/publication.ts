import { GhCliOps } from "../loop/github.js";
import { listPlannerPublications, resumePlannerPublication } from "../org/planner-publication.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdPublication(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "publication");
  const [verb = "list", ...rest] = common.rest;
  const homes = await resolveCormidiaHomes(common);
  if (verb === "list") {
    const parsed = parse(rest, false);
    const records = await listPlannerPublications(homes.stateHome, parsed.app);
    if (parsed.json) console.log(JSON.stringify(records, null, 2));
    else for (const record of records) print(record);
    return records.some((record) => record.state === "publication_pending" || record.state === "refused") ? 1 : 0;
  }
  if (verb !== "resume") throw new Error(`publication: expected list or resume, got ${verb}`);
  const parsed = parse(rest, true);
  const app = homes.appsFile.apps.find((entry) => entry.name === parsed.app);
  if (app === undefined) throw new Error(`publication: unknown app ${parsed.app}`);
  const record = await resumePlannerPublication({
    stateHome: homes.stateHome,
    app,
    publicationId: parsed.id!,
    gh: new GhCliOps(app.repo),
    now: new Date(),
  });
  if (parsed.json) console.log(JSON.stringify(record, null, 2));
  else print(record);
  return record.state === "published" ? 0 : 1;
}

function parse(args: string[], requireIdentity: boolean): { app?: string; id?: string; json: boolean } {
  const out: { app?: string; id?: string; json: boolean } = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--app") out.app = need(args, ++index, arg);
    else if (arg === "--id") out.id = need(args, ++index, arg);
    else if (arg === "--json") out.json = true;
    else throw new Error(`publication: unknown argument ${arg}`);
  }
  if (requireIdentity && (out.app === undefined || out.id === undefined)) {
    throw new Error("publication resume requires --app <app> --id <publication-id>");
  }
  return out;
}

function print(record: Awaited<ReturnType<typeof listPlannerPublications>>[number]): void {
  console.log(
    `${record.publication_id} ${record.app} ${record.state} ` +
      `${record.branch_created ? `${record.branch}@${record.commit}` : "read-only"}`,
  );
  if (record.error !== null) console.log(`  ${record.error.code}: ${record.error.message}`);
  if (record.state !== "published") console.log(`  ${record.recovery.command}`);
}

function need(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`publication: ${flag} requires a value`);
  return value;
}
