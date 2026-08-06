import type { AppsFile } from "../org/apps.js";
import { buildReport } from "./project.js";
import { renderReportHtml } from "./render-html.js";
import type { ReportQuery, ReportSessionDetailV1, ReportSnapshotV1 } from "./types.js";

interface ReportServiceOptions {
  orgName: string;
  stateHome: string;
  appsFile: AppsFile;
  appScope?: string;
  clock?: () => Date;
  cacheEntries?: number;
  maxPageSize?: number;
}

interface ReportSessionPage {
  source_fingerprint: string;
  total: number;
  returned: number;
  next_cursor: string | null;
  items: ReportSessionDetailV1[];
}

export class ReportService {
  private readonly cache = new Map<string, ReportSnapshotV1>();
  private readonly clock: () => Date;
  private readonly cacheEntries: number;
  readonly maxPageSize: number;
  private builds = 0;

  constructor(private readonly options: ReportServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.cacheEntries = options.cacheEntries ?? 8;
    this.maxPageSize = options.maxPageSize ?? 100;
  }

  async report(query: ReportQuery, refresh = false): Promise<ReportSnapshotV1> {
    const normalized = this.enforceScope(query);
    const key = queryKey(normalized);
    const cached = this.cache.get(key);
    if (!refresh && cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    let report: ReportSnapshotV1;
    try {
      this.builds += 1;
      report = await buildReport({
        orgName: this.options.orgName,
        stateHome: this.options.stateHome,
        appsFile: this.options.appsFile,
        query: normalized,
        now: this.clock(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("report:"))
        throw new ReportServiceError(400, error.message);
      throw error;
    }
    this.cache.set(key, report);
    while (this.cache.size > this.cacheEntries) this.cache.delete(this.cache.keys().next().value!);
    return report;
  }

  async summary(query: ReportQuery, refresh = false): Promise<ReportSnapshotV1> {
    const report = await this.report({ ...query, summaryOnly: false }, refresh);
    const cap = 500;
    const truncated =
      Object.values(report.breakdowns).some((rows) => rows.length > cap) || report.quality.diagnostics.length > cap;
    return {
      ...report,
      summary_only: true,
      quality: {
        ...report.quality,
        diagnostics: report.quality.diagnostics.slice(0, cap),
        notices: truncated
          ? [
              ...report.quality.notices,
              "Served summary diagnostics/breakdowns are bounded; JSON/HTML export remains exhaustive.",
            ]
          : report.quality.notices,
      },
      breakdowns: {
        by_app: report.breakdowns.by_app.slice(0, cap),
        by_role: report.breakdowns.by_role.slice(0, cap),
        by_runtime_model: report.breakdowns.by_runtime_model.slice(0, cap),
        by_pipeline_pass: report.breakdowns.by_pipeline_pass.slice(0, cap),
        by_trigger: report.breakdowns.by_trigger.slice(0, cap),
        by_status: report.breakdowns.by_status.slice(0, cap),
        by_usage_quality: report.breakdowns.by_usage_quality.slice(0, cap),
      },
      sessions: { ...report.sessions, returned: 0, items: [] },
      session_details: [],
      unattributed_turns: [],
    };
  }

  async sessions(
    query: ReportQuery,
    options: {
      cursor?: string;
      limit?: number;
      refresh?: boolean;
      filter?: string;
      sort?: "newest" | "oldest" | "cost" | "tokens" | "status" | "app";
    } = {},
  ): Promise<ReportSessionPage> {
    const report = await this.report(
      { ...query, summaryOnly: false },
      options.refresh === true || options.cursor !== undefined,
    );
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.maxPageSize)
      throw new ReportServiceError(400, "invalid_limit");
    const sort = options.sort ?? "newest";
    const filter = (options.filter ?? "").trim().toLowerCase();
    if (!["newest", "oldest", "cost", "tokens", "status", "app"].includes(sort))
      throw new ReportServiceError(400, "invalid_sort");
    const key = `${queryKey(this.enforceScope({ ...query, summaryOnly: false }))}\0${sort}\0${filter}`;
    let offset = 0;
    if (options.cursor !== undefined) {
      const cursor = decodeCursor(options.cursor);
      if (cursor === undefined || cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)
        throw new ReportServiceError(400, "invalid_cursor");
      if (cursor.fingerprint !== report.source_fingerprint) throw new ReportServiceError(409, "report_resync_required");
      offset = cursor.offset;
    }
    const selected = report.session_details
      .filter((session) => filter.length === 0 || sessionSearchText(session).includes(filter))
      .sort((a, b) => sessionOrder(a, b, sort));
    const items = selected.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      source_fingerprint: report.source_fingerprint,
      total: selected.length,
      returned: items.length,
      next_cursor:
        nextOffset < selected.length
          ? encodeCursor({ offset: nextOffset, fingerprint: report.source_fingerprint, key })
          : null,
      items,
    };
  }

  async session(query: ReportQuery, id: string): Promise<ReportSessionDetailV1> {
    const report = await this.report({ ...query, summaryOnly: false });
    const item = report.session_details.find((session) => session.summary.id === id);
    if (item === undefined) throw new ReportServiceError(404, "session_not_found");
    return item;
  }

  async exportJson(query: ReportQuery): Promise<string> {
    return `${JSON.stringify(await this.report(query, true), null, 2)}\n`;
  }
  async exportHtml(query: ReportQuery): Promise<string> {
    return renderReportHtml(await this.report(query, true));
  }

  /** In-memory diagnostic only; proves observer startup remains report-lazy. */
  projectionCount(): number {
    return this.builds;
  }
  cacheSize(): number {
    return this.cache.size;
  }
  immutableAppScope(): string | null {
    return this.options.appScope ?? null;
  }

  private enforceScope(query: ReportQuery): ReportQuery {
    if (query.app !== undefined && !this.options.appsFile.apps.some((app) => app.name === query.app))
      throw new ReportServiceError(400, "unknown_report_app");
    if (this.options.appScope === undefined) return query;
    if (query.app !== undefined && query.app !== this.options.appScope)
      throw new ReportServiceError(403, "report_scope_forbidden");
    return { ...query, app: this.options.appScope };
  }
}

export class ReportServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function queryKey(query: ReportQuery): string {
  return JSON.stringify({
    app: query.app ?? null,
    period: query.period ?? null,
    since: query.since ?? null,
    until: query.until ?? null,
    bucket: query.bucket ?? "auto",
    summaryOnly: query.summaryOnly === true,
  });
}

function encodeCursor(value: { offset: number; fingerprint: string; key: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decodeCursor(value: string): { offset: number; fingerprint: string; key: string } | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof parsed["offset"] !== "number" ||
      typeof parsed["fingerprint"] !== "string" ||
      typeof parsed["key"] !== "string"
    )
      return undefined;
    return parsed as { offset: number; fingerprint: string; key: string };
  } catch {
    return undefined;
  }
}

function sessionSearchText(session: ReportSessionDetailV1): string {
  return [
    session.summary.id,
    session.summary.label,
    session.summary.objective_preview ?? "",
    ...session.summary.apps,
    session.summary.outcome,
    session.summary.usage_quality,
    ...session.activities.flatMap((turn) => [
      turn.role,
      turn.runtime ?? "",
      turn.model ?? "",
      turn.pipeline ?? "",
      turn.pass ?? "",
      turn.trigger ?? "",
      turn.status,
      ...turn.refs.map((ref) => ref.ref),
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function sessionOrder(a: ReportSessionDetailV1, b: ReportSessionDetailV1, sort: string): number {
  if (sort === "oldest")
    return (
      (a.summary.started_at ?? "").localeCompare(b.summary.started_at ?? "") || a.summary.id.localeCompare(b.summary.id)
    );
  if (sort === "cost")
    return (
      b.summary.recorded_equivalent_cost_usd - a.summary.recorded_equivalent_cost_usd ||
      a.summary.id.localeCompare(b.summary.id)
    );
  if (sort === "tokens")
    return (
      b.summary.known_input_tokens +
        b.summary.known_output_tokens -
        (a.summary.known_input_tokens + a.summary.known_output_tokens) || a.summary.id.localeCompare(b.summary.id)
    );
  if (sort === "status")
    return a.summary.outcome.localeCompare(b.summary.outcome) || a.summary.id.localeCompare(b.summary.id);
  if (sort === "app")
    return (a.summary.apps[0] ?? "").localeCompare(b.summary.apps[0] ?? "") || a.summary.id.localeCompare(b.summary.id);
  return (
    (b.summary.ended_at ?? b.summary.started_at ?? "").localeCompare(
      a.summary.ended_at ?? a.summary.started_at ?? "",
    ) || a.summary.id.localeCompare(b.summary.id)
  );
}
