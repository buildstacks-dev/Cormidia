// Durable command-level invocation audit. Provider settlements remain in
// telemetry/: this sibling ledger records CLI/orchestrator calls and their
// terminal result without conflating a command with the provider turns it may
// launch.

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { withFileLock } from "./file-lock.js";

export interface InvocationRecord {
  /** Schema 2 is the centrally-audited CLI shape. Omitted on historical rows. */
  schema_version?: 2;
  at: string;
  finishedAt?: string;
  /** `loop`/`dispatch` are retained only for historical rows. */
  kind: "cli" | "loop" | "dispatch" | "release";
  invocationId?: string;
  command?: string;
  subcommand?: string;
  argv?: string[];
  org?: string;
  app?: string;
  dryRun?: boolean;
  itemsClaimed?: number;
  itemsPreviewed?: number;
  outcome: string;
  exitCode?: number;
  wallClockMs: number;
  parentTaskId?: string;
  /** Command-specific non-secret provenance (for example an org authority
   * profile or new-app template). */
  provenance?: Record<string, string>;
}

export interface RunningCliInvocation {
  schema_version: 2;
  at: string;
  kind: "cli";
  invocationId: string;
  command: string;
  subcommand?: string;
  argv: string[];
  org?: string;
  app?: string;
  dryRun: boolean;
  parentTaskId?: string;
}

interface RunningInvocationJournal {
  schema_version: 1;
  state: "running";
  pid: number;
  invocation: RunningCliInvocation;
}

interface TerminalInvocationJournal {
  schema_version: 1;
  state: "terminal";
  pid: number;
  invocation: InvocationRecord & { invocationId: string };
}

type InvocationJournal = RunningInvocationJournal | TerminalInvocationJournal;

const LOCK_STALE_MS = 120_000;
const LOCK_WAIT_MS = 125_000;

/** Compatibility writer for genuinely distinct internal orchestration rows
 * (currently approved release executions). CLI commands use the journaled,
 * exactly-once functions below. */
export async function recordInvocation(stateHome: string, record: InvocationRecord): Promise<void> {
  const day = record.at.slice(0, 10);
  const path = join(stateHome, "invocations", `${day}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

/** Persist command intent before command execution. If a process dies, the
 * running journal remains explicit evidence instead of disappearing. A later
 * terminalization of the same identity is idempotent. */
export async function beginCliInvocation(
  stateHome: string,
  invocation: RunningCliInvocation,
): Promise<void> {
  assertInvocationId(invocation.invocationId);
  await reconcileCliInvocations(stateHome);
  await mkdir(invocationJournalDir(stateHome), { recursive: true });
  const path = invocationJournalPath(stateHome, invocation.invocationId);
  let existing: InvocationJournal | undefined;
  try {
    existing = parseJournal(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing !== undefined) {
    if (existing.invocation.invocationId !== invocation.invocationId) {
      throw new Error(`invocation audit identity collision: ${invocation.invocationId}`);
    }
    return;
  }
  await writeAtomic(path, `${JSON.stringify({
    schema_version: 1,
    state: "running",
    pid: process.pid,
    invocation,
  } satisfies RunningInvocationJournal, null, 2)}\n`);
}

/** Write terminal intent before touching the append-only ledger, then append
 * under one lock and remove the intent. A crash or write failure after a
 * successful external mutation therefore leaves a reconcilable terminal
 * journal; retrying the same identity can never append twice. */
export async function finishCliInvocation(
  stateHome: string,
  record: InvocationRecord & { invocationId: string },
): Promise<void> {
  assertInvocationId(record.invocationId);
  await mkdir(invocationJournalDir(stateHome), { recursive: true });
  const path = invocationJournalPath(stateHome, record.invocationId);
  await writeAtomic(path, `${JSON.stringify({
    schema_version: 1,
    state: "terminal",
    pid: process.pid,
    invocation: record,
  } satisfies TerminalInvocationJournal, null, 2)}\n`);
  await appendInvocationOnce(stateHome, record);
  await rm(path, { force: true });
}

/** Reconcile only terminal journals. A running journal is not guessed into a
 * success/failure row: it is durable crash evidence that an operator can
 * inspect, while a later process may terminalize it with the original stable
 * identity once the outcome is known. */
export async function reconcileCliInvocations(
  stateHome: string,
  now: Date = new Date(),
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(invocationJournalDir(stateHome));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let reconciled = 0;
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const path = join(invocationJournalDir(stateHome), name);
    const journal = parseJournal(await readFile(path, "utf8"));
    const terminal = journal.state === "terminal"
      ? journal.invocation
      : abandonedInvocation(journal, now);
    if (terminal === undefined) continue;
    await appendInvocationOnce(stateHome, terminal);
    await rm(path, { force: true });
    reconciled += 1;
  }
  return reconciled;
}

export async function appendInvocationOnce(
  stateHome: string,
  record: InvocationRecord & { invocationId: string },
): Promise<boolean> {
  assertInvocationId(record.invocationId);
  const lockPath = join(stateHome, "state", "invocation-ledger.lock");
  return withFileLock(
    lockPath,
    { staleMs: LOCK_STALE_MS, maxWaitMs: LOCK_WAIT_MS },
    async () => {
      const day = record.at.slice(0, 10);
      const ledgerPath = join(stateHome, "invocations", `${day}.jsonl`);
      try {
        const text = await readFile(ledgerPath, "utf8");
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          try {
            const row = JSON.parse(line) as Partial<InvocationRecord>;
            if (row.invocationId === record.invocationId) return false;
          } catch {
            // A torn unrelated line is not authority to duplicate this id.
            // Keep scanning the remaining complete rows.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await recordInvocation(stateHome, record);
      return true;
    },
  );
}

export function invocationJournalPath(stateHome: string, invocationId: string): string {
  assertInvocationId(invocationId);
  return join(invocationJournalDir(stateHome), `${invocationId}.json`);
}

function invocationJournalDir(stateHome: string): string {
  return join(stateHome, "state", "invocation-journal");
}

function assertInvocationId(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw new Error("invocation audit id must be 1-160 safe filename characters");
  }
}

function parseJournal(text: string): InvocationJournal {
  const value = JSON.parse(text) as Partial<InvocationJournal>;
  if (
    value.schema_version !== 1 ||
    (value.state !== "running" && value.state !== "terminal") ||
    typeof value.pid !== "number" ||
    value.invocation === undefined ||
    typeof value.invocation.invocationId !== "string"
  ) {
    throw new Error("invocation audit journal has an invalid schema");
  }
  return value as InvocationJournal;
}

function abandonedInvocation(
  journal: RunningInvocationJournal,
  now: Date,
): (InvocationRecord & { invocationId: string }) | undefined {
  if (processIsAlive(journal.pid)) return undefined;
  const started = new Date(journal.invocation.at).getTime();
  return {
    ...journal.invocation,
    finishedAt: now.toISOString(),
    outcome: "interrupted: process exited without a terminal command result",
    exitCode: 1,
    wallClockMs: Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0,
  };
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
