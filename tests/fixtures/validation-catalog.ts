import type { ValidationCatalog } from "../../src/org/roadmap-delivery/validation-catalog.js";
import {
  RATIFIED_VALIDATION_BASE_AFFECTED,
  RATIFIED_VALIDATION_EMPTY_AFFECTED,
  ratifiedRoadmapValidationCatalog,
} from "../../src/org/ratified-validation-catalog.js";

export const VALIDATION_BASE_AFFECTED = RATIFIED_VALIDATION_BASE_AFFECTED;
export const VALIDATION_EMPTY_AFFECTED = RATIFIED_VALIDATION_EMPTY_AFFECTED;

export function validationCatalog(app: string): ValidationCatalog {
  return ratifiedRoadmapValidationCatalog(app);
}
