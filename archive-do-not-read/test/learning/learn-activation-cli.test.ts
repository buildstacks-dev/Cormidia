// `operon learn` M4 verbs end-to-end against a real initialized org home
// (src/cli/learn-activation.ts): review → publish (raise → approve →
// publish) → resolve → disable → rollback → provisional, plus candidate
// disposition tracing and the report's activation sections. Temp dirs only;
// no network (org-scoped flows never need GhOps).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cmdLearn } from "../../src/cli/learn.js";
import { ApprovalStore } from "../../src/org/approvals.js";
import { initOrgHome } from "../../src/org/home.js";
import { conceptMarkdown, makeCandidate } from "./helpers.js";

const ROOT = mkdtempSync(join(tmpdir(), "operon-learn-m4-cli-"));
const ORG_HOME = join(ROOT, "org");
const STATE_HOME = join(ROOT, "state");
const HOME_FLAGS = ["--org-home", ORG_HOME, "--state-home", STATE_HOME];
const CAND = "cand_20260711_CLI01";

beforeAll(async () => {
  await initOrgHome({
    target: ORG_HOME,
    name: "learn-m4-test",
    stateHome: STATE_HOME,
    homeDir: join(ROOT, "home"),
  });
  const candidates = join(ORG_HOME, "learning", "candidates");
  mkdirSync(candidates, { recursive: true });
  writeFileSync(
    join(candidates, `${CAND}.json`),
    JSON.stringify(makeCandidate({ candidate_id: CAND, destination: "okf_concept" }), null, 2) + "\n",
  );
  writeFileSync(
    join(candidates, `${CAND}.md`),
    conceptMarkdown({
      name: "map-criteria-to-tests",
      id: "lrn_cli01",
      scope: "roles/builder",
      status: "candidate",
      keywords: ["builder", "tests"],
    }),
  );
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

function captureLogs(): { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => logs.push(parts.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => errors.push(parts.join(" ")));
  return { logs, errors };
}

describe("operon learn — M4 governed activation flow", () => {
  it("walks review → raise → approve → publish → resolve → disable → rollback", async () => {
    // Unreviewed publish fails closed.
    const closed = captureLogs();
    expect(await cmdLearn(["publish", CAND, ...HOME_FLAGS])).toBe(1);
    expect(closed.errors.join("\n")).toContain("fails closed");
    vi.restoreAllMocks();

    // Review (human-invoked in M4).
    const review = captureLogs();
    expect(
      await cmdLearn([
        "review",
        CAND,
        "--verdict",
        "approve",
        "--rationale",
        "narrow, grounded, no injection markers",
        "--by",
        "human-operator",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    expect(review.logs.join("\n")).toContain("disposition proceed");
    vi.restoreAllMocks();

    // Publish → content-bound approval raised.
    const raise = captureLogs();
    expect(await cmdLearn(["publish", CAND, ...HOME_FLAGS])).toBe(0);
    expect(raise.logs.join("\n")).toContain("raised content-bound approval");
    vi.restoreAllMocks();

    const store = new ApprovalStore(STATE_HOME);
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.rule).toBe("learning-publish");
    await store.decide(pending[0]!.id, { decision: "approved" });

    // Publish again → the journaled transaction runs.
    const publish = captureLogs();
    expect(await cmdLearn(["publish", CAND, ...HOME_FLAGS])).toBe(0);
    expect(publish.logs.join("\n")).toContain("published " + CAND);
    expect(publish.logs.join("\n")).toContain("authorized (unproven)");
    vi.restoreAllMocks();

    // The candidate id now traces to its disposition.
    const show = captureLogs();
    expect(await cmdLearn(["show", CAND, ...HOME_FLAGS])).toBe(0);
    expect(show.logs.join("\n")).toContain("active okf_concept");
    vi.restoreAllMocks();

    // The concept resolves for builder turns.
    const resolve = captureLogs();
    expect(
      await cmdLearn(["resolve", "--app", "alpha", "--role", "builder", ...HOME_FLAGS]),
    ).toBe(0);
    expect(resolve.logs.join("\n")).toContain("map-criteria-to-tests");
    vi.restoreAllMocks();

    // Disable takes effect for the next resolve.
    const disable = captureLogs();
    expect(await cmdLearn(["disable", "lrn_cli01", ...HOME_FLAGS])).toBe(0);
    expect(disable.logs.join("\n")).toContain("in-flight turns keep their pin");
    vi.restoreAllMocks();

    const after = captureLogs();
    expect(
      await cmdLearn(["resolve", "--app", "alpha", "--role", "builder", ...HOME_FLAGS]),
    ).toBe(0);
    expect(after.logs.join("\n")).not.toContain("map-criteria-to-tests");
    vi.restoreAllMocks();

    // Rollback refuses when the latest cut (the disable) has nothing still
    // active — a silent no-op that blocks future rollbacks would be worse.
    await expect(cmdLearn(["rollback", "--root", "org", ...HOME_FLAGS])).rejects.toThrow(
      /no still-active concepts/,
    );
  });

  it("quarantines a provisional through the urgent human lane and reports activation sections", async () => {
    const provisional = captureLogs();
    expect(
      await cmdLearn([
        "provisional",
        "--scope",
        "roles/support",
        "--name",
        "urgent-support-fact",
        "--description",
        "Do not invent replies without a payload",
        "--ttl-days",
        "5",
        "--by",
        "human-operator",
        "--body",
        "When the payload is missing, open intake work instead of replying.",
        ...HOME_FLAGS,
      ]),
    ).toBe(0);
    expect(provisional.logs.join("\n")).toContain("UNVERIFIED - provisional");
    vi.restoreAllMocks();

    const resolve = captureLogs();
    expect(
      await cmdLearn(["resolve", "--app", "alpha", "--role", "support", ...HOME_FLAGS]),
    ).toBe(0);
    expect(resolve.logs.join("\n")).toContain("UNVERIFIED - provisional");
    vi.restoreAllMocks();

    const report = captureLogs();
    expect(await cmdLearn(["report", ...HOME_FLAGS])).toBe(0);
    const text = report.logs.join("\n");
    expect(text).toContain("Reviews: 1");
    expect(text).toContain("Activation:");
    expect(text).toContain("reviewer-human agreement: 1/1");
  });
});
