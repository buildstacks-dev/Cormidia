import { describe, expect, it } from "vitest";
import {
  EFFICIENCY_ERROR_CLASSES,
  EFFICIENCY_EVIDENCE_VERSION,
  clusterEfficiencyEvidence,
  projectEfficiencyEvidence,
} from "../../../src/org/learning/efficiency-evidence.js";
import { stickyEfficacyArm } from "../../../src/org/learning/efficacy.js";
import { learningEfficiencyHealthPath } from "../../../src/org/learning/efficiency-health.js";

const PROMOTED = [
  "H-CAP-01",
  "H-CAP-02",
  "H-CAP-03",
  "H-CLU-01",
  "H-CLU-02",
  "H-GOV-01",
  "H-EVAL-01",
  "H-EVAL-02",
  "H-EVAL-03",
  "H-RPT-01",
] as const;

describe("Workstream H promoted production surface", () => {
  it("binds all ten promoted contracts to the production closed-loop modules", () => {
    expect(PROMOTED).toHaveLength(10);
    expect(EFFICIENCY_EVIDENCE_VERSION).toBe("efficiency-evidence/v1");
    expect(EFFICIENCY_ERROR_CLASSES).toContain("scheduler.missed_tick");
    expect(typeof projectEfficiencyEvidence).toBe("function");
    expect(typeof clusterEfficiencyEvidence).toBe("function");
    expect(stickyEfficacyArm("episode-1", "exp-1")).toBe(stickyEfficacyArm("episode-1", "exp-1"));
    expect(learningEfficiencyHealthPath("/state")).toContain("efficiency-health.json");
  });
});
