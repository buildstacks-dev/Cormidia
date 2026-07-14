import { definePublicSurfaceDebt } from "./harness.js";

const ids = ["B-ADM-01", "B-ADM-02", "B-ADM-03", "B-ADM-04", "B-ADM-05"];
const metrics = ["B-MET-01", "B-MET-02", "B-MET-03", "B-MET-04"];
const reports = ["B-RPT-01", "B-RPT-02"];

definePublicSurfaceDebt([
  ...ids.map((id) => ({ id, expectedFailure: "route_admission_absent", help: ["loop"], missingToken: "--route-record", nearMissToken: "--dry-run" })),
  ...metrics.map((id) => ({ id, expectedFailure: "efficiency_measurement_absent", help: ["report"], missingToken: "--execution-steps", nearMissToken: "--json" })),
  ...reports.map((id) => ({ id, expectedFailure: "efficiency_reporting_absent", help: ["report"], missingToken: "--efficiency", nearMissToken: "--summary-only" })),
]);
