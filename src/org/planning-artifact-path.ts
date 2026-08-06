import { join, resolve } from "node:path";
import { stableHash } from "../loop/episode-plan.js";

/** Stable per-app directory for durable planning authority. */
export function planningAppDir(root: string, app: string): string {
  return join(resolve(root), "planning", "apps", stableHash(app).slice(0, 32));
}

/** Canonical versioned path shape shared by durable planning authority kinds. */
export function planningAuthorityPath(root: string, app: string, kind: string, id: string, version: number): string {
  return join(planningAppDir(root, app), `${kind}s`, id, `v${version}.json`);
}
