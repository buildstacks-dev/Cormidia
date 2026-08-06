// CF-SPLIT-PUBLISHING (L1) — the §5.3 headline split of `external-publishing`
// (#296, F-PT-023 ratified 2026-08-06; case-catalog §10.1):
//
//   repo-collaboration          B   gh issue/pr create/comment and the typed
//                                   cormidia.github.issue.* tools — budgeted
//                                   ONLY after the composed gate verifies the
//                                   target is the app's own repo (L2 spec)
//   repo-collaboration-foreign  HO  the same verbs against any other repo, or
//                                   an unverifiable target — refined at the
//                                   composed gate, never emitted here
//   package-publish             HO  npm/pnpm/yarn publish
//   release-artifact            HO  gh release create + git tag CREATION
//   outbound-message            HO  sendmail / mail / tweet / the org CLI's
//                                   own publish verbs
//
// The compensating control: today a human approving `gh issue comment` is
// approving a comment on ANY repository — the gate never checks which. Under
// the split the budgeted tier is reachable only after target verification;
// publishing, releasing, and messaging never ride the collaboration tier.

import { describe, expect, it } from "vitest";
import {
  classify,
  collaborationTargets,
  dispositionTierForRule,
  NEVER_SCOPEABLE_RULES,
} from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

function bash(command: string): ToolAction {
  return { tool: "bash", input: { command } };
}

describe("CF-SPLIT-PUBLISHING — collaboration verbs classify repo-collaboration with their targets extracted", () => {
  it("gh issue/pr create/comment classify repo-collaboration at the budgeted tier", () => {
    for (const command of [
      "gh issue comment 12 --body done",
      "gh issue create --title t --body b",
      "gh pr create --title t --body b",
      "gh pr comment 7 --body reviewed",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "repo-collaboration" });
    }
    expect(dispositionTierForRule("repo-collaboration")).toBe("budgeted");
    expect(NEVER_SCOPEABLE_RULES).not.toContain("repo-collaboration");
  });

  it("the typed durable-github tools classify repo-collaboration and expose their input repo as the explicit target", () => {
    const typed: ToolAction = {
      tool: "cormidia.github.issue.comment",
      input: { schema_version: 1, repo: "cormidia/app", issue: 12, body: "done" },
    };
    expect(classify(typed)).toEqual({ cls: "critical", rule: "repo-collaboration" });
    expect(collaborationTargets(typed)).toEqual({
      explicit: ["cormidia/app"],
      undeterminable: false,
      implicitCwd: false,
    });
  });

  it("targets: an explicit --repo/-R slug is extracted; no flag means the cwd repo; dynamic or cwd-shifting forms are undeterminable", () => {
    expect(collaborationTargets(bash("gh issue comment 12 -R other/repo --body x"))).toEqual({
      explicit: ["other/repo"],
      undeterminable: false,
      implicitCwd: false,
    });
    expect(collaborationTargets(bash("gh pr comment 7 --repo own/app --body x"))).toEqual({
      explicit: ["own/app"],
      undeterminable: false,
      implicitCwd: false,
    });
    expect(collaborationTargets(bash("gh issue comment 12 --body x"))).toEqual({
      explicit: [],
      undeterminable: false,
      implicitCwd: true,
    });
    expect(collaborationTargets(bash('gh issue comment 12 -R "$TARGET" --body x'))?.undeterminable).toBe(true);
    expect(collaborationTargets(bash("cd /tmp/evil-clone && gh issue comment 12 --body x"))?.undeterminable).toBe(true);
    expect(collaborationTargets(bash("git status"))).toBeNull();
  });

  it("the foreign class is a disposition rule, not a classifier rule: human-only, never widenable", () => {
    expect(dispositionTierForRule("repo-collaboration-foreign")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).toContain("repo-collaboration-foreign");
  });
});

describe("CF-SPLIT-PUBLISHING — publishing, releasing, and messaging never ride the collaboration tier", () => {
  it("package publication is human-only", () => {
    for (const command of ["npm publish", "npm publish --access public", "pnpm publish"]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "package-publish" });
    }
    expect(dispositionTierForRule("package-publish")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).toContain("package-publish");
  });

  it("release artifacts: gh release create, the raw-API releases route, and git tag CREATION are human-only — tag listing stays routine", () => {
    for (const command of [
      "gh release create v1.2.3 --notes done",
      "gh api -X POST repos/o/r/releases -f tag_name=v1",
      "git tag v1.2.3",
      "git tag -a v1.2.3 -m release",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "release-artifact" });
    }
    expect(classify(bash("git tag"))).toEqual({ cls: "routine" });
    expect(classify(bash("git tag -l"))).toEqual({ cls: "routine" });
    expect(classify(bash("git tag --list 'v*'"))).toEqual({ cls: "routine" });
    expect(dispositionTierForRule("release-artifact")).toBe("human-only");
  });

  it("outbound messages and the org CLI's own publish verbs are human-only", () => {
    for (const command of [
      "sendmail ops@example.com < report.txt",
      "cormidia plan ratify-ticket-budget --app x --execute",
      "cormidia bootstrap publish my-app --execute",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "outbound-message" });
    }
    expect(dispositionTierForRule("outbound-message")).toBe("human-only");
  });

  it("the raw-API issues/comments routes join the collaboration class (target refinement at the composed gate)", () => {
    for (const command of [
      "gh api -X POST repos/o/r/issues -f title=x",
      "gh api repos/o/r/issues/3/comments -f body=x",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "repo-collaboration" });
    }
  });
});

describe("CF-SPLIT-PUBLISHING — retirement and direction", () => {
  it("the retired external-publishing name keeps a HUMAN-ONLY tombstone (its old strictness), and never returns as a live rule", () => {
    expect(dispositionTierForRule("external-publishing")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).not.toContain("external-publishing");
  });

  it("direction: only verified own-repo collaboration loosens; every other successor is at or above the old human-only tier", () => {
    const strictness = { routine: 0, budgeted: 1, grantable: 2, "human-only": 3, "un-grantable": 4 } as const;
    for (const rule of ["repo-collaboration-foreign", "package-publish", "release-artifact", "outbound-message"]) {
      expect(strictness[dispositionTierForRule(rule)], rule).toBeGreaterThanOrEqual(strictness["human-only"]);
    }
    expect(dispositionTierForRule("repo-collaboration")).toBe("budgeted");
  });
});
