import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { discoverLegacyProductDocScaffold, PRODUCT_DOC_PATHS } from "./product-doc-scaffold.js";

export const PRODUCT_DOC_DISPOSITIONS = ["keep", "reconcile", "remove"] as const;
export type ProductDocDisposition = (typeof PRODUCT_DOC_DISPOSITIONS)[number];

type DocumentStatus = "placeholder" | "replacement" | "absent";

interface ProductDocDocument {
  path: string;
  scaffold_sha256: string;
}

export interface ProductDocSnapshot {
  path: string;
  status: DocumentStatus;
  current_sha256: string | null;
}

interface ProductDocDecision {
  value: ProductDocDisposition;
  recorded_at: string;
  documents: Array<{ path: string; current_sha256: string | null }>;
}

interface ProductDocScaffoldRecord {
  schema_version: 1;
  kind: "cormidia-product-doc-scaffold";
  app: string;
  repository: string;
  template: "typescript-node" | "bare";
  documents: ProductDocDocument[];
  disposition: ProductDocDecision | null;
}

export const PRODUCT_DOC_RECORD_PATH = ".cormidia/bootstrap/product-docs.json";

export function renderProductDocScaffoldRecord(input: {
  app: string;
  repository: string;
  template: "typescript-node" | "bare";
  documents: Array<{ path: string; content: string }>;
}): string {
  if (!hasExpectedDocumentPaths(input.documents)) {
    throw new Error(`new-app: product document manifest must contain exactly ${PRODUCT_DOC_PATHS.join(", ")}`);
  }
  const record: ProductDocScaffoldRecord = {
    schema_version: 1,
    kind: "cormidia-product-doc-scaffold",
    app: input.app,
    repository: input.repository,
    template: input.template,
    documents: input.documents.map((document) => ({
      path: document.path,
      scaffold_sha256: sha256(document.content),
    })),
    disposition: null,
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function inspectProductDocScaffold(input: {
  workdir: string;
  app: string;
  repository: string;
}): Promise<{ record: ProductDocScaffoldRecord; documents: ProductDocSnapshot[]; legacy: boolean } | undefined> {
  const workdir = resolve(input.workdir);
  await refuseSymlinkedMetadataDirectories(workdir);
  const manifestPath = join(workdir, PRODUCT_DOC_RECORD_PATH);
  let record: ProductDocScaffoldRecord;
  let legacy = false;
  if (existsSync(manifestPath)) record = await readProductDocScaffoldRecord(manifestPath);
  else {
    const discovered = await discoverLegacyProductDocScaffold(workdir, input.app);
    if (discovered.kind === "none") return undefined;
    if (discovered.kind === "unresolved") {
      throw new Error(
        `app product-docs: legacy new-app scaffold requires explicit migration but ${discovered.reason}; ` +
          "restore its generated .cormidia/planning/0001-greenfield-seed.md before retrying",
      );
    }
    legacy = true;
    record = {
      schema_version: 1,
      kind: "cormidia-product-doc-scaffold",
      app: input.app,
      repository: input.repository,
      template: discovered.template,
      documents: discovered.documents.map((document) => ({
        path: document.path,
        scaffold_sha256: sha256(document.content),
      })),
      disposition: null,
    };
  }
  assertIdentity(record, input.app, input.repository);
  const documents = await snapshotProductDocDocuments(workdir, record.documents);
  return { record, documents, legacy };
}

export async function readProductDocScaffoldRecord(path: string): Promise<ProductDocScaffoldRecord> {
  let value: unknown;
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("manifest is a symbolic link");
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`app product-docs: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error(`app product-docs: ${path} is not a valid v1 scaffold record`);
  return value;
}

export async function snapshotProductDocDocuments(
  root: string,
  documents: ProductDocDocument[],
): Promise<ProductDocSnapshot[]> {
  const docsRoot = join(root, "docs");
  if (existsSync(docsRoot) && (await lstat(docsRoot)).isSymbolicLink()) {
    throw new Error("app product-docs: docs is a symbolic link");
  }
  return Promise.all(
    documents.map(async (document) => {
      const path = join(root, document.path);
      if (!existsSync(path)) return { path: document.path, status: "absent" as const, current_sha256: null };
      if ((await lstat(path)).isSymbolicLink())
        throw new Error(`app product-docs: ${document.path} is a symbolic link`);
      const current = sha256(await readFile(path));
      return {
        path: document.path,
        status: current === document.scaffold_sha256 ? ("placeholder" as const) : ("replacement" as const),
        current_sha256: current,
      };
    }),
  );
}

function isRecord(value: unknown): value is ProductDocScaffoldRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ProductDocScaffoldRecord>;
  return (
    record.schema_version === 1 &&
    record.kind === "cormidia-product-doc-scaffold" &&
    typeof record.app === "string" &&
    typeof record.repository === "string" &&
    (record.template === "typescript-node" || record.template === "bare") &&
    Array.isArray(record.documents) &&
    hasExpectedDocumentPaths(record.documents) &&
    record.documents.every(
      (document) => typeof document.path === "string" && /^[0-9a-f]{64}$/.test(document.scaffold_sha256),
    ) &&
    (record.disposition === null ||
      (record.disposition !== undefined && isDecision(record.disposition, record.documents)))
  );
}

function isDecision(value: ProductDocDecision, documents: ProductDocDocument[]): boolean {
  return (
    PRODUCT_DOC_DISPOSITIONS.includes(value.value) &&
    Number.isFinite(Date.parse(value.recorded_at)) &&
    Array.isArray(value.documents) &&
    samePaths(value.documents, documents) &&
    value.documents.every(
      (document) =>
        typeof document.path === "string" &&
        (document.current_sha256 === null || /^[0-9a-f]{64}$/.test(document.current_sha256)),
    )
  );
}

function hasExpectedDocumentPaths(documents: Array<{ path: string }>): boolean {
  return samePaths(
    documents,
    PRODUCT_DOC_PATHS.map((path) => ({ path })),
  );
}

function samePaths(left: Array<{ path: string }>, right: Array<{ path: string }>): boolean {
  return left.length === right.length && left.every((document, index) => document.path === right[index]?.path);
}

function assertIdentity(record: ProductDocScaffoldRecord, app: string, repository: string): void {
  if (record.app !== app || record.repository !== repository) {
    throw new Error(
      `app product-docs: scaffold identity is ${record.app}/${record.repository}, not ${app}/${repository}`,
    );
  }
}

async function refuseSymlinkedMetadataDirectories(workdir: string): Promise<void> {
  for (const relative of [".cormidia", ".cormidia/bootstrap", ".cormidia/planning"]) {
    const path = join(workdir, relative);
    if (existsSync(path) && (await lstat(path)).isSymbolicLink()) {
      throw new Error(`app product-docs: ${relative} is a symbolic link`);
    }
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
