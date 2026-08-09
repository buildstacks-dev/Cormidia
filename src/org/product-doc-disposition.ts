import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import {
  inspectProductDocScaffold,
  PRODUCT_DOC_DISPOSITIONS,
  PRODUCT_DOC_RECORD_PATH,
  type ProductDocDisposition,
  type ProductDocSnapshot,
  readProductDocScaffoldRecord,
  snapshotProductDocDocuments,
} from "./product-doc-record.js";
import {
  commitProductDocRemoval,
  productDocRemovalStagingBlocker,
  recoverProductDocRemoval,
  rollbackProductDocRemoval,
  stageProductDocRemoval,
  type ProductDocRemovalStage,
} from "./product-doc-removal.js";

export { PRODUCT_DOC_DISPOSITIONS, type ProductDocDisposition };

interface ProductDocDispositionPlan {
  schema_version: 1;
  kind: "product-doc-disposition-plan";
  app: string;
  repository: string;
  workdir: string;
  manifest_path: string;
  disposition: ProductDocDisposition;
  documents: ProductDocSnapshot[];
  remove_paths: string[];
  blockers: string[];
  already_recorded: boolean;
  migrates_legacy_scaffold: boolean;
}

export async function planProductDocDisposition(input: {
  workdir: string;
  app: string;
  repository: string;
  disposition: ProductDocDisposition;
}): Promise<ProductDocDispositionPlan> {
  const workdir = resolve(input.workdir);
  const manifestPath = join(workdir, PRODUCT_DOC_RECORD_PATH);
  const inspected = await inspectProductDocScaffold(input);
  if (inspected === undefined) {
    throw new Error(`app product-docs: ${manifestPath} does not identify a new-app scaffold`);
  }
  const { record, documents, legacy } = inspected;
  const blockers: string[] = [];
  if (input.disposition === "keep") {
    for (const document of documents) {
      if (document.status === "absent") blockers.push(`${document.path}: keep requires the reviewed document to exist`);
    }
  }
  if (input.disposition === "remove") {
    for (const document of documents) {
      if (document.status === "replacement") {
        blockers.push(`${document.path}: remove never deletes a user-authored replacement; delete it explicitly first`);
      }
    }
  }
  const stagingBlocker = productDocRemovalStagingBlocker(workdir);
  if (stagingBlocker !== undefined) blockers.push(stagingBlocker);
  const decided = record.disposition;
  return {
    schema_version: 1,
    kind: "product-doc-disposition-plan",
    app: input.app,
    repository: input.repository,
    workdir,
    manifest_path: manifestPath,
    disposition: input.disposition,
    documents,
    remove_paths:
      input.disposition === "remove"
        ? documents.filter((document) => document.status === "placeholder").map((document) => document.path)
        : [],
    blockers,
    already_recorded: decided?.value === input.disposition && sameDecisionDocuments(decided.documents, documents),
    migrates_legacy_scaffold: legacy,
  };
}

export async function executeProductDocDisposition(input: {
  workdir: string;
  app: string;
  repository: string;
  disposition: ProductDocDisposition;
  now?: Date;
  beforeRemove?: () => Promise<void> | void;
  afterRemoveStage?: (index: number) => Promise<void> | void;
}): Promise<ProductDocDispositionPlan> {
  const prior = existsSync(join(resolve(input.workdir), PRODUCT_DOC_RECORD_PATH))
    ? await readProductDocScaffoldRecord(join(resolve(input.workdir), PRODUCT_DOC_RECORD_PATH))
    : undefined;
  await recoverProductDocRemoval(resolve(input.workdir), prior?.disposition?.value === "remove");
  let plan = await planProductDocDisposition(input);
  if (input.disposition === "remove" && input.beforeRemove !== undefined) {
    await input.beforeRemove();
    plan = await planProductDocDisposition(input);
  }
  if (plan.blockers.length > 0) throw new Error(`app product-docs: ${plan.blockers.join("; ")}`);
  if (plan.already_recorded) return plan;
  const inspected = await inspectProductDocScaffold(input);
  if (inspected === undefined) throw new Error("app product-docs: scaffold vanished before disposition execution");
  const record = inspected.record;
  let stage: ProductDocRemovalStage | undefined;
  try {
    if (input.disposition === "remove" && plan.remove_paths.length > 0) {
      stage = await stageProductDocRemoval(plan.workdir, record.documents, plan.remove_paths, input.afterRemoveStage);
    }
    const documents = await snapshotProductDocDocuments(plan.workdir, record.documents);
    if (input.disposition === "remove" && documents.some((document) => document.status !== "absent")) {
      throw new Error("app product-docs: remove did not leave every optional product document absent");
    }
    record.disposition = {
      value: input.disposition,
      recorded_at: (input.now ?? new Date()).toISOString(),
      documents: documents.map(({ path, current_sha256 }) => ({ path, current_sha256 })),
    };
    await writeLoopFileAtomic(plan.manifest_path, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    if (stage !== undefined) await rollbackRemovalOrThrow(stage, error);
    throw error;
  }
  if (stage !== undefined) await commitProductDocRemoval(stage);
  return planProductDocDisposition(input);
}

function sameDecisionDocuments(
  decision: Array<{ path: string; current_sha256: string | null }>,
  current: ProductDocSnapshot[],
): boolean {
  return (
    JSON.stringify(decision) === JSON.stringify(current.map(({ path, current_sha256 }) => ({ path, current_sha256 })))
  );
}

async function rollbackRemovalOrThrow(stage: ProductDocRemovalStage, original: unknown): Promise<void> {
  try {
    await rollbackProductDocRemoval(stage);
  } catch (recovery) {
    throw new Error(
      `${original instanceof Error ? original.message : String(original)}; removal recovery also failed: ` +
        `${recovery instanceof Error ? recovery.message : String(recovery)}`,
      { cause: recovery },
    );
  }
}
