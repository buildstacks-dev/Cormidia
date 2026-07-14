import { definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt(
  ["F-CONT-01", "F-CONT-02", "F-CONT-03", "F-CONT-04", "F-SET-01", "F-SET-02", "F-SET-03", "F-SET-04", "F-BOUND-01"].map((id) => ({
    id,
    expectedFailure: "continuation_journal_absent",
    help: ["loop"],
    missingToken: "--resume-episode",
    nearMissToken: "--once",
  })),
);
