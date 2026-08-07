import { RoadmapDeliveryError } from "./failure.js";

const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._*:/-]{0,255}$/;

export function assertStringList(values: unknown, label: string, allowEmpty = false): void {
  if (
    !Array.isArray(values) ||
    (!allowEmpty && values.length === 0) ||
    values.some((value) => typeof value !== "string" || value.trim().length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is missing, blank, or duplicated`);
  }
}

export function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is required`);
  }
}

export function assertMachineId(value: unknown, label: string): void {
  if (typeof value !== "string" || !MACHINE_ID.test(value)) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is invalid: ${value}`);
  }
}

export function requireDateTime(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is not a date-time`);
  }
  return value;
}
