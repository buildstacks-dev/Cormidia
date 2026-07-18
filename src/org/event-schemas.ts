// Company-lifecycle file-drop event schemas (M8.4).
//
// The dispatcher transports these through the generic alert-webhook inbox
// (state/events/inbox/*.json). This module validates the payload contract
// that Support, Marketing, SRE, and Planner-facing prompts consume.

export const COMPANY_EVENT_KINDS = [
  "support-feedback",
  "adoption-signal",
  "health-alert",
  "launch-calendar",
] as const;

export type CompanyEventKind = (typeof COMPANY_EVENT_KINDS)[number];

export type CompanyEventValidationCode =
  | "malformed_company_event"
  | "unknown_company_event_kind";

/** A stable machine classification for file-drop contract failures. The
 *  dispatcher prints this code verbatim, while the message retains the field
 *  detail an operator needs to repair the source file. */
export class CompanyEventValidationError extends Error {
  readonly code: CompanyEventValidationCode;

  constructor(code: CompanyEventValidationCode, message: string) {
    super(message);
    this.name = "CompanyEventValidationError";
    this.code = code;
  }
}

export interface BaseCompanyEvent {
  kind: CompanyEventKind;
  id: string;
  app: string;
  occurredAt: string;
  source: string;
}

export interface SupportFeedbackEvent extends BaseCompanyEvent {
  kind: "support-feedback";
  severity: "low" | "medium" | "high";
  channel: string;
  summary: string;
  excerpt?: string;
  userRef?: string;
}

export interface AdoptionSignalEvent extends BaseCompanyEvent {
  kind: "adoption-signal";
  metric: string;
  direction: "up" | "down" | "flat";
  value?: number;
  summary: string;
}

export interface HealthAlertEvent extends BaseCompanyEvent {
  kind: "health-alert";
  severity: "low" | "medium" | "high" | "critical";
  service: string;
  status: "healthy" | "degraded" | "down";
  summary: string;
}

export interface LaunchCalendarEvent extends BaseCompanyEvent {
  kind: "launch-calendar";
  date: string;
  milestone: string;
  summary: string;
}

export type CompanyLifecycleEvent =
  | SupportFeedbackEvent
  | AdoptionSignalEvent
  | HealthAlertEvent
  | LaunchCalendarEvent;

export function parseCompanyLifecycleEvent(raw: unknown): CompanyLifecycleEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw malformed("company event must be a JSON object");
  }
  const spec = raw as Record<string, unknown>;
  const kind = requireString(spec, "kind");
  // Validate the shared envelope before classifying its kind. This gives an
  // incomplete `{kind: "future-kind"}` payload one deterministic answer —
  // malformed envelope — while a complete envelope with that same kind is an
  // unknown kind. Kind-specific fields follow after registry admission.
  const common = {
    id: requireString(spec, "id"),
    app: requireString(spec, "app"),
    occurredAt: requireIsoString(spec, "occurred_at"),
    source: requireString(spec, "source"),
  };
  if (!isCompanyEventKind(kind)) {
    throw new CompanyEventValidationError(
      "unknown_company_event_kind",
      `unknown company event kind "${kind}" (expected ${COMPANY_EVENT_KINDS.join(" | ")})`,
    );
  }

  const base = {
    kind,
    ...common,
  };

  switch (kind) {
    case "support-feedback":
      return {
        ...base,
        kind,
        severity: requireEnum(spec, "severity", ["low", "medium", "high"] as const),
        channel: requireString(spec, "channel"),
        summary: requireString(spec, "summary"),
        ...(typeof spec["excerpt"] === "string" ? { excerpt: spec["excerpt"] } : {}),
        ...(typeof spec["user_ref"] === "string" ? { userRef: spec["user_ref"] } : {}),
      };
    case "adoption-signal":
      return {
        ...base,
        kind,
        metric: requireString(spec, "metric"),
        direction: requireEnum(spec, "direction", ["up", "down", "flat"] as const),
        ...(typeof spec["value"] === "number" && Number.isFinite(spec["value"])
          ? { value: spec["value"] }
          : {}),
        summary: requireString(spec, "summary"),
      };
    case "health-alert":
      return {
        ...base,
        kind,
        severity: requireEnum(spec, "severity", ["low", "medium", "high", "critical"] as const),
        service: requireString(spec, "service"),
        status: requireEnum(spec, "status", ["healthy", "degraded", "down"] as const),
        summary: requireString(spec, "summary"),
      };
    case "launch-calendar":
      return {
        ...base,
        kind,
        date: requireIsoDate(spec, "date"),
        milestone: requireString(spec, "milestone"),
        summary: requireString(spec, "summary"),
      };
  }
}

export function isCompanyEventKind(value: string): value is CompanyEventKind {
  return (COMPANY_EVENT_KINDS as readonly string[]).includes(value);
}

function requireString(spec: Record<string, unknown>, key: string): string {
  const value = spec[key];
  if (typeof value !== "string" || value.length === 0) {
    throw malformed(`company event missing non-empty string "${key}"`);
  }
  return value;
}

function requireIsoString(spec: Record<string, unknown>, key: string): string {
  const value = requireString(spec, key);
  if (Number.isNaN(Date.parse(value))) {
    throw malformed(`company event "${key}" must be an ISO timestamp`);
  }
  return value;
}

function requireIsoDate(spec: Record<string, unknown>, key: string): string {
  const value = requireString(spec, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw malformed(`company event "${key}" must be YYYY-MM-DD`);
  }
  return value;
}

function requireEnum<T extends readonly string[]>(
  spec: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] {
  const value = requireString(spec, key);
  if (!allowed.includes(value)) {
    throw malformed(`company event "${key}" must be one of ${allowed.join(" | ")}`);
  }
  return value;
}

function malformed(message: string): CompanyEventValidationError {
  return new CompanyEventValidationError("malformed_company_event", message);
}
