import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeEvalWorld, type EvalWorld } from "../fixtures/evalWorld.js";

const worlds: EvalWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });

describe("EvalWorld isolation", () => {
  it("creates all homes below one auditable root with explicit isolated env", () => {
    const world = makeEvalWorld({ campaignId: "world-test", operonExecutable: "/bin/echo" }); worlds.push(world);
    world.assertSeparated();
    for (const value of [world.env.HOME, world.env.OPERON_ORG_HOME, world.env.OPERON_STATE_HOME, world.env.CODEX_HOME]) expect(value).toContain(world.root);
    expect(world.run(["ok"]).trim()).toBe("ok");
    expect(world.remote.bare.log()).toEqual(["chore: init origin main"]);
    expect(world.clock.now().toISOString()).toBe("2026-07-12T00:00:00.000Z");
    expect(JSON.parse(readFileSync(world.paths.executableEvidence, "utf8")).realpath).toBeTruthy();
    expect(JSON.parse(readFileSync(join(world.paths.package, "identity.json"), "utf8")).sha256).toBe(world.executable?.sha256);
  });
  it("detects wrong executable identity", () => { expect(() => makeEvalWorld({ operonExecutable: "/bin/echo", expectedExecutableSha256: "0".repeat(64) })).toThrow("wrong_eval_executable"); });
  it("detects production-path overlap", () => {
    const world = makeEvalWorld(); worlds.push(world);
    expect(() => world.assertSeparated([world.paths.org])).toThrow("production_path_leakage");
  });
  it("detects a hidden answer in actor-readable roots while keeping verifier isolated", () => {
    const world = makeEvalWorld(); worlds.push(world); const marker = "OPERON_HIDDEN_31fef7";
    writeFileSync(join(world.paths.verifier, "answer.txt"), marker); world.assertNoHiddenMarker(marker);
    writeFileSync(join(world.paths.apps.library, "leak.txt"), marker);
    expect(() => world.assertNoHiddenMarker(marker)).toThrow("hidden_answer_leakage");
  });
  it("trips on any undeclared provider construction", () => { const world = makeEvalWorld(); worlds.push(world); expect(() => world.constructProvider()).toThrow("undeclared_provider_call"); });
});
