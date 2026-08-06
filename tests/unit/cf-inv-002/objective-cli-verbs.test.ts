// CF-INV-002 — the objective CLI's write verbs are an effect surface (#296
// Stage 3): `cormidia objective grant|grant-critical|revoke` from inside a
// turn is self-granting by CLI — the same forged authority as a grant-file
// write, reached through the supported command — and classifies
// approval-store-tamper. Read-only `objective list` stays routine (the point
// is the boundary, not friction on inspection).
//
// L1 — pure classifier assertions. Risk E-1 / T-1.

import { describe, expect, it } from "vitest";
import { classify } from "../../../src/runtime/gate.js";

describe("CF-INV-002 — objective CLI verbs (L1)", () => {
  it("grant / grant-critical / revoke classify approval-store-tamper", () => {
    for (const command of [
      "cormidia objective grant --app x --objective ship --classes secrets-or-auth --repo o/r --by human/me",
      "cormidia objective grant-critical --app x --objective ship --class external-publishing --scope 'o/r issues' --repo o/r --by human/me",
      "cormidia objective revoke og-20260806T100000Z-abcd",
    ]) {
      expect(classify({ tool: "bash", input: { command } }), command).toEqual({
        cls: "critical",
        rule: "approval-store-tamper",
      });
    }
  });

  it("objective list stays routine", () => {
    expect(classify({ tool: "bash", input: { command: "cormidia objective list --json" } })).toEqual({
      cls: "routine",
    });
  });
});
