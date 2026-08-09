export interface TypedCliError extends Error {
  code: string;
  publicMessage: string;
  remediation: string;
}

export function isTypedCliError(error: unknown): error is TypedCliError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<TypedCliError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.publicMessage === "string" &&
    typeof candidate.remediation === "string"
  );
}
