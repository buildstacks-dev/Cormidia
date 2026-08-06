/** Preserve Error messages while giving non-Error throws a deterministic rendering. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
