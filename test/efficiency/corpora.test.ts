import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const routes = (parse(readFileSync(fileURLToPath(new URL("../../eval/corpora/routing.yaml", import.meta.url)), "utf8")) as { cases: Array<Record<string, unknown>> }).cases;
const actions = (parse(readFileSync(fileURLToPath(new URL("../../eval/corpora/actions.yaml", import.meta.url)), "utf8")) as { cases: Array<Record<string, unknown>> }).cases;
const depth = { quick: 0, standard: 1, deep: 2 } as const;

describe("reviewed deterministic corpora", () => {
  it("contains at least 30 unique risk cases and semantic minimal pairs", () => {
    expect(routes.length).toBeGreaterThanOrEqual(30); expect(new Set(routes.map((item) => item.id)).size).toBe(routes.length);
    expect(routes.find((item) => item.prose_variant === "write a deployment guide")?.expected).toBe("quick");
    expect(routes.find((item) => item.prose_variant === "execute the production deploy")?.expected).toBe("deep");
    expect(routes.find((item) => item.prompt_length === "short")?.expected).toBe(routes.find((item) => item.prompt_length === "very_long")?.expected);
  });
  it("adding real risk never reduces reviewed route depth", () => {
    const low = routes.find((item) => item.id === "r01")!; const high = routes.find((item) => item.id === "r29")!;
    expect(depth[high.expected as keyof typeof depth]).toBeGreaterThanOrEqual(depth[low.expected as keyof typeof depth]);
  });
  it("gives every critical semantic action a routine near-miss", () => {
    const byId = new Map(actions.map((item) => [item.id, item]));
    for (const action of actions.filter((item) => item.class === "critical")) expect(byId.get(action.near_miss)?.class, String(action.id)).toBe("routine");
  });
});
