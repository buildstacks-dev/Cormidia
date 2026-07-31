// CF-C-B01 — the github-double side of the conformance pair (HB-003).
//
// `ops` is a bare `new GhCliOps(repo)` — no injected executor, no options: the
// exact production construction. It only works because the caller activated
// the double's PATH shim (handle.activatePath()), which is the point: the
// conformance run proves product code UNMODIFIED against the fake at the real
// `gh` process seam. The live wave (CF-B01-L3 / HB-052) replaces only this
// file's role with a sandbox-repo surface; conformance/suite.ts is shared.

import { GhCliOps } from "../../../../src/loop/github.js";
import type { GithubDoubleHandle } from "../install.js";
import type { GithubConformanceSurface } from "./suite.js";

let branchSeq = 0;

export function makeGithubDoubleSurface(handle: GithubDoubleHandle): GithubConformanceSurface {
  return {
    label: `github-double:${handle.repo}`,
    ops: new GhCliOps(handle.repo),
    async resolveDefaultBranch(): Promise<string> {
      const result = await handle.exec(["repo", "view", handle.repo, "--json", "defaultBranchRef"]);
      if (result.exitCode !== 0) {
        throw new Error(`repo view failed: ${result.stderr}`);
      }
      const parsed = JSON.parse(result.stdout) as { defaultBranchRef?: { name?: string } };
      const name = parsed.defaultBranchRef?.name;
      if (name === undefined) throw new Error("repo view returned no defaultBranchRef");
      return name;
    },
    async prepareBranch(prefix: string): Promise<{ branch: string; headOid: string }> {
      branchSeq += 1;
      const branch = `op/${prefix}-${branchSeq}`;
      const headOid = handle.seedBranch(branch);
      return { branch, headOid };
    },
    async advanceBranch(branch: string): Promise<string> {
      return handle.advanceBranch(branch);
    },
  };
}
