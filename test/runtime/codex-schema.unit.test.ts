// CodexRuntime strict-output schema transform (live-uncovered bug, 2026-07-06).
//
// OpenAI/Codex strict structured outputs reject a response_format json_schema
// whose object `required` omits any key in `properties`. The loop's build
// verdict schema legitimately marks `blockedEntry` optional (present only when
// status="blocked"). toCodexStrictSchema translates the generic verdict schema
// into the strict form the App Server/OpenAI demand: every property required,
// originally-optional fields made nullable.

import { describe, expect, it } from "vitest";
import { toCodexStrictSchema } from "../../src/runtime/adapters/codex.js";
import { VERDICT_SCHEMAS } from "../../src/loop/verdicts.js";

describe("toCodexStrictSchema", () => {
  it("lists every property in required and makes the optional field nullable", () => {
    const strict = toCodexStrictSchema(
      VERDICT_SCHEMAS.build as unknown as Record<string, unknown>,
    );

    expect(strict["required"]).toEqual(["status", "blockedEntry"]);
    expect(strict["additionalProperties"]).toBe(false);
    const props = strict["properties"] as Record<string, Record<string, unknown>>;
    // status was required -> stays a plain string enum.
    expect(props["status"]!["type"]).toBe("string");
    // blockedEntry was optional -> becomes nullable (type union with "null").
    expect(props["blockedEntry"]!["type"]).toEqual(["object", "null"]);
  });

  it("recurses: the nested blockedEntry object also lists all its keys in required", () => {
    const strict = toCodexStrictSchema(
      VERDICT_SCHEMAS.build as unknown as Record<string, unknown>,
    );
    const props = strict["properties"] as Record<string, Record<string, unknown>>;
    const blocked = props["blockedEntry"]!;

    expect(blocked["additionalProperties"]).toBe(false);
    expect(blocked["required"]).toEqual(["error", "attempted", "result", "assessment"]);
  });

  it("is a no-op-shape for schemas that were already fully required (contract/review)", () => {
    const contract = toCodexStrictSchema(
      VERDICT_SCHEMAS.contract as unknown as Record<string, unknown>,
    );
    // Every property already required -> required covers all keys, none nullable.
    const props = contract["properties"] as Record<string, unknown>;
    expect(contract["required"]).toEqual(Object.keys(props));

    const review = toCodexStrictSchema(
      VERDICT_SCHEMAS.review as unknown as Record<string, unknown>,
    );
    expect(review["required"]).toEqual(["verdict", "findings"]);
    // findings items (Finding) recurse to a fully-required strict object.
    const reviewProps = review["properties"] as Record<string, Record<string, unknown>>;
    const items = reviewProps["findings"]!["items"] as Record<string, unknown>;
    expect(items["additionalProperties"]).toBe(false);
    expect(items["required"]).toEqual([
      "category",
      "severity",
      "location",
      "description",
      "action",
    ]);
  });

  it("does not mutate the input schema", () => {
    const input = VERDICT_SCHEMAS.build as unknown as Record<string, unknown>;
    const before = JSON.stringify(input);
    toCodexStrictSchema(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
