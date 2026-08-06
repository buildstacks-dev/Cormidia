import type { ReportBucketKind, ReportPreset, ReportQuery, ReportRangeV1 } from "./types.js";

const DAY_MS = 86_400_000;

export function normalizeReportRange(
  query: ReportQuery,
  now: Date = new Date(),
  earliestRetained?: string,
): ReportRangeV1 {
  assertValidDate(now, "report generation time");
  if (query.period !== undefined && (query.since !== undefined || query.until !== undefined)) {
    throw new Error("report: --period is mutually exclusive with --since/--until");
  }
  if (query.until !== undefined && query.since === undefined) {
    throw new Error("report: --until requires --since");
  }
  const today = utcDayStart(now);
  let preset: ReportPreset;
  let from: Date;
  let to: Date;
  if (query.since !== undefined) {
    preset = "custom";
    from = parseUtcDate(query.since, "--since");
    to = query.until === undefined ? new Date(now) : addUtcDays(parseUtcDate(query.until, "--until"), 1);
  } else {
    preset = query.period ?? "90d";
    to = addUtcDays(today, 1);
    if (preset === "all")
      from = earliestRetained === undefined ? today : parseUtcDate(earliestRetained.slice(0, 10), "retained date");
    else from = addUtcDays(today, -(presetDays(preset) - 1));
  }
  if (from.getTime() >= to.getTime()) throw new Error("report: range must end after it starts");
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  const bucket = query.bucket === undefined || query.bucket === "auto" ? automaticBucket(days) : query.bucket;
  return {
    preset,
    from_inclusive: from.toISOString(),
    to_exclusive: to.toISOString(),
    display_timezone: "UTC",
    bucket,
    open_interval: to.getTime() > now.getTime(),
  };
}

function parseUtcDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`report: ${label} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`report: ${label} is not a valid UTC calendar date`);
  }
  return date;
}

function automaticBucket(days: number): ReportBucketKind {
  if (!Number.isFinite(days) || days < 1) throw new Error("report: interval must contain at least one day");
  return days <= 45 ? "day" : days <= 180 ? "week" : "month";
}

export function bucketStart(date: Date, kind: ReportBucketKind): Date {
  const day = utcDayStart(date);
  if (kind === "day") return day;
  if (kind === "week") {
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    return addUtcDays(day, -mondayOffset);
  }
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export function nextBucket(date: Date, kind: ReportBucketKind): Date {
  if (kind === "day") return addUtcDays(date, 1);
  if (kind === "week") return addUtcDays(date, 7);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function presetDays(preset: Exclude<ReportPreset, "all" | "custom">): number {
  return preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
}

function assertValidDate(date: Date, label: string): void {
  if (!Number.isFinite(date.getTime())) throw new Error(`report: invalid ${label}`);
}
