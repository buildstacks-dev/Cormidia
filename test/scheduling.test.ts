import { describe, expect, it } from "vitest";
import { selectReadyTickets } from "../src/loop/scheduling.js";

describe("selectReadyTickets", () => {
  it("unmerged dependency excludes a ready ticket", () => {
    const selected = selectReadyTickets(
      [
        { id: 1, phase: "ready" },
        { id: 2, phase: "ready", dependsOn: [1] },
      ],
      2,
    );

    expect(selected.map((t) => t.id)).toEqual([1]);
  });

  it("overlapping scopes are not selected together", () => {
    const selected = selectReadyTickets(
      [
        { id: 1, phase: "ready", scope: ["src/a.ts"] },
        { id: 2, phase: "ready", scope: ["src/a.ts"] },
        { id: 3, phase: "ready", scope: ["src/b.ts"] },
      ],
      3,
    );

    expect(selected.map((t) => t.id)).toEqual([1, 3]);
  });

  it("cap is respected", () => {
    const selected = selectReadyTickets(
      [
        { id: 1, phase: "ready" },
        { id: 2, phase: "ready" },
      ],
      1,
    );

    expect(selected.map((t) => t.id)).toEqual([1]);
  });

  it("independent tickets are both selected under cap", () => {
    const selected = selectReadyTickets(
      [
        { id: 1, phase: "merged" },
        { id: 2, phase: "ready", dependsOn: [1], scope: ["src/a.ts"] },
        { id: 3, phase: "ready", scope: ["src/b.ts"] },
      ],
      2,
    );

    expect(selected.map((t) => t.id)).toEqual([2, 3]);
  });
});
