import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseAppVerifyArgs } from "../src/cli/app.js";
import { parseLoopRunArgs } from "../src/cli/loop.js";
import { parsePlanArgs } from "../src/cli/plan.js";
import { CANONICAL_LABELS } from "../src/loop/plan-tickets.js";
import { initOrgHome } from "../src/org/home.js";
import { createNewApp, type NewAppTemplate } from "../src/org/new-app.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function generate(template: NewAppTemplate, goal = "Build a reviewed product slice.") {
  const root = tempDir(`operon-guidance-${template}-`);
  const orgHome = join(root, "org");
  const targetDir = join(root, template === "bare" ? "bare-product" : "typed-product");
  const appName = template === "bare" ? "bare-product" : "typed-product";
  const repoSlug = `owner/${appName}`;
  await initOrgHome({
    target: orgHome,
    name: `guidance-${template}`,
    stateHome: join(root, "state"),
    homeDir: join(root, "home"),
  });
  const result = await createNewApp({
    appName,
    targetDir,
    repoSlug,
    goal,
    template,
    orgHome,
  });
  return {
    appName,
    goal,
    repoSlug,
    targetDir,
    result,
    guidance: await readFile(join(targetDir, ".operon", "bootstrap", "next-commands.md"), "utf8"),
    labels: await readFile(join(targetDir, ".operon", "LABELS.md"), "utf8"),
  };
}

describe("generated new-app onboarding guidance", () => {
  it("pins the exact TypeScript/Node next-command packet", async () => {
    const generated = await generate("typescript-node");
    expect(generated.guidance.replaceAll(generated.targetDir, "<TARGET>"))
      .toMatchInlineSnapshot(`
        "# Next Commands

        ## Create The Repository And First Issue

        Run these from the generated app repo after reviewing the scaffold. Label setup
        is idempotent: \`--force\` creates missing labels and converges existing label
        color and description. The full vocabulary is documented in
        \`.operon/LABELS.md\`.

        \`\`\`bash
        git init
        git add .
        git commit -m 'Bootstrap typed-product'
        gh repo create 'owner/typed-product' --private --source . --remote origin --push
        gh label create 'op:ready' --color '0e8a16' --description 'Ready for the build loop to claim' --force --repo 'owner/typed-product'
        gh label create 'op:building' --color 'fbca04' --description 'Claimed by a build turn' --force --repo 'owner/typed-product'
        gh label create 'op:in-review' --color '1d76db' --description 'PR open, review in progress' --force --repo 'owner/typed-product'
        gh label create 'op:returned' --color 'd93f0b' --description 'Returned for human/planner triage' --force --repo 'owner/typed-product'
        gh label create 'op:blocked' --color 'b60205' --description 'Waiting on a critical-op approval' --force --repo 'owner/typed-product'
        gh label create 'op:tier-quick' --color 'c2e0c6' --description 'Derived quick reporting/safety label' --force --repo 'owner/typed-product'
        gh label create 'op:tier-standard' --color 'bfdadc' --description 'Derived standard reporting/safety label' --force --repo 'owner/typed-product'
        gh label create 'op:tier-deep' --color 'd4c5f9' --description 'Derived deep reporting/safety label' --force --repo 'owner/typed-product'
        gh label create 'p1' --color 'e11d21' --description 'Priority 1' --force --repo 'owner/typed-product'
        gh label create 'p2' --color 'eb6420' --description 'Priority 2' --force --repo 'owner/typed-product'
        gh label create 'p3' --color 'fef2c0' --description 'Priority 3' --force --repo 'owner/typed-product'
        gh label create 'domain:auth' --color '5319e7' --description 'Touches authn/authz surfaces' --force --repo 'owner/typed-product'
        gh label create 'domain:security' --color '5319e7' --description 'Touches security-sensitive surfaces' --force --repo 'owner/typed-product'
        gh label create 'domain:secret' --color '5319e7' --description 'Touches secret/credential handling' --force --repo 'owner/typed-product'
        gh label create 'domain:privacy' --color '5319e7' --description 'Touches privacy-sensitive handling' --force --repo 'owner/typed-product'
        gh label create 'domain:payment' --color '5319e7' --description 'Touches payment surfaces' --force --repo 'owner/typed-product'
        gh label create 'domain:data' --color '5319e7' --description 'Touches user-data storage/handling' --force --repo 'owner/typed-product'
        gh issue create --repo 'owner/typed-product' --title 'Build first usable product slice' --label 'op:ready' --label 'p2' --body-file '.operon/bootstrap/initial-issue.md'
        \`\`\`

        ## Plan The First Milestone

        The first planning command is a token-free preview. Review it before running
        the second, live planning command. The required product-truth sources are
        resolved relative to the exact \`--workdir\` checkout, so these commands work
        from any current directory.

        \`\`\`bash
        operon plan 'typed-product' --auto --goal 'Build a reviewed product slice.' --source 'docs/VISION.md' --source 'docs/REQUIREMENTS.md' --workdir '<TARGET>' --dry-run
        # If you copied and reviewed another design source into this repo, add --source '<path>' to both plan commands.
        operon plan 'typed-product' --auto --goal 'Build a reviewed product slice.' --source 'docs/VISION.md' --source 'docs/REQUIREMENTS.md' --workdir '<TARGET>'
        operon loop --app 'typed-product' --once
        \`\`\`
        "
      `);
  });

  it("pins the exact bare-template sequencing around its stack-and-gates issue", async () => {
    const generated = await generate("bare");
    expect(generated.guidance.replaceAll(generated.targetDir, "<TARGET>"))
      .toMatchInlineSnapshot(`
        "# Next Commands

        The bare template's generated initial issue is the stack-and-gates
        establishment path. Keep it as the only ready product-work issue until it
        merges: the loop reloads gate commands from the Builder worktree before gates,
        so that issue can introduce the first real commands without certifying the
        empty scaffold.

        Do not run \`operon app verify\` or \`operon app promote\` before that issue
        merges. Verification intentionally fails while test/lint commands are absent,
        and promotion requires a passing verification. Do not substitute placeholder,
        no-op, or zero-test commands.

        ## Create The Repository And First Issue

        Run these from the generated app repo after reviewing the scaffold. Label setup
        is idempotent: \`--force\` creates missing labels and converges existing label
        color and description. The full vocabulary is documented in
        \`.operon/LABELS.md\`.

        \`\`\`bash
        git init
        git add .
        git commit -m 'Bootstrap bare-product'
        gh repo create 'owner/bare-product' --private --source . --remote origin --push
        gh label create 'op:ready' --color '0e8a16' --description 'Ready for the build loop to claim' --force --repo 'owner/bare-product'
        gh label create 'op:building' --color 'fbca04' --description 'Claimed by a build turn' --force --repo 'owner/bare-product'
        gh label create 'op:in-review' --color '1d76db' --description 'PR open, review in progress' --force --repo 'owner/bare-product'
        gh label create 'op:returned' --color 'd93f0b' --description 'Returned for human/planner triage' --force --repo 'owner/bare-product'
        gh label create 'op:blocked' --color 'b60205' --description 'Waiting on a critical-op approval' --force --repo 'owner/bare-product'
        gh label create 'op:tier-quick' --color 'c2e0c6' --description 'Derived quick reporting/safety label' --force --repo 'owner/bare-product'
        gh label create 'op:tier-standard' --color 'bfdadc' --description 'Derived standard reporting/safety label' --force --repo 'owner/bare-product'
        gh label create 'op:tier-deep' --color 'd4c5f9' --description 'Derived deep reporting/safety label' --force --repo 'owner/bare-product'
        gh label create 'p1' --color 'e11d21' --description 'Priority 1' --force --repo 'owner/bare-product'
        gh label create 'p2' --color 'eb6420' --description 'Priority 2' --force --repo 'owner/bare-product'
        gh label create 'p3' --color 'fef2c0' --description 'Priority 3' --force --repo 'owner/bare-product'
        gh label create 'domain:auth' --color '5319e7' --description 'Touches authn/authz surfaces' --force --repo 'owner/bare-product'
        gh label create 'domain:security' --color '5319e7' --description 'Touches security-sensitive surfaces' --force --repo 'owner/bare-product'
        gh label create 'domain:secret' --color '5319e7' --description 'Touches secret/credential handling' --force --repo 'owner/bare-product'
        gh label create 'domain:privacy' --color '5319e7' --description 'Touches privacy-sensitive handling' --force --repo 'owner/bare-product'
        gh label create 'domain:payment' --color '5319e7' --description 'Touches payment surfaces' --force --repo 'owner/bare-product'
        gh label create 'domain:data' --color '5319e7' --description 'Touches user-data storage/handling' --force --repo 'owner/bare-product'
        gh issue create --repo 'owner/bare-product' --title 'Build first usable product slice' --label 'op:ready' --label 'p2' --body-file '.operon/bootstrap/initial-issue.md'
        \`\`\`

        ## Run The Stack-And-Gates Issue

        This first Builder invocation must select a stack and establish a real
        dependency manifest in a fresh worktree, so it explicitly permits outbound
        network access. The grant applies only to this invocation; omit it later unless
        the accepted work itself requires egress.

        \`\`\`bash
        operon loop --app 'bare-product' --once --allow-network
        \`\`\`

        ## After The Stack-And-Gates Issue Merges

        Verify the merged stack-specific checks before planning more product work:

        \`\`\`bash
        operon app verify 'bare-product'
        \`\`\`

        The first planning command is a token-free preview. Review it before running
        the second, live planning command. The required product-truth sources are
        resolved relative to the exact \`--workdir\` checkout, so these commands work
        from any current directory.

        \`\`\`bash
        operon plan 'bare-product' --auto --goal 'Build a reviewed product slice.' --source 'docs/VISION.md' --source 'docs/REQUIREMENTS.md' --workdir '<TARGET>' --dry-run
        # If you copied and reviewed another design source into this repo, add --source '<path>' to both plan commands.
        operon plan 'bare-product' --auto --goal 'Build a reviewed product slice.' --source 'docs/VISION.md' --source 'docs/REQUIREMENTS.md' --workdir '<TARGET>'
        operon loop --app 'bare-product' --once
        \`\`\`
        "
      `);
  });

  it("pins the exact generated label reference and emits it for both templates", async () => {
    const typed = await generate("typescript-node");
    const bare = await generate("bare");
    expect(typed.labels).toBe(bare.labels);
    expect(typed.result.created).toContain(".operon/LABELS.md");
    expect(bare.result.created).toContain(".operon/LABELS.md");
    expect(typed.labels).toMatchInlineSnapshot(`
      "# Operon GitHub Labels

      This file is generated from Operon's canonical label contract. The idempotent
      \`gh label create --force\` commands in
      \`.operon/bootstrap/next-commands.md\` install exactly these definitions before
      the first issue is created.

      An open Operon issue should carry at most one workflow-state label. Tier labels
      are durable reporting and safety metadata; the accepted EpisodePlan remains
      the live workflow authority. Do not invent additional \`op:*\` states or remove
      risk labels to bypass a plan or gate.

      ## Workflow State

      | Label | Color | Meaning | Applied by | Operator response |
      | --- | --- | --- | --- | --- |
      | \`op:ready\` | \`#0e8a16\` | Ready for the build loop to claim | Planner publication, dependency rearming, or the operator's reviewed first issue | Leave it for the loop to claim; do not add another Operon state label |
      | \`op:building\` | \`#fbca04\` | Claimed by a build turn | The build loop when it durably claims an op:ready issue | Inspect the durable run if it stalls; do not manually rearm the label |
      | \`op:in-review\` | \`#1d76db\` | PR open, review in progress | The build loop after Builder output and mechanical gates produce a PR | Let review and ship gates continue; inspect the linked PR if progress stops |
      | \`op:returned\` | \`#d93f0b\` | Returned for human/planner triage | The loop after a bounded failure, exhausted correction allowance, or triage finding | Read the retained evidence; use operon loop rearm with a reason and allowance to resume |
      | \`op:blocked\` | \`#b60205\` | Waiting on a critical-op approval | The loop when the exact durable continuation is waiting on critical-op approval | Review operon approvals; do not bypass the decision by editing labels |

      ## Derived Tier

      | Label | Color | Meaning | Applied by | Operator response |
      | --- | --- | --- | --- | --- |
      | \`op:tier-quick\` | \`#c2e0c6\` | Derived quick reporting/safety label | Planner publication after deterministic plan projection | Treat it as reporting metadata; the accepted EpisodePlan remains workflow authority |
      | \`op:tier-standard\` | \`#bfdadc\` | Derived standard reporting/safety label | Planner publication after deterministic plan projection | Treat it as reporting metadata; the accepted EpisodePlan remains workflow authority |
      | \`op:tier-deep\` | \`#d4c5f9\` | Derived deep reporting/safety label | Planner publication or the deterministic sensitive-domain floor | Preserve the risk signal and inspect the EpisodePlan; do not lower it to bypass safeguards |

      ## Priority

      | Label | Color | Meaning | Applied by | Operator response |
      | --- | --- | --- | --- | --- |
      | \`p1\` | \`#e11d21\` | Priority 1 | Planner publication, or an operator making an explicit priority decision | Expect selection before eligible p2/p3 work; change only when priority genuinely changes |
      | \`p2\` | \`#eb6420\` | Priority 2 | Planner publication, or the generated reviewed first-issue command | Treat as normal priority and leave ordering to the dependency-aware scheduler |
      | \`p3\` | \`#fef2c0\` | Priority 3 | Planner publication, or an operator making an explicit priority decision | Expect eligible p1/p2 work to run first; raise only with an explicit reprioritization |

      ## Sensitive Domain

      | Label | Color | Meaning | Applied by | Operator response |
      | --- | --- | --- | --- | --- |
      | \`domain:auth\` | \`#5319e7\` | Touches authn/authz surfaces | Planner publication when the ticket's own content names the auth domain | Preserve the label and verify the accepted plan covers authentication and authorization risk |
      | \`domain:security\` | \`#5319e7\` | Touches security-sensitive surfaces | Planner publication when the ticket's own content names the security domain | Preserve the label and verify the accepted plan carries the required security review |
      | \`domain:secret\` | \`#5319e7\` | Touches secret/credential handling | Planner publication when the ticket's own content names the secret domain | Preserve the label; confirm secret handling and redaction evidence before delivery |
      | \`domain:privacy\` | \`#5319e7\` | Touches privacy-sensitive handling | Planner publication when the ticket's own content names the privacy domain | Preserve the label; confirm the plan covers privacy constraints and evidence |
      | \`domain:payment\` | \`#5319e7\` | Touches payment surfaces | Planner publication when the ticket's own content names the payment domain | Preserve the label; confirm payment risk, rollback, and review are represented in the plan |
      | \`domain:data\` | \`#5319e7\` | Touches user-data storage/handling | Planner publication when the ticket's own content names the data domain | Preserve the label; confirm user-data safety, migration, and rollback facts are covered |
      "
    `);
  });

  it("derives every idempotent label command from CANONICAL_LABELS before the first issue", async () => {
    const { guidance, repoSlug } = await generate("typescript-node");
    const commands = bashCommands(guidance);
    const labelCommands = commands
      .map(shellWords)
      .filter((words) => words[0] === "gh" && words[1] === "label" && words[2] === "create");
    expect(labelCommands).toEqual(CANONICAL_LABELS.map((label) => [
      "gh",
      "label",
      "create",
      label.name,
      "--color",
      label.color,
      "--description",
      label.description,
      "--force",
      "--repo",
      repoSlug,
    ]));
    const issueIndex = commands.findIndex((command) => command.startsWith("gh issue create "));
    expect(issueIndex).toBeGreaterThan(-1);
    expect(commands.slice(0, issueIndex).filter((command) => command.startsWith("gh label create ")))
      .toHaveLength(CANONICAL_LABELS.length);
    expect(guidance).not.toContain("op:clamp");
    expect(guidance).not.toContain("op:none");
    expect(guidance).not.toMatch(/(?:^|[ '\"`])p0(?:$|[ '\"`])/m);
  });

  it("shell-quotes the exact goal and preserves checkout-relative required sources", async () => {
    const goal = `Ship the buyer's $5 catalog; echo "not a command" && $(touch escaped)`;
    const generated = await generate("typescript-node", goal);
    const plans = bashCommands(generated.guidance)
      .map(shellWords)
      .filter((words) => words[0] === "operon" && words[1] === "plan")
      .map((words) => parsePlanArgs(words.slice(2)));

    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.goal)).toEqual([goal, goal]);
    expect(plans.map((plan) => plan.sources)).toEqual([
      [
        { path: "docs/VISION.md", requirement: "required" },
        { path: "docs/REQUIREMENTS.md", requirement: "required" },
      ],
      [
        { path: "docs/VISION.md", requirement: "required" },
        { path: "docs/REQUIREMENTS.md", requirement: "required" },
      ],
    ]);
    expect(plans.map((plan) => plan.workdir)).toEqual([
      generated.targetDir,
      generated.targetDir,
    ]);
    expect(plans.map((plan) => plan.dryRun)).toEqual([true, false]);
    expect(generated.guidance).toContain("buyer'\"'\"'s");
    expect(generated.guidance).toContain(
      "# If you copied and reviewed another design source into this repo, add --source '<path>' to both plan commands.",
    );
  });

  it("extracts every generated Operon command and parses it with the executable CLI parsers", async () => {
    for (const template of ["typescript-node", "bare"] as const) {
      const generated = await generate(template);
      const operonCommands = bashCommands(generated.guidance)
        .map(shellWords)
        .filter((words) => words[0] === "operon");
      expect(operonCommands.length).toBeGreaterThan(0);
      for (const words of operonCommands) {
        if (words[1] === "plan") {
          expect(() => parsePlanArgs(words.slice(2))).not.toThrow();
        } else if (words[1] === "loop") {
          expect(() => parseLoopRunArgs(words.slice(2))).not.toThrow();
        } else if (words[1] === "app" && words[2] === "verify") {
          expect(() => parseAppVerifyArgs(words.slice(3))).not.toThrow();
        } else {
          throw new Error(`generated Operon command has no executable parser assertion: ${words.join(" ")}`);
        }
      }
      expect(operonCommands.some((words) => words.includes("--topic"))).toBe(false);
    }
  });

  it("grants network only to the bare template's first stack-establishment loop", async () => {
    const typed = await generate("typescript-node");
    const bare = await generate("bare");
    const typedLoops = bashCommands(typed.guidance)
      .map(shellWords)
      .filter((words) => words[0] === "operon" && words[1] === "loop");
    const bareLoops = bashCommands(bare.guidance)
      .map(shellWords)
      .filter((words) => words[0] === "operon" && words[1] === "loop");

    expect(typedLoops).toHaveLength(1);
    expect(typedLoops[0]).not.toContain("--allow-network");
    expect(bareLoops).toHaveLength(2);
    expect(parseLoopRunArgs(bareLoops[0]!.slice(2))).toMatchObject({
      appName: bare.appName,
      once: true,
      allowNetwork: true,
    });
    expect(parseLoopRunArgs(bareLoops[1]!.slice(2))).toMatchObject({
      appName: bare.appName,
      once: true,
      allowNetwork: false,
    });
    expect(bare.guidance).toContain("The grant applies only to this invocation");
  });

  it("lists LABELS.md in a non-writing dry run for both templates", async () => {
    for (const template of ["typescript-node", "bare"] as const) {
      const root = tempDir(`operon-guidance-dry-${template}-`);
      const orgHome = join(root, "org");
      const targetDir = join(root, "not-created");
      await initOrgHome({
        target: orgHome,
        name: `dry-${template}`,
        stateHome: join(root, "state"),
        homeDir: join(root, "home"),
      });
      const result = await createNewApp({
        appName: `dry-${template}`,
        targetDir,
        repoSlug: `owner/dry-${template}`,
        goal: "Preview generated onboarding guidance.",
        template,
        orgHome,
        dryRun: true,
      });
      expect(result.created).toContain(".operon/LABELS.md");
      expect(existsSync(targetDir)).toBe(false);
    }
  });
});

function bashCommands(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)\n```/g)]
    .flatMap((match) => match[1]!.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Minimal POSIX-shell word lexer for the generator's one-command-per-line
 * packet. It parses quoting only and never executes a command or expansion. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let state: "plain" | "single" | "double" = "plain";
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (state === "single") {
      if (char === "'") state = "plain";
      else word += char;
      started = true;
      continue;
    }
    if (state === "double") {
      if (char === '"') state = "plain";
      else if (char === "\\") word += command[++index] ?? "";
      else word += char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
    } else if (char === "'") {
      state = "single";
      started = true;
    } else if (char === '"') {
      state = "double";
      started = true;
    } else if (char === "\\") {
      word += command[++index] ?? "";
      started = true;
    } else {
      word += char;
      started = true;
    }
  }
  if (state !== "plain") throw new Error(`unterminated shell quote in: ${command}`);
  if (started) words.push(word);
  return words;
}
