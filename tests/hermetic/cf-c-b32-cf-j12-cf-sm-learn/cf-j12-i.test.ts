// Traceability: CF-J12-I · HB-157; CF-C-B32 · HB-156 · contracts/journey-acceptance.md J-12 interruption criterion; contracts/B-32-learning-kernel-ports.md.

// CF-J12-I — a crash mid-publish on the KERNEL path forward-completes or
// no-ops from the kernel journal (L2 state, risk E1; Cormidia #467 phase B;
// kernel decision 0026; INV-013).
//
// Crash method: interrupted sequence at a ratified seam, never SIGKILL —
// a destination wrapper that throws AFTER the OKF destination wrote the
// concept file but BEFORE the manifest cut (leg 1), and one that throws
// after the destination's receipt was written (leg 2). The kernel journal
// records the consumed authorization first, so a resume never re-consults
// authority, never re-applies a journaled effect, and completes with exactly
// one cut. Between crash and resume the concept is on disk but NOT cut: the
// host resolver's INV-013 guard (manifest membership) keeps it out of
// context until the cut lands.

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicationDestination } from "@cormidia/learning-loop";
import { writeFileAtomic } from "../../../src/org/atomic.js";
import { publishCandidate } from "../../../src/org/learning-loop/publish.js";
import { readManifest } from "../../../src/org/learning-loop/host/concepts.js";
import { resolveLearningContext } from "../../../src/org/learning-loop/host/resolver.js";
import {
  assertExactlyOncePublish,
  KERNEL_APP,
  makeKernelWorld,
  raiseAndApprove,
  seedReviewedOkfCandidate,
  type KernelWorld,
} from "./learning-kernel-seams.js";

const CAND = "cand_j12i_lesson";
const CONCEPT = "lrn_j12i_lesson";
const NAME = "j12i-crash-lesson";

class ScriptedCrash extends Error {
  constructor(readonly where: string) {
    super(`scripted crash ${where}`);
    this.name = "ScriptedCrash";
  }
}

/** A world whose org OKF destination is wrapped (the B-32 §4 destination-port
 *  seam) to crash at a named step of `applyEffect`; the kernel sees an
 *  adapter that threw, journals `failed`, and must resume cleanly once the
 *  wrapper is disarmed. */
async function makeCrashWorld(
  name: string,
): Promise<{ world: KernelWorld; arm(where: "before_cut" | "after_receipt" | null): void }> {
  let where: "before_cut" | "after_receipt" | null = null;
  let orgRootDir = "";
  const world = await makeKernelWorld(name, {
    wrapDestination: (real) => {
      if (real.id !== "okf-concept:org") return real;
      const wrapped: PublicationDestination = {
        id: real.id,
        prepare: (input) => real.prepare(input),
        applyEffect: async (input) => {
          if (where === "before_cut") {
            // Reproduce the destination's first durable write, then die before its cut.
            const payload = input.effect.payload;
            const markdown =
              payload !== null && typeof payload === "object" && !Array.isArray(payload)
                ? Reflect.get(payload, "markdown")
                : undefined;
            if (typeof markdown === "string") {
              const target = join(orgRootDir, input.effect.target);
              await mkdir(dirname(target), { recursive: true });
              await writeFileAtomic(target, markdown);
            }
            throw new ScriptedCrash("before the manifest cut");
          }
          const receipt = await real.applyEffect(input);
          if (where === "after_receipt") throw new ScriptedCrash("after the destination receipt");
          return receipt;
        },
      };
      return wrapped;
    },
  });
  orgRootDir = world.orgRoot.dir;
  return {
    world,
    arm: (next) => {
      where = next;
    },
  };
}

describe("CF-J12-I — a crash mid-publish forward-completes or no-ops from the kernel journal (L2, E1)", () => {
  let world: KernelWorld;

  afterEach(async () => {
    await world.cleanup();
  });

  const resolveOnce = (turn: string) =>
    resolveLearningContext({
      orgHome: world.org.orgHome,
      app: KERNEL_APP,
      role: "builder",
      turnId: turn,
      episodeId: `ep_${turn}`,
      taskText: "any task",
      policy: world.policy,
    });

  it("crash BETWEEN the concept write and the manifest cut: the concept never resolves mid-flight (INV-013); the resume completes with ONE cut and the kernel journals `failed` → `resumed`", async () => {
    const crash = await makeCrashWorld("cf-j12-i-kernel-leg1");
    world = crash.world;
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    await raiseAndApprove(world, CAND);
    crash.arm("before_cut");
    const failed = await publishCandidate(world.deps, CAND);
    expect(failed.status).toBe("refused");
    if (failed.status === "refused") expect(failed.reason).toContain("kernel failed");

    // Precondition pin: the concept file exists, no manifest cut landed.
    const conceptPath = join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`);
    expect(existsSync(conceptPath)).toBe(true);
    expect(await readManifest(world.orgRoot)).toBeNull();

    // The ratified clause: a partially committed publication never resolves.
    const midFlight = await resolveOnce("turn_j12i_mid");
    expect(midFlight.concept_ids).not.toContain(CONCEPT);

    // Resume: authority is not re-consulted (no fresh raise), the same plan
    // completes, exactly one cut, the same bytes.
    crash.arm(null);
    world.clock.advance(60_000);
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    const manifest = await readManifest(world.orgRoot);
    expect(manifest?.history).toHaveLength(1);
    expect(manifest?.history[0]?.concepts).toEqual([CONCEPT]);
    expect((await world.approvals.listPending()).length).toBe(0);
    const decided = await world.approvals.listDecidedReadOnly();
    expect(decided.filter((item) => item.action.tool === "learning_loop_publish")).toHaveLength(1);
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
    const committed = await resolveOnce("turn_j12i_post");
    expect(committed.concept_ids).toContain(CONCEPT);
    expect(committed.bundle_versions["org"]).toBe(manifest?.bundle_version);
  });

  it("crash AFTER the destination receipt: the resume re-applies nothing (the destination answers its stored receipt) and the journal completes once", async () => {
    const crash = await makeCrashWorld("cf-j12-i-kernel-leg2");
    world = crash.world;
    await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    await raiseAndApprove(world, CAND);
    crash.arm("after_receipt");
    const failed = await publishCandidate(world.deps, CAND);
    expect(failed.status).toBe("refused");
    // Precondition pin: the cut and the receipt landed before the crash.
    expect((await readManifest(world.orgRoot))?.history).toHaveLength(1);
    const receiptsDir = join(world.learning.stateDir, "receipts", "okf-concept-org");
    const receipts = await readFile(join(receiptsDir, readdirSync(receiptsDir)[0] ?? ""), "utf8");
    expect(receipts).toContain("idempotencyKey");

    crash.arm(null);
    world.clock.advance(60_000);
    const resumed = await publishCandidate(world.deps, CAND);
    expect(resumed.status).toBe("published");
    expect((await readManifest(world.orgRoot))?.history).toHaveLength(1);
    await assertExactlyOncePublish({ world, candidateId: CAND, conceptId: CONCEPT });
  });

  it("negative control: a post-approval draft tamper cannot change what publishes — the kernel plan bound the draft bytes, so the tampered draft yields a DIFFERENT plan and a fresh raise, never a publish under the old approval", async () => {
    world = await makeKernelWorld("cf-j12-i-kernel-tamper");
    const { markdown } = await seedReviewedOkfCandidate(world, { id: CAND, conceptId: CONCEPT, name: NAME });
    await raiseAndApprove(world, CAND);
    await writeFile(
      join(world.org.orgHome, "learning", "candidates", `${CAND}.md`),
      markdown.replace(`Body of ${NAME}.`, "TAMPERED after approval."),
      "utf8",
    );
    world.clock.advance(1_000);
    const outcome = await publishCandidate(world.deps, CAND);
    expect(outcome.status).toBe("raised");
    expect(existsSync(join(world.org.orgHome, "learning", "bundle", "org", `${NAME}.md`))).toBe(false);
    expect(await readManifest(world.orgRoot)).toBeNull();
    // Two approval items now exist: the original (bound to the approved
    // bytes, now unusable for the new plan) and the fresh raise.
    expect((await world.approvals.listPending()).length).toBe(1);
    expect((await world.approvals.listDecidedReadOnly()).length).toBe(1);
  });
});
