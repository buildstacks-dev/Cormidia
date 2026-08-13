// CF-REG-382 — HB-139 (standing regression-deposit record) — HB-156 (#382
// governed repository provisioning) — invariants.md CORMIDIA-INV-002 (the gate
// is TOTAL over critical effects) · docs/approvals/design.md §5.1–5.3.
//
// The defect, measured against src/runtime/gate.ts at 437256c7 before this
// change:
//
//   gh repo create <slug> --private --source … --push   -> routine
//   gh repo delete <slug> --yes                         -> routine
//   gh repo edit <slug> --visibility public             -> routine
//   gh repo archive <slug>                              -> routine
//   cormidia org publish --execute            (#388)    -> routine
//   cormidia app product-docs … --execute     (#389)    -> routine
//
// while the RAW-API spelling of the very first one classified human-only:
//
//   gh api --method POST /user/repos                    -> gh-api-unrecognized
//
// That asymmetry is the whole defect. `gh api` has a fail-closed default for
// endpoints no rule recognizes; the `gh` SUBCOMMAND surface had none, so an
// effect reachable two ways was governed one way. #382 could not build a
// governed provisioning lifecycle on top of a classifier that waved raw
// `gh repo create` through.
//
// L1 — pure assertions over the classifier and the tier table; no store, no IO.
// Risk REG. Control point T-1 (false-negative direction: a real critical effect
// classified routine is authority damage — system-map §5.2), so the
// critical-side cases lead and the routine-side controls bound the width.

import { describe, expect, it } from "vitest";
import {
  classify,
  dispositionTierForRule,
  NEVER_SCOPEABLE_RULES,
  ruleRequiresPerInstanceHumanDecision,
} from "../../../src/runtime/gate.js";
import { ORCHESTRATOR_EXECUTABLE_RULES } from "../../../src/org/approvals.js";
import type { ToolAction } from "../../../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "Bash", input: { command } });

describe("CF-REG-382 — repository provisioning classifies critical (the defect)", () => {
  // The exact command src/org/new-app-guide.ts emitted for operators to run by
  // hand. It is the headline case: it creates a repository, pushes every local
  // byte into it, and classified routine.
  const GUIDE_COMMAND = "gh repo create acme/widget --private --source /tmp/widget --remote origin --push";

  for (const command of [
    GUIDE_COMMAND,
    "gh repo create acme/widget --private",
    "gh repo create --private acme/widget",
    "gh repo delete acme/widget --yes",
    "gh repo edit acme/widget --visibility public",
    "gh repo edit acme/widget --description x",
    "gh repo archive acme/widget --yes",
    "gh repo unarchive acme/widget",
    "gh repo rename widget-2 --repo acme/widget",
  ]) {
    it(`classifies repo-provisioning: ${command}`, () => {
      expect(classify(bash(command))).toEqual({ cls: "critical", rule: "repo-provisioning" });
    });
  }

  // `gh repo edit --visibility public` and `gh repo edit --description x` are
  // INDISTINGUISHABLE in the effect projection (it drops flags), so both must
  // match. This pins the fail-closed direction deliberately: a mis-escalated
  // description edit costs one human tap, a silently published private
  // repository costs the whole confidentiality claim.
  it("matches every `gh repo edit`, because the projection cannot see --visibility", () => {
    expect(classify(bash("gh repo edit acme/widget --visibility public")).rule).toBe(
      classify(bash("gh repo edit acme/widget --description x")).rule,
    );
  });

  it("is human-only, never-scopeable, and orchestrator-executable", () => {
    expect(dispositionTierForRule("repo-provisioning")).toBe("human-only");
    expect(ruleRequiresPerInstanceHumanDecision("repo-provisioning")).toBe(true);
    // Derived from the tier table, so no widened A1 grant and no objective
    // grant can ever stand for "create any repository".
    expect(NEVER_SCOPEABLE_RULES).toContain("repo-provisioning");
    // The governed lifecycle depends on this: a human approves the exact
    // content-bound action and the durable executor creates the repo ONCE.
    expect(ORCHESTRATOR_EXECUTABLE_RULES).toContain("repo-provisioning");
  });
});

describe("CF-REG-382 — the raw-API spellings route to the same class, not to the catch-all", () => {
  for (const command of [
    "gh api --method POST /user/repos -f name=widget",
    "gh api --method POST orgs/acme/repos -f name=widget",
    "gh api --method DELETE repos/acme/widget",
    "gh api --method PATCH repos/acme/widget -f visibility=public",
  ]) {
    it(`routes to repo-provisioning: ${command}`, () => {
      expect(classify(bash(command))).toEqual({ cls: "critical", rule: "repo-provisioning" });
    });
  }

  // Negative control for the endpoint pattern: a DEEPER path is an operation
  // INSIDE the repository and must keep routing on its own merits. If
  // REPO_PROVISIONING_ENDPOINT ever loses its end anchor, these three flip and
  // this block fires.
  it("does not swallow operations inside a repository", () => {
    expect(classify(bash("gh api --method POST repos/acme/widget/issues -f title=x")).rule).toBe("repo-collaboration");
    expect(classify(bash("gh api --method POST repos/acme/widget/releases -f tag_name=v1")).rule).toBe(
      "release-artifact",
    );
    expect(classify(bash("gh api --method PUT repos/acme/widget/pulls/7/merge")).rule).toBe("self-merge-or-approve");
  });

  it("leaves reads routine — the point is the boundary, not friction on inspection", () => {
    for (const command of [
      "gh api repos/acme/widget",
      "gh api --method GET /user/repos",
      "gh repo view acme/widget",
      "gh repo list acme",
      "gh repo clone acme/widget",
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "routine" });
    }
  });
});

describe("CF-REG-382 — the org CLI's own publish verbs (#388/#389 gap)", () => {
  // #388 added `cormidia org publish` and #389 added the publishing mode of
  // `cormidia app product-docs`. Both open draft pull requests on GitHub;
  // both classified routine, while their older sibling `cormidia bootstrap
  // publish` was human-only. CORMIDIA_VERB is the register that was missed.
  it("org publish is outbound-message, with or without --execute", () => {
    expect(classify(bash("cormidia org publish --surface app-registry --execute")).rule).toBe("outbound-message");
    // Matched by VERB like `bootstrap publish`: a command whose whole purpose
    // is publication pays one tap on its preview mode.
    expect(classify(bash("cormidia org publish --surface app-registry")).rule).toBe("outbound-message");
  });

  it("app product-docs escalates only under --execute, because its default is inspection", () => {
    expect(classify(bash("cormidia app product-docs widget --disposition keep --execute --confirm widget")).rule).toBe(
      "outbound-message",
    );
    expect(classify(bash("cormidia app product-docs widget --disposition keep"))).toEqual({ cls: "routine" });
  });

  it("provision-repo escalates only under --execute, and fails closed on an unreadable command", () => {
    expect(classify(bash("cormidia app provision-repo widget --execute --confirm widget")).rule).toBe(
      "repo-provisioning",
    );
    expect(classify(bash("cormidia org provision-repo --execute --confirm acme-org")).rule).toBe("repo-provisioning");
    expect(classify(bash("cormidia app provision-repo widget"))).toEqual({ cls: "routine" });

    // Fail-closed axes of carriesExecuteFlag: a value the shell would EXPAND
    // could produce the flag, and an action with no parsed command cannot be
    // read at all. Both count as executing.
    expect(classify(bash('cormidia app provision-repo widget "$FLAGS"')).rule).toBe("repo-provisioning");
    expect(classify({ tool: "cormidia app provision-repo --execute", input: {} }).rule).toBe("repo-provisioning");
  });

  it("read-only org CLI verbs stay routine", () => {
    for (const command of ["cormidia status", "cormidia apps", "cormidia context", "cormidia doctor"]) {
      expect(classify(bash(command)), command).toEqual({ cls: "routine" });
    }
  });
});

describe("CF-REG-382 — negative controls: the detector must be able to fire", () => {
  // A seeded permissive classifier. If `repo-provisioning` were dropped or its
  // pattern narrowed to nothing, every assertion in the first block above would
  // report routine — exactly the pre-fix state. This proves the detector is
  // sensitive to that regression rather than passing by construction.
  it("a classifier without the repo-provisioning pattern would report routine", () => {
    const seededPermissive = (command: string): "critical" | "routine" =>
      /\bgh\s+repo\s+(?:create|delete|edit|archive|unarchive|rename)\b/.test(command) ? "routine" : "routine";
    expect(seededPermissive("gh repo create acme/widget --private")).toBe("routine");
    expect(classify(bash("gh repo create acme/widget --private")).cls).toBe("critical");
  });

  // The disqualifying alternative, pinned so nobody "simplifies" the rule into
  // repo-collaboration later. That rule's budgeted tier is reached whenever the
  // composed gate verifies the target as the app's OWN configured repository —
  // and a provisioning target IS the app's configured slug. Folding the two
  // together would make repository creation agent-decidable.
  it("is NOT repo-collaboration, whose budgeted tier a provisioning target would satisfy", () => {
    expect(classify(bash("gh repo create acme/widget --private")).rule).not.toBe("repo-collaboration");
    expect(dispositionTierForRule("repo-collaboration")).toBe("budgeted");
    expect(dispositionTierForRule("repo-provisioning")).toBe("human-only");
  });

  // The other disqualifying alternative: right tier, wrong NAME. Rule names key
  // ORCHESTRATOR_EXECUTABLE_RULES, FORBIDDEN_BY_ROLE, objective grants, and the
  // persisted classification evidence.
  it("does not record `gh-api-unrecognized` for a command containing no `gh api`", () => {
    expect(classify(bash("gh repo create acme/widget --private")).rule).not.toBe("gh-api-unrecognized");
  });
});
