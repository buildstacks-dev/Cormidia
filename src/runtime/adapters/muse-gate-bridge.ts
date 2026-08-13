// Parent-process half of MuseRuntime's managed-hook gate bridge.
//
// Muse Code exposes no in-process permission callback: `muse exec` runs
// headless and auto-approves. Its only documented pre-execution seam is the
// managed hook runtime, which this bridge installs per turn; hook children
// carry their payload back over a per-turn Unix socket into Cormidia's
// in-process GateFn, exactly like the Codex bridge, and the child fails closed.
//
// The property this file exists to guarantee is THE HANDSHAKE: a hook that
// never fires is indistinguishable from a harness with no gate, so the bridge
// records whether any hook reached it this turn. MuseRuntime refuses the turn
// when the seam is unproven — an unproven gate is never an allowed turn.
//
// Residual risk recorded in docs/harness/capability-matrix.md: Cormidia owns
// the child environment, but an agent with shell access could spawn a NESTED
// `muse` without the env var. The router denies that invocation; the deny is
// enforcement, not decoration.

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateEscalation, TurnHooks } from "../types.js";
import {
  handleMuseHookPayload,
  museDenyPayload,
  newMuseHookRouterState,
  type MuseGateConsultation,
} from "./muse-hook-router.js";
import { classifierThrowDenial } from "./gate-bridge-escalation.js";
import { writeMuseIsolatedSettings, writeMuseManagedHooks } from "./muse-managed-hooks.js";

const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

export interface MuseGateBridge {
  socketPath: string;
  /** Directory installed as the managed hook root for this turn. */
  hookDir: string;
  /** Isolated XDG_CONFIG_HOME so operator settings never reach an org turn. */
  configHome: string;
  env: NodeJS.ProcessEnv;
  /** True once ANY hook event reached the bridge in this process. */
  handshakeObserved(): boolean;
  /** Gate consultations observed, in order — certification evidence. */
  consultations(): readonly MuseGateConsultation[];
  /** Distinct swarm children observed through SubagentStart. */
  subagentTurns(): number;
  close(): Promise<void>;
}

export async function startMuseGateBridge(
  workdir: string,
  hooks: TurnHooks,
  escalations: GateEscalation[],
): Promise<MuseGateBridge> {
  // macOS caps Unix-domain socket paths near 100 bytes; keep the root short and
  // remove it at turn end (the same constraint the Codex bridge documents).
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = await mkdtemp(join(socketRoot, "cormidia-mg-"));
  const socketPath = join(directory, "gate.sock");
  const hookDir = join(directory, "hooks");
  const configHome = join(directory, "config");
  const state = newMuseHookRouterState();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let body = "";
    let answered = false;
    const answer = (payload: unknown): void => {
      if (answered) return;
      answered = true;
      socket.end(JSON.stringify(payload));
    };
    socket.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BRIDGE_BYTES) {
        answer(museDenyPayload("PreToolUse", "Cormidia gate input exceeded 8 MiB"));
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", () => {
      if (answered) return;
      try {
        answer(handleMuseHookPayload(JSON.parse(body.trim()), workdir, hooks, escalations, state));
      } catch (error) {
        // F-PT-037 (owner ruling 2026-08-12) extends F-PT-036's INV-015 seed (c)
        // here: deny AND escalate. The denial alone was silent, so a persistently
        // broken classifier would read as universal refusal with no signal — an
        // availability failure compounding into an observability hole.
        answer(museDenyPayload("PreToolUse", classifierThrowDenial(escalations, undefined, "Muse", error).reason));
      }
    });
  });

  try {
    await writeMuseManagedHooks(hookDir);
    await writeMuseIsolatedSettings(configHome, hookDir);
    await listen(server, socketPath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    socketPath,
    hookDir,
    configHome,
    env: {
      // The only managed-hook source found in 0.1.0 field probing, plus the
      // settings lane written above as belt-and-braces.
      TBH_MANAGED_HOOKS_PATH: hookDir,
      CORMIDIA_MUSE_GATE_SOCKET: socketPath,
      XDG_CONFIG_HOME: configHome,
      // Never let the vendor launcher self-update mid-turn: Cormidia does not
      // install providers (#224) and certification binds to a recorded version.
      MUSE_NO_AUTO_UPDATE: "1",
    },
    handshakeObserved: () => state.handshake,
    consultations: () => state.consultations,
    subagentTurns: () => state.subagents.size,
    close: async () => {
      closing ??= (async () => {
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
        await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => reject(error);
    server.once("error", fail);
    server.listen(socketPath, () => {
      server.off("error", fail);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
