import { afterEach, describe, expect, it } from "vitest";
import {
  runGates,
  runTestsGate,
  type GateCommands,
} from "../../../src/loop/qgates.js";
import type { Policy } from "../../../src/loop/policy.js";
import {
  createControlledWorld,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

const policy: Policy = {
  riskTiers: { low: [], medium: [], high: [] },
  gates: { low: [], medium: [], high: ["tests"] },
  dimensionGlobs: {},
  remediation: { maxAttempts: 3 },
};

describe("bounded no-progress and child-process termination", () => {
  it("blocks an identical evidenced gate failure instead of spending the remaining retries", async () => {
    world = await createControlledWorld("layer-2-no-progress");
    const commands: GateCommands = {
      testCommand:
        "node -e \"process.stderr.write('stable controlled failure\\\\n'); process.exit(1)\"",
    };
    const reviewState = {
      approvedCommitId: "controlled-head",
      headCommitId: "controlled-head",
    };

    const first = await runGates(
      "high",
      world.workdir,
      [],
      [],
      reviewState,
      {
        policy,
        commands,
        criterionTests: {},
        currentAttempt: 1,
        process: { timeoutMs: 1_000 },
      },
    );
    expect(first).toMatchObject({
      status: "fail",
      remediation: {
        canRetry: true,
        noProgress: false,
      },
    });
    expect(first.remediation.failureIdentity).toMatch(/^[a-f0-9]{64}$/);
    const failureIdentity = first.remediation.failureIdentity;
    if (failureIdentity === undefined) {
      throw new Error("controlled evidenced failure must have an identity");
    }

    const repeated = await runGates(
      "high",
      world.workdir,
      [],
      [],
      reviewState,
      {
        policy,
        commands,
        criterionTests: {},
        currentAttempt: 2,
        previousFailureIdentity: failureIdentity,
        process: { timeoutMs: 1_000 },
      },
    );
    expect(repeated).toMatchObject({
      status: "blocked",
      remediation: {
        canRetry: false,
        exhausted: false,
        noProgress: true,
        failureIdentity,
      },
    });

    const changed = await runGates(
      "high",
      world.workdir,
      [],
      [],
      reviewState,
      {
        policy,
        commands: {
          testCommand:
            "node -e \"process.stderr.write('different controlled failure\\\\n'); process.exit(1)\"",
        },
        criterionTests: {},
        currentAttempt: 2,
        previousFailureIdentity: failureIdentity,
        process: { timeoutMs: 1_000 },
      },
    );
    expect(changed).toMatchObject({
      status: "fail",
      remediation: {
        canRetry: true,
        noProgress: false,
      },
    });
    expect(changed.remediation.failureIdentity).not.toBe(failureIdentity);
  });

  it("terminates a non-ending child gate with bounded timeout evidence", async () => {
    world = await createControlledWorld("layer-2-child-hang");
    const result = await runTestsGate(
      world.workdir,
      { testCommand: "node -e \"setInterval(() => {}, 1000)\"" },
      { timeoutMs: 100 },
    );

    expect(result).toMatchObject({
      gate: "tests",
      status: "fail",
      timedOut: true,
    });
    expect(result.detail).toMatch(/timed out/i);
    expect(result.durationMs).toBeLessThan(5_000);
  });
});
