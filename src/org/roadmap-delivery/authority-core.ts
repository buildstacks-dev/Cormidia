import { stableHash } from "../../loop/episode-plan.js";
import { RoadmapDeliveryError } from "./failure.js";

export const ROADMAP_DELIVERY_SCHEMA_VERSION = 1 as const;

export interface AuthorityRef {
  kind:
    | "backlog_snapshot"
    | "roadmap_plan"
    | "validation_catalog"
    | "validation_contract"
    | "delivery_unit_readiness"
    | "direct_execution_unit"
    | "direct_episode_binding"
    | "execution_batch"
    | "delivery_episode_binding"
    | "builder_evidence"
    | "reviewer_verdict";
  id: string;
  version: number;
  sha256: string;
}

export interface AcceptedAuthority<T> {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  ref: AuthorityRef;
  value: T;
}

export interface RoadmapDeliveryProjection {
  kind: AuthorityRef["kind"] | "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled";
  app: string;
  path: string;
  authorityRef?: AuthorityRef;
  settlementId?: string;
}

export type RoadmapDeliveryProjector = (projection: Readonly<RoadmapDeliveryProjection>) => void | Promise<void>;

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export function assertAuthorityRef(ref: unknown, kind: AuthorityRef["kind"]): asserts ref is AuthorityRef {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    throw new RoadmapDeliveryError("authority_corrupt", `expected ${kind} authority ref`);
  }
  assertExactObjectKeys(ref, ["kind", "id", "version", "sha256"], `${kind} authority ref`, "authority_corrupt");
  const row = ref as Record<string, unknown>;
  if (row["kind"] !== kind) {
    throw new RoadmapDeliveryError("authority_corrupt", `expected ${kind}, got ${String(row["kind"])}`);
  }
  assertId(row["id"], `${kind} ref id`);
  assertVersion(row["version"], `${kind} ref version`);
  assertHash(row["sha256"], `${kind} ref hash`);
}

export function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is invalid: ${String(value)}`);
  }
}

export function assertVersion(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} must be a positive integer`);
  }
}

export function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new RoadmapDeliveryError("authority_corrupt", `${label} is not sha256`);
  }
}

export function assertExactObjectKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
  code: RoadmapDeliveryError["code"] = "validation_contract_invalid",
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoadmapDeliveryError(code, `${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableHash(keys) !== stableHash(wanted)) {
    const expectedSet = new Set(wanted);
    const actualSet = new Set(keys);
    const missing = wanted.filter((key) => !actualSet.has(key));
    const unexpected = keys.filter((key) => !expectedSet.has(key));
    throw new RoadmapDeliveryError(
      code,
      `${label} keys differ; missing [${missing.join(",")}], unexpected [${unexpected.join(",")}]`,
    );
  }
}
