// fixtures/kill-point.ts — subprocess kill-point harness (boundary-map B-07
// process lifecycle; B-15 torn durable state).
//
// Runs a REAL node subprocess (via the repo's tsx) executing a scripted
// scenario, and kills it -9 at a named point. Determinism comes from a stdout/
// stdin handshake, not timing: the scenario calls `await kp("name")`, which
// prints `KP:name` and then BLOCKS until the harness acks. At the configured
// kill point the harness sends SIGKILL instead of the ack, so the child dies
// exactly between the work before the marker and the work after it — "the
// child may have done expensive work and we cannot prove how far it got" made
// reproducible. The child writes surviving state under `stateDir`
// (exported to the scenario as env `KP_SCRATCH`); the caller inspects it
// after exit.
//
// The `kp` helper is injected as a prelude, so scenario sources stay small.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

/** Injected above every scenario. Valid TS and JS; tsx transpiles, so the
 *  untyped parameters are fine. `kp` pauses stdin between marks so an idle
 *  handshake never keeps the child's event loop alive after the scenario
 *  finishes. */
const KP_PRELUDE = `// --- kill-point prelude (injected by fixtures/kill-point.ts) ---
// The pid line lets the harness SIGKILL the SCENARIO process itself: tsx runs
// the scenario in a child of the spawned CLI process, so the spawned pid alone
// would kill the wrapper and leave the scenario orphaned. The ref/pause/unref
// dance holds the event loop ONLY while an ack is pending, so a finished
// scenario exits instead of idling on an open stdin (probed, not assumed).
import { createInterface as __kpCreateInterface } from "node:readline";
process.stdout.write("KPPID:" + process.pid + "\\n");
const kp = async (name) => {
  process.stdout.write("KP:" + name + "\\n");
  const ack = await new Promise((resolveAck) => {
    const rl = __kpCreateInterface({ input: process.stdin });
    process.stdin.ref();
    rl.once("line", (line) => {
      rl.close();
      process.stdin.pause();
      process.stdin.unref();
      resolveAck(line);
    });
  });
  if (ack !== "ok") process.exit(3);
};
void kp;
// --- end prelude ---
`;

export interface KillPointScenario {
  /** ESM module source (TS or JS) run via tsx. Call `await kp("marker")` at
   *  each named point; `process.env.KP_SCRATCH` is the surviving-state dir. */
  source: string;
  /** Marker to kill at (SIGKILL instead of the ack). Omit to run through. */
  killAt?: string;
  /** Extra child environment. */
  env?: Record<string, string>;
  /** Child working directory (default: the scenario's scratch dir). */
  cwd?: string;
  /** Whole-run ceiling; on expiry the child is SIGKILLed and the result says
   *  `timedOut: true` — a hung child never reports as anything else. */
  timeoutMs?: number;
}

export interface KillPointResult {
  /** Pid of the SCENARIO process (reported by the prelude handshake) — the
   *  one the kill actually targets. Falls back to the spawned CLI pid if the
   *  handshake never arrived. */
  pid: number;
  /** Pid of the spawned tsx CLI process wrapping the scenario. */
  wrapperPid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Markers the child reached, in order (including the killed-at one). */
  markers: string[];
  /** Set when the kill point was reached and the SIGKILL was sent. */
  killedAt?: string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Directory the scenario saw as KP_SCRATCH — surviving state lives here. */
  stateDir: string;
  cleanup(): Promise<void>;
}

async function waitForPidExit(pid: number, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true; // ESRCH — gone.
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
  }
  return false;
}

export async function runKillPointScenario(scenario: KillPointScenario): Promise<KillPointResult> {
  if (!existsSync(tsxBin)) {
    throw new Error(`fixtures/kill-point: tsx binary not found at ${tsxBin} — run pnpm install`);
  }
  const scratch = await mkdtemp(join(tmpdir(), "cormidia-fixture-kill-"));
  const stateDir = join(scratch, "state");
  await mkdir(stateDir);
  const scenarioPath = join(scratch, "scenario.mts");
  await writeFile(scenarioPath, `${KP_PRELUDE}\n${scenario.source}\n`, "utf8");

  const child = spawn(tsxBin, [scenarioPath], {
    cwd: scenario.cwd ?? scratch,
    env: { ...process.env, ...scenario.env, KP_SCRATCH: stateDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const wrapperPid = child.pid;
  if (wrapperPid === undefined) throw new Error("fixtures/kill-point: child failed to spawn");

  const markers: string[] = [];
  const stdoutLines: string[] = [];
  let stderr = "";
  let killedAt: string | undefined;
  let timedOut = false;
  let scenarioPid: number | undefined;

  // SIGKILL both processes: the wrapper first (so its exit reports the
  // signal), then the scenario process itself — SIGKILL is not forwarded by
  // the wrapper, and an unkilled scenario would survive as a blocked orphan.
  const killBoth = (): void => {
    child.kill("SIGKILL");
    if (scenarioPid !== undefined && scenarioPid !== wrapperPid) {
      try {
        process.kill(scenarioPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  };

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    stdoutLines.push(line);
    if (line.startsWith("KPPID:")) {
      scenarioPid = Number(line.slice("KPPID:".length));
      return;
    }
    if (!line.startsWith("KP:")) return;
    const marker = line.slice("KP:".length);
    markers.push(marker);
    if (scenario.killAt !== undefined && marker === scenario.killAt) {
      killedAt = marker;
      killBoth();
      return;
    }
    try {
      child.stdin.write("ok\n");
    } catch {
      // Child already gone — the exit handler reports what happened.
    }
  });

  const timer = setTimeout(() => {
    timedOut = true;
    killBoth();
  }, scenario.timeoutMs ?? 15_000);
  timer.unref();

  const { exitCode, signal } = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, sig) => resolveExit({ exitCode: code, signal: sig }));
  });
  clearTimeout(timer);
  lines.close();
  // Release a scenario that might still be blocked on the ack pipe (a
  // SIGKILLed wrapper cannot forward anything): closing our write end gives
  // it EOF, and the prelude exits on any non-"ok" ack.
  child.stdin.end();
  // Postcondition: by the time the result returns, the scenario process is
  // gone — a killed orphan is reparented and reaped asynchronously, so give
  // the OS a moment rather than returning a possibly-zombie pid.
  if (scenarioPid !== undefined) await waitForPidExit(scenarioPid, 2_000);

  return {
    pid: scenarioPid ?? wrapperPid,
    wrapperPid,
    exitCode,
    signal,
    markers,
    ...(killedAt !== undefined ? { killedAt } : {}),
    timedOut,
    stdout: stdoutLines.join("\n"),
    stderr,
    stateDir,
    cleanup: async () => {
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
