import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stableHash } from "../../loop/episode-plan.js";
import { assertAuthorityRef, type AuthorityRef } from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";

export async function readCurrentAuthorityPointer(
  path: string,
  kind: AuthorityRef["kind"],
  app: string,
  unitId?: string,
): Promise<AuthorityRef | undefined> {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `current ${kind} pointer is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer is invalid`);
  }
  const row = parsed as Record<string, unknown>;
  const expectedKeys =
    unitId === undefined
      ? ["schemaVersion", "app", "ref", "updatedAt"]
      : ["schemaVersion", "app", "unitId", "ref", "updatedAt"];
  if (
    stableHash(Object.keys(row).sort()) !== stableHash(expectedKeys.sort()) ||
    row["schemaVersion"] !== 1 ||
    row["app"] !== app ||
    typeof row["updatedAt"] !== "string" ||
    Number.isNaN(Date.parse(row["updatedAt"])) ||
    (unitId !== undefined && row["unitId"] !== unitId) ||
    row["ref"] === null ||
    typeof row["ref"] !== "object" ||
    Array.isArray(row["ref"])
  ) {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer is invalid`);
  }
  const ref = row["ref"] as AuthorityRef;
  try {
    assertAuthorityRef(ref, kind);
  } catch {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer ref is invalid`);
  }
  return ref;
}
