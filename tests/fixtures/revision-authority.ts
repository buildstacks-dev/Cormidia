import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseQualificationHostPolicy, type QualificationHostPolicy } from "../../src/org/qualification-host-policy.js";
import {
  compileCheckedModel,
  HOST_POLICY_RELATIVE_PATH,
  readExactCommittedGeneratedViews,
  resolveValidationProductRevision,
  selectValidationAuthority,
} from "./validation-authority.js";

export interface RevisionAuthorityFacts {
  hostPolicy: QualificationHostPolicy;
  familyIds: ReadonlySet<string>;
  modelStructureIds: ReadonlySet<string> | null;
  kind: "legacy" | "model";
}

export async function loadRevisionAuthorityFacts(
  root: string,
  hostPolicyOverride?: string,
): Promise<RevisionAuthorityFacts> {
  const hostText = hostPolicyOverride ?? (await readFile(join(root, HOST_POLICY_RELATIVE_PATH), "utf8"));
  const hostPolicy = parseQualificationHostPolicy(hostText);
  const selection = selectValidationAuthority(root);
  if (selection.kind === "legacy") {
    return {
      hostPolicy,
      familyIds: parseAnyTableFirstCellIds(await readFile(join(root, "validation-design/case-catalog.md"), "utf8")),
      modelStructureIds: null,
      kind: "legacy",
    };
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const productRevision = resolveValidationProductRevision(root, head);
  const compiled = await compileCheckedModel(root, productRevision);
  const committedViews = readExactCommittedGeneratedViews(root, head);
  for (const [name, content] of Object.entries(committedViews)) {
    if (compiled.views[name] !== content) throw new Error(`public compiler view ${name} differs from committed bytes`);
  }
  const caseCatalog = committedViews["case-catalog.md"];
  const plannedTrace = committedViews["planned-trace.md"];
  if (caseCatalog === undefined || plannedTrace === undefined)
    throw new Error("public compiler returned incomplete generated views");
  return {
    hostPolicy,
    familyIds: parseGeneratedTableIds(caseCatalog, "Family"),
    modelStructureIds: parseGeneratedTableIds(plannedTrace, "Structure"),
    kind: "model",
  };
}

export function parseGeneratedTableIds(markdown: string, heading: "Family" | "Structure"): ReadonlySet<string> {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => line.startsWith(`| ${heading} |`));
  if (header < 0) return new Set();
  const ids = new Set<string>();
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const first = line.split("|")[1]?.trim();
    if (first !== undefined && first !== "") ids.add(first.replaceAll("`", ""));
  }
  return ids;
}

export function missingCanonicalModelStructureIds(required: readonly string[], actual: ReadonlySet<string>): string[] {
  return required.filter((id) => !actual.has(id));
}

function parseAnyTableFirstCellIds(markdown: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1]?.trim();
    if (first !== undefined && first !== "" && !/^:?-+:?$/.test(first)) ids.add(first.replaceAll("`", ""));
  }
  return ids;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
