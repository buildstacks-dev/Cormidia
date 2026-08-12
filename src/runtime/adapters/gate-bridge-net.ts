// Shared Unix-socket server plumbing for the per-turn gate bridges. These two
// helpers were byte-identical private copies in the Codex, Cursor, and
// OpenCode bridges; extracted 2026-08-12 (HB-150) so the bridges stay within
// the size ratchet while gaining the F-PT-036 escalation branch.

import type { Server } from "node:net";

export function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => reject(error);
    server.once("error", fail);
    server.listen(socketPath, () => {
      server.off("error", fail);
      resolve();
    });
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
