import { definePublicSurfaceDebt } from "./harness.js";

definePublicSurfaceDebt([
  { id: "C-LIFE-01", expectedFailure: "lifecycle_command_absent", help: ["org"], missingToken: "org upgrade", nearMissToken: "org init" },
  { id: "C-LIFE-02", expectedFailure: "lifecycle_command_absent", help: ["org"], missingToken: "org upgrade", nearMissToken: "org use" },
  { id: "C-LIFE-03", expectedFailure: "lifecycle_command_absent", help: ["app"], missingToken: "app verify", nearMissToken: "app reset" },
  { id: "C-LIFE-04", expectedFailure: "lifecycle_command_absent", help: ["app"], missingToken: "app promote", nearMissToken: "app reset" },
]);
