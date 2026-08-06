// Reusable durable single-claim primitive (#231).
//
// This leaf owns the small piece shared by scheduler due windows and the
// future per-item approval decision lock (#199): one content-bound settlement
// identity, O_EXCL-serialized mutation, a recoverable pre-commit owner, a
// durable commit boundary, and explicit bounded retry under the SAME identity.
// It deliberately knows nothing about schedules, tickets, or approvals.

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileLock } from "./file-lock.js";
import { currentProcessStartIdentity, processIdentityStatus } from "./process-identity.js";

type DurableClaimStatus = "claimed" | "committed" | "settled";
export type DurableClaimOwnerStatus = "live" | "dead" | "unknown";
export type DurableClaimDisposition =
  | "claimed"
  | "recovered_claim"
  | "already_claimed"
  | "already_settled"
  | "explicit_retry"
  | "retry_exhausted";

export interface DurableClaimOwner {
  pid: number;
  process_start_identity: string;
  nonce: string;
}

export interface DurableClaimToken {
  settlementId: string;
  attempt: number;
  nonce: string;
}

interface DurableClaimAttemptHistory {
  attempt: number;
  status: DurableClaimStatus;
  claimed_at: string;
  committed_at: string | null;
  settled_at: string | null;
  run_id: string | null;
  outcome: string | null;
}

export interface DurableClaimRecord<TPayload = unknown> {
  schema_version: 1;
  settlement_id: string;
  identity: string;
  payload: TPayload;
  payload_sha256: string;
  status: DurableClaimStatus;
  attempt: number;
  max_attempts: number;
  owner: DurableClaimOwner | null;
  claimed_at: string;
  committed_at: string | null;
  settled_at: string | null;
  updated_at: string;
  run_id: string | null;
  outcome: string | null;
  prior_attempts: DurableClaimAttemptHistory[];
  recovery_count: number;
}

export interface DurableClaimResult<TPayload = unknown> {
  disposition: DurableClaimDisposition;
  record: DurableClaimRecord<TPayload>;
  token?: DurableClaimToken;
}

interface DurableClaimStoreOptions {
  root: string;
  /** Relative state namespace. It is validated as path segments so a caller
   * cannot turn claim identity into filesystem authority. */
  namespace: string;
  ownerStatus?: (owner: DurableClaimOwner) => DurableClaimOwnerStatus;
}

const CLAIM_LOCK = {
  staleMs: 30_000,
  maxWaitMs: 31_000,
  retryMinMs: 2,
  retryMaxMs: 8,
} as const;

export class DurableClaimStore<TPayload = unknown> {
  readonly root: string;
  readonly namespace: string;
  private readonly inspectOwner: (owner: DurableClaimOwner) => DurableClaimOwnerStatus;

  constructor(options: DurableClaimStoreOptions) {
    this.root = resolve(options.root);
    this.namespace = safeNamespace(options.namespace);
    this.inspectOwner = options.ownerStatus ?? defaultOwnerStatus;
  }

  async claim(input: {
    identity: string;
    payload: TPayload;
    maxAttempts: number;
    now: Date;
    explicitRetry?: boolean;
  }): Promise<DurableClaimResult<TPayload>> {
    assertIdentity(input.identity);
    assertAttempts(input.maxAttempts);
    const settlementId = settlementIdFor(input.identity);
    return withFileLock(this.lockPath(settlementId), CLAIM_LOCK, async () => {
      const existing = await this.read(settlementId);
      const payloadHash = sha256(canonicalJson(input.payload));
      if (existing === undefined) {
        if (input.explicitRetry === true) {
          throw new Error(`durable claim ${settlementId}: cannot retry a settlement that does not exist`);
        }
        const owner = currentOwner();
        const record: DurableClaimRecord<TPayload> = {
          schema_version: 1,
          settlement_id: settlementId,
          identity: input.identity,
          payload: input.payload,
          payload_sha256: payloadHash,
          status: "claimed",
          attempt: 1,
          max_attempts: input.maxAttempts,
          owner,
          claimed_at: input.now.toISOString(),
          committed_at: null,
          settled_at: null,
          updated_at: input.now.toISOString(),
          run_id: null,
          outcome: null,
          prior_attempts: [],
          recovery_count: 0,
        };
        await this.write(record);
        return { disposition: "claimed", record, token: tokenFor(record, owner) };
      }
      assertSameClaim(existing, input.identity, payloadHash, input.maxAttempts);
      if (existing.status === "claimed") {
        if (existing.owner !== null && this.inspectOwner(existing.owner) === "dead") {
          const owner = currentOwner();
          const record: DurableClaimRecord<TPayload> = {
            ...existing,
            owner,
            updated_at: input.now.toISOString(),
            recovery_count: existing.recovery_count + 1,
          };
          await this.write(record);
          return { disposition: "recovered_claim", record, token: tokenFor(record, owner) };
        }
        return { disposition: "already_claimed", record: existing };
      }
      if (existing.status === "committed") {
        return { disposition: "already_claimed", record: existing };
      }
      if (input.explicitRetry !== true) {
        return { disposition: "already_settled", record: existing };
      }
      if (existing.attempt >= existing.max_attempts) {
        return { disposition: "retry_exhausted", record: existing };
      }
      const owner = currentOwner();
      const record: DurableClaimRecord<TPayload> = {
        ...existing,
        status: "claimed",
        attempt: existing.attempt + 1,
        owner,
        claimed_at: input.now.toISOString(),
        committed_at: null,
        settled_at: null,
        updated_at: input.now.toISOString(),
        run_id: null,
        outcome: null,
        prior_attempts: [...existing.prior_attempts, historyOf(existing)],
      };
      await this.write(record);
      return { disposition: "explicit_retry", record, token: tokenFor(record, owner) };
    });
  }

  async commit(input: {
    settlementId: string;
    attempt: number;
    token: DurableClaimToken;
    runId: string;
    now: Date;
  }): Promise<DurableClaimRecord<TPayload>> {
    return withFileLock(this.lockPath(input.settlementId), CLAIM_LOCK, async () => {
      const record = await this.mustRead(input.settlementId);
      assertAttempt(record, input.attempt);
      if (record.status === "committed" && record.run_id === input.runId) return record;
      if (record.status !== "claimed" || record.owner?.nonce !== input.token.nonce) {
        throw new Error(`durable claim ${record.settlement_id}: commit token does not own attempt ${record.attempt}`);
      }
      if (input.token.settlementId !== record.settlement_id || input.token.attempt !== record.attempt) {
        throw new Error(`durable claim ${record.settlement_id}: commit token identity mismatch`);
      }
      const next: DurableClaimRecord<TPayload> = {
        ...record,
        status: "committed",
        committed_at: input.now.toISOString(),
        updated_at: input.now.toISOString(),
        run_id: input.runId,
      };
      await this.write(next);
      return next;
    });
  }

  async settle(input: {
    settlementId: string;
    attempt: number;
    runId: string;
    outcome: string;
    now: Date;
  }): Promise<DurableClaimRecord<TPayload>> {
    return withFileLock(this.lockPath(input.settlementId), CLAIM_LOCK, async () => {
      const record = await this.mustRead(input.settlementId);
      assertAttempt(record, input.attempt);
      if (record.status === "settled") {
        if (record.run_id === input.runId && record.outcome === input.outcome) return record;
        throw new Error(`durable claim ${record.settlement_id}: conflicting settlement`);
      }
      if (record.status !== "committed") {
        throw new Error(`durable claim ${record.settlement_id}: cannot settle before commit`);
      }
      if (record.run_id !== null && record.run_id !== input.runId) {
        throw new Error(`durable claim ${record.settlement_id}: run identity mismatch`);
      }
      const next: DurableClaimRecord<TPayload> = {
        ...record,
        status: "settled",
        owner: null,
        settled_at: input.now.toISOString(),
        updated_at: input.now.toISOString(),
        run_id: input.runId,
        outcome: input.outcome,
      };
      await this.write(next);
      return next;
    });
  }

  async read(settlementId: string): Promise<DurableClaimRecord<TPayload> | undefined> {
    const path = this.recordPath(settlementId);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isDurableClaimRecord(value) || value.settlement_id !== settlementId) {
      throw new Error(`durable claim schema mismatch: ${path}`);
    }
    return value as DurableClaimRecord<TPayload>;
  }

  async list(): Promise<DurableClaimRecord<TPayload>[]> {
    const dir = this.recordsDir();
    if (!existsSync(dir)) return [];
    const records: DurableClaimRecord<TPayload>[] = [];
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
      const settlementId = file.slice(0, -5);
      const record = await this.read(settlementId);
      if (record !== undefined) records.push(record);
    }
    return records.sort((a, b) => a.settlement_id.localeCompare(b.settlement_id));
  }

  private async mustRead(settlementId: string): Promise<DurableClaimRecord<TPayload>> {
    const record = await this.read(settlementId);
    if (record === undefined) throw new Error(`durable claim missing: ${settlementId}`);
    return record;
  }

  private recordsDir(): string {
    return join(this.root, this.namespace, "records");
  }

  private locksDir(): string {
    return join(this.root, this.namespace, "locks");
  }

  private recordPath(settlementId: string): string {
    assertSettlementId(settlementId);
    return join(this.recordsDir(), `${settlementId}.json`);
  }

  private lockPath(settlementId: string): string {
    assertSettlementId(settlementId);
    return join(this.locksDir(), `${settlementId}.lock`);
  }

  private async write(record: DurableClaimRecord<TPayload>): Promise<void> {
    const path = this.recordPath(record.settlement_id);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${canonicalJson(record)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
}

export function durableClaimSettlementId(identity: string): string {
  assertIdentity(identity);
  return settlementIdFor(identity);
}

function currentOwner(): DurableClaimOwner {
  return {
    pid: process.pid,
    process_start_identity: currentProcessStartIdentity(),
    nonce: randomUUID(),
  };
}

function defaultOwnerStatus(owner: DurableClaimOwner): DurableClaimOwnerStatus {
  const status = processIdentityStatus(owner.pid, owner.process_start_identity);
  if (status === "match") return "live";
  if (status === "mismatch") return "dead";
  return "unknown";
}

function tokenFor<T>(record: DurableClaimRecord<T>, owner: DurableClaimOwner): DurableClaimToken {
  return { settlementId: record.settlement_id, attempt: record.attempt, nonce: owner.nonce };
}

function historyOf<T>(record: DurableClaimRecord<T>): DurableClaimAttemptHistory {
  return {
    attempt: record.attempt,
    status: record.status,
    claimed_at: record.claimed_at,
    committed_at: record.committed_at,
    settled_at: record.settled_at,
    run_id: record.run_id,
    outcome: record.outcome,
  };
}

function assertSameClaim<T>(
  record: DurableClaimRecord<T>,
  identity: string,
  payloadHash: string,
  maxAttempts: number,
): void {
  if (record.identity !== identity || record.payload_sha256 !== payloadHash) {
    throw new Error(`durable claim ${record.settlement_id}: content binding mismatch`);
  }
  if (record.max_attempts !== maxAttempts) {
    throw new Error(`durable claim ${record.settlement_id}: max attempts are already bound to ${record.max_attempts}`);
  }
}

function assertAttempt<T>(record: DurableClaimRecord<T>, attempt: number): void {
  if (record.attempt !== attempt) {
    throw new Error(`durable claim ${record.settlement_id}: expected attempt ${record.attempt}, got ${attempt}`);
  }
}

function settlementIdFor(identity: string): string {
  return `claim_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function safeNamespace(value: string): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`durable claim namespace is unsafe: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertIdentity(value: string): void {
  if (value.length === 0 || value.length > 4096)
    throw new TypeError("durable claim identity must be 1..4096 characters");
}

function assertAttempts(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new TypeError("durable claim maxAttempts must be an integer from 1 to 100");
  }
}

function assertSettlementId(value: string): void {
  if (!/^claim_[a-f0-9]{32}$/.test(value)) throw new TypeError(`invalid durable settlement id: ${value}`);
}

function isDurableClaimRecord(value: unknown): value is DurableClaimRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row["schema_version"] === 1 &&
    typeof row["settlement_id"] === "string" &&
    typeof row["identity"] === "string" &&
    typeof row["payload_sha256"] === "string" &&
    (row["status"] === "claimed" || row["status"] === "committed" || row["status"] === "settled") &&
    Number.isInteger(row["attempt"]) &&
    Number.isInteger(row["max_attempts"]) &&
    typeof row["claimed_at"] === "string" &&
    typeof row["updated_at"] === "string" &&
    Array.isArray(row["prior_attempts"]) &&
    Number.isInteger(row["recovery_count"])
  );
}
