// Token-free job admission — CF-J22-R / HB-145.

import {
  modelServedByCatalog,
  readRuntimeModelCatalog,
  type RuntimeModelCatalogReader,
} from "../runtime/model-catalog.js";
import { JobConfigError } from "./config.js";
import type { JobConfig, JobStepAssignment } from "./types.js";

/** An available roster is authority: an unserved assignment refuses before
 * runtime construction. An unavailable roster stays explicitly unverified
 * until turn start rather than being guessed at config time. */
export async function validateJobAssignments(
  config: JobConfig,
  readCatalog: RuntimeModelCatalogReader = readRuntimeModelCatalog,
): Promise<JobConfig> {
  const catalogs = new Map<JobStepAssignment["harness"], Awaited<ReturnType<RuntimeModelCatalogReader>>>();
  for (const step of config.steps) {
    if (step.kind !== "provider" || step.assignment === undefined) continue;
    let catalog = catalogs.get(step.assignment.harness);
    if (catalog === undefined) {
      catalog = await readCatalog(step.assignment.harness);
      catalogs.set(step.assignment.harness, catalog);
    }
    if (!modelServedByCatalog(catalog, step.assignment.model)) {
      throw new JobConfigError(
        "job_assignment_invalid",
        `job ${config.job} step ${step.id}: model ${JSON.stringify(step.assignment.model)} is not served by ` +
          `${step.assignment.harness} (${catalog.available ? catalog.source : catalog.reason})`,
      );
    }
  }
  return config;
}
