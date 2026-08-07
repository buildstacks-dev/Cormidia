import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { writeLoopFileOnce } from "../../loop/durable.js";
import { stableHash } from "../../loop/episode-plan.js";
import { planningAuthorityPath } from "../planning-artifact-path.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertId,
  assertVersion,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";

export async function persistAuthority<T>(
  root: string,
  app: string,
  kind: AuthorityRef["kind"],
  id: string,
  version: number,
  value: T,
): Promise<AcceptedAuthority<T>> {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  const ref: AuthorityRef = { kind, id, version, sha256: stableHash(value) };
  const accepted: AcceptedAuthority<T> = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    ref,
    value: structuredClone(value),
  };
  const path = authorityPath(root, app, kind, id, version);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(accepted, null, 2)}\n`);
  if (!won) {
    const existing = await readAuthorityFile<T>(path);
    if (!sameAuthorityRef(existing.ref, ref) || stableHash(existing.value) !== ref.sha256) {
      throw new RoadmapDeliveryError("authority_conflict", `${kind} ${id}@${version} already differs`);
    }
  }
  const persisted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(persisted.ref, ref) || stableHash(persisted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${kind} ${id}@${version} failed readback`);
  }
  return persisted;
}

export async function requireAuthority<T>(
  root: string,
  app: string,
  ref: AuthorityRef,
  kind: AuthorityRef["kind"],
  missingCode: RoadmapDeliveryError["code"],
): Promise<AcceptedAuthority<T>> {
  assertAuthorityRef(ref, kind);
  const path = authorityPath(root, app, kind, ref.id, ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError(missingCode, `${renderAuthorityRef(ref)} is missing`);
  }
  const accepted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(accepted.ref, ref) || stableHash(accepted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${renderAuthorityRef(ref)} failed content binding`);
  }
  return accepted;
}

export async function readAuthorityFile<T>(path: string): Promise<AcceptedAuthority<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isAcceptedAuthority(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", `${path} is not an accepted authority envelope`);
  }
  return parsed as AcceptedAuthority<T>;
}

export function authorityPath(
  root: string,
  app: string,
  kind: AuthorityRef["kind"],
  id: string,
  version: number,
): string {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  return planningAuthorityPath(root, app, kind, id, version);
}

export async function projectAccepted<T>(
  root: string,
  app: string,
  accepted: AcceptedAuthority<T>,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = authorityPath(root, app, accepted.ref.kind, accepted.ref.id, accepted.ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `projection preceded persistence: ${path}`);
  }
  await project({ kind: accepted.ref.kind, app, path, authorityRef: accepted.ref });
}

export function renderAuthorityRef(ref: AuthorityRef): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.sha256}`;
}

export function sameAuthorityRef(left: AuthorityRef, right: AuthorityRef): boolean {
  return (
    left.kind === right.kind && left.id === right.id && left.version === right.version && left.sha256 === right.sha256
  );
}

export function sameNullableAuthorityRef(left: AuthorityRef | null, right: AuthorityRef | null): boolean {
  return left === null ? right === null : right !== null && sameAuthorityRef(left, right);
}

function isAcceptedAuthority(value: unknown): value is AcceptedAuthority<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION || !("value" in row)) return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return (
    typeof candidate["kind"] === "string" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string"
  );
}
