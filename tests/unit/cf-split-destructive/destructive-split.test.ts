// CF-SPLIT-DESTRUCTIVE (L1) — the §5.1 split of `destructive-or-irreversible`
// by TARGET (#296, F-PT-023 ratified 2026-08-06; case-catalog §10.1):
//
//   destructive-remote-data  HO  drop table / truncate / delete db|bucket|droplet
//   history-rewrite-owned    B   force-push whose every destination is op/<issue>-…
//   history-rewrite-foreign  HO  force-push anywhere else, incl. any default-branch
//                                name and every undeterminable destination
//   destructive-local        G   rm -rf absolute / ~ / $HOME / parent escape
//   gh-api-unrecognized      HO  mutating gh api no tighter rule recognizes; graphql
//
// The compensating control: today every force-push is one grantable bucket;
// after the split the only budgeted case is the namespace the orchestrator
// already owns in code (src/loop/loop.ts force-pushes exactly its own rebuilt
// `op/<issue>-…` ref), and EVERYTHING else — including any possible default
// branch, which is definitionally outside `op/` — is human-only. The
// classifier deliberately carries no default-branch state at all, so there is
// nothing to go stale between claims (the cf-reg-203 freshness concern): a
// ref either matches the owned-ticket namespace or it is foreign.

import { describe, expect, it } from "vitest";
import {
  classify,
  decideDisposition,
  dispositionTierForRule,
  NEVER_SCOPEABLE_RULES,
} from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

function bash(command: string): ToolAction {
  return { tool: "bash", input: { command } };
}

describe("CF-SPLIT-DESTRUCTIVE — remote data destruction is human-only", () => {
  it("drop/truncate/delete-infrastructure classify destructive-remote-data at human-only", () => {
    for (const command of [
      "psql -c 'drop table users'",
      "mysql -e 'truncate audit_log'",
      "doctl compute droplet delete droplet 12345",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "destructive-remote-data" });
    }
    expect(dispositionTierForRule("destructive-remote-data")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).toContain("destructive-remote-data");
  });

  it("the org CLI's own destructive verbs ride the same class (they remove managed state)", () => {
    expect(classify(bash("cormidia app reset my-app --execute --confirm my-app"))).toEqual({
      cls: "critical",
      rule: "destructive-remote-data",
    });
  });
});

describe("CF-SPLIT-DESTRUCTIVE — force-push splits by destination namespace", () => {
  it("a force-push whose every destination is inside op/<issue>-… is history-rewrite-owned at budgeted", () => {
    for (const command of [
      "git push --force origin op/7-fix",
      "git push -f origin op/12-retry-pass",
      "git push --force-with-lease origin op/3-a",
      "git -C /work/tree push --force origin op/9-b",
      "git push --force origin HEAD:op/21-rebuilt",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "history-rewrite-owned" });
    }
    expect(dispositionTierForRule("history-rewrite-owned")).toBe("budgeted");
  });

  it("a force-push to ANY other ref is history-rewrite-foreign at human-only — default-branch names included, with no branch state to go stale", () => {
    for (const command of [
      "git push --force origin main",
      "git push -f origin master",
      "git push --force origin HEAD:main",
      "git push -f origin op/7-fix main", // one owned + one foreign ⇒ foreign
      "git push --force origin refs/heads/release",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "history-rewrite-foreign" });
    }
    expect(dispositionTierForRule("history-rewrite-foreign")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).toContain("history-rewrite-foreign");
  });

  it("an undeterminable destination fails closed to foreign — one seeded case per evasion form", () => {
    for (const command of [
      "git push --force", // bare: pushes the current branch, destination unknown
      "git push -f origin", // remote only, no refspec
      'git push --force origin "$BRANCH"', // variable
      "git push -f origin $(cat ref.txt)", // substitution
      "git push -f origin `cat ref.txt`", // backtick
      "bash -c 'git push --force origin main'", // nested shell (projected verb)
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "history-rewrite-foreign" });
    }
  });

  it("a plain push is not a history rewrite at all (F-PT-013's routine leg is unchanged by this split)", () => {
    expect(classify(bash("git push origin op/7-fix"))).toEqual({ cls: "routine" });
    expect(classify(bash("git push origin main"))).toEqual({ cls: "routine" });
  });
});

describe("CF-SPLIT-DESTRUCTIVE — local destruction and the raw-API default keep their boundaries", () => {
  it("rm -rf on absolute/~/$HOME/parent-escape targets is destructive-local at grantable; the relative-path calibration survives verbatim", () => {
    for (const command of ["rm -rf /var/data/exports", "rm -rf ~/scratch", "rm -rf ../sibling"]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "destructive-local" });
    }
    expect(dispositionTierForRule("destructive-local")).toBe("grantable");
    expect(classify(bash("rm -rf tmp/build"))).toEqual({ cls: "routine" });
  });

  it("a mutating gh api no tighter rule recognizes — and every graphql call — is gh-api-unrecognized at human-only (fail closed, formerly grantable)", () => {
    for (const command of [
      "gh api -X DELETE repos/o/r/git/refs/heads/x",
      "gh api --method=PATCH repos/o/r/git/refs/heads/x",
      "gh api graphql -f query='mutation { m }'",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "gh-api-unrecognized" });
    }
    expect(dispositionTierForRule("gh-api-unrecognized")).toBe("human-only");
    // Reads stay routine — availability damage is real damage (T-1).
    expect(classify(bash("gh api repos/o/r/issues/1"))).toEqual({ cls: "routine" });
  });

  it("retired rule name: a stale item raised as destructive-or-irreversible keeps its pre-split tier (grantable tombstone), never falls to a looser default and never returns as a live classifier rule", () => {
    expect(dispositionTierForRule("destructive-or-irreversible")).toBe("grantable");
    expect(NEVER_SCOPEABLE_RULES).not.toContain("destructive-or-irreversible");
  });

  it("seeded direction guard: no split class decides looser than the pre-split grantable bucket except the ratified owned-namespace case", () => {
    const strictness = { routine: 0, budgeted: 1, grantable: 2, "human-only": 3, "un-grantable": 4 } as const;
    for (const rule of ["destructive-remote-data", "history-rewrite-foreign", "destructive-local", "gh-api-unrecognized"]) {
      expect(strictness[dispositionTierForRule(rule)], rule).toBeGreaterThanOrEqual(strictness.grantable);
    }
    // The one ratified loosening, named exactly: owned-namespace force-push.
    expect(dispositionTierForRule("history-rewrite-owned")).toBe("budgeted");
  });

  it("disposition carries the split rule end to end", () => {
    const disposition = decideDisposition(bash("git push --force origin op/7-fix"));
    if (disposition.tier === "routine") throw new Error("force-push classified routine");
    expect(disposition.rule).toBe("history-rewrite-owned");
    expect(disposition.evidence.rule).toBe("history-rewrite-owned");
  });
});
