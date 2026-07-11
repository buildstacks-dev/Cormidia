// Tests the telemetry CLI (Stage 2 read-only view over runs/).
// Covers ticket/trace grouping, --date filtering, cache-ratio and
// estimated-cost marking, escalation counting from events.jsonl, the --json
// shape, the self-contained --html report (including preview escaping), and
// unknown-flag rejection.
// Uses makeOrgHome to seed run records; no network, auth, real org state, or
// wall-clock time is required.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cmdTelemetry } from "../src/cli/telemetry.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

interface EnvOverrides {
  ticket?: string;
  trace?: string;
  pass?: string;
  status?: string;
  role?: string;
  model?: string;
  usage?: Record<string, unknown>;
  previews?: Record<string, string>;
  lastSeenAt?: string;
}

function env(runId: string, started: string, over: EnvOverrides = {}): unknown {
  return {
    schema_version: 1,
    run_id: runId,
    trace_id: over.trace ?? "turn-1",
    app: "alpha",
    ...(over.ticket !== undefined ? { ticket: over.ticket } : {}),
    pipeline: "build",
    pass: over.pass ?? "implement",
    role: over.role ?? "builder",
    model: over.model ?? "model-a",
    status: over.status ?? "completed",
    started_at: started,
    ...(over.lastSeenAt !== undefined ? { last_seen_at: over.lastSeenAt } : {}),
    finished_at: started,
    wall_clock_ms: 60000,
    usage: over.usage ?? { tokens_in: 100, tokens_out: 20, cost_usd: 0.1 },
    ...(over.previews !== undefined ? { previews: over.previews } : {}),
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
  };
}

async function run(args: string[]): Promise<{ code: number; out: string }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await cmdTelemetry(args);
    return { code, out: log.mock.calls.map((call) => call.join(" ")).join("\n") };
  } finally {
    log.mockRestore();
  }
}

/** Two tickets: #7 has two traces (implement then a review in a later turn),
 *  #8 has one estimated-cost pass with a cache hit and an escalation. */
function seededHome(): OrgHomeFixture {
  return makeOrgHome({
    runs: {
      records: {
        alpha: {
          run1: {
            envelope: env("run1", "2026-07-04T10:00:00Z", { ticket: "#7", trace: "turn-1", pass: "implement" }),
            events: [],
          },
          run2: {
            envelope: env("run2", "2026-07-04T11:00:00Z", { ticket: "#7", trace: "turn-2", pass: "review" }),
            events: [],
          },
          run3: {
            envelope: env("run3", "2026-07-05T09:00:00Z", {
              ticket: "#8",
              trace: "turn-3",
              role: "reviewer",
              model: "model-b",
              usage: { tokens_in: 200, tokens_out: 40, cost_usd: 0.5, cost_estimated: true, cache_read_tokens: 150 },
            }),
            events: [
              { event: "escalation.raised", severity: "warn" },
              { event: "pass.completed", severity: "info" },
              { event: "escalation.raised", severity: "warn" },
            ],
          },
        },
      },
    },
  });
}

describe("cmdTelemetry terminal view", () => {
  it("groups passes by ticket then trace in start order", async () => {
    const home = seededHome();
    try {
      const { code, out } = await run(["--home", home.root, "--app", "alpha"]);
      expect(code).toBe(0);
      // Ticket #7 (started earlier) precedes #8; within #7 the two traces
      // appear as separate blocks in start order.
      const t7 = out.indexOf("TICKET #7");
      const t8 = out.indexOf("TICKET #8");
      expect(t7).toBeGreaterThan(-1);
      expect(t8).toBeGreaterThan(t7);
      const turn1 = out.indexOf("trace turn-1");
      const turn2 = out.indexOf("trace turn-2");
      expect(turn1).toBeGreaterThan(t7);
      expect(turn2).toBeGreaterThan(turn1);
      expect(turn2).toBeLessThan(t8);
      expect(out).toContain("build/implement");
      expect(out).toContain("build/review");
    } finally {
      home.cleanup();
    }
  });

  it("--date keeps only passes whose started_at day matches", async () => {
    const home = seededHome();
    try {
      const { out } = await run(["--home", home.root, "--date", "2026-07-05"]);
      expect(out).toContain("TICKET #8");
      expect(out).not.toContain("TICKET #7");
      expect(out).toContain("1 pass(es)");
    } finally {
      home.cleanup();
    }
  });

  it("shows cache-hit ratio and marks estimated cost with ~", async () => {
    const home = seededHome();
    try {
      const { out } = await run(["--home", home.root]);
      // run3: cache_read 150 / tokens_in 200 = 75%, cost estimated.
      expect(out).toContain("cache 75%");
      expect(out).toContain("~$0.50");
      // run1 reported no cache tokens and a provider-reported cost.
      expect(out).toContain("cache —");
      expect(out).not.toContain("~$0.10");
    } finally {
      home.cleanup();
    }
  });

  it("counts escalation.raised lines from the run's events.jsonl", async () => {
    const home = seededHome();
    try {
      const { out } = await run(["--home", home.root]);
      const run3Line = out.split("\n").find((line) => line.includes("run3"));
      expect(run3Line).toContain("esc 2");
      // Totals attribute the escalations to role/model/ticket.
      expect(out).toMatch(/ticket #8 .* 2 esc/);
    } finally {
      home.cleanup();
    }
  });

  it("lists running envelopes with heartbeat-derived liveness (Stage 3)", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            live1: { envelope: env("live1", "2026-07-04T10:00:00Z", { ticket: "#9", status: "running" }), events: [] },
            live2: {
              envelope: env("live2", "2026-07-04T10:00:00Z", {
                ticket: "#9",
                status: "running",
                lastSeenAt: "2026-07-04T10:05:00Z",
              }),
              events: [],
            },
          },
        },
      },
    });
    try {
      const { out } = await run(["--home", home.root]);
      expect(out).toContain("STILL RUNNING");
      // No heartbeat recorded → unknown; an old heartbeat → stalled with the
      // last stamp. (A "live" pass needs a heartbeat within 3m of now — not
      // constructible from a fixed fixture date.)
      expect(out).toMatch(/live1.*unknown \(no heartbeat\)/);
      expect(out).toMatch(/live2.*stalled \(last heartbeat 2026-07-04T10:05:00Z\)/);
    } finally {
      home.cleanup();
    }
  });

  it("rejects an unknown flag", async () => {
    const home = makeOrgHome({ runs: true });
    try {
      await expect(run(["--home", home.root, "--bogus"])).rejects.toThrow('telemetry: unknown argument "--bogus"');
    } finally {
      home.cleanup();
    }
  });

  it("rejects a malformed --date", async () => {
    const home = makeOrgHome({ runs: true });
    try {
      await expect(run(["--home", home.root, "--date", "07/04"])).rejects.toThrow("--date must be YYYY-MM-DD");
    } finally {
      home.cleanup();
    }
  });
});

describe("cmdTelemetry --json", () => {
  it("emits stable snake_case fields for tickets, traces, passes, running, and totals", async () => {
    const home = seededHome();
    try {
      const { out } = await run(["--home", home.root, "--json"]);
      const data = JSON.parse(out) as {
        filters: { app: string | null; date: string | null };
        pass_count: number;
        tickets: {
          ticket: string | null;
          traces: { trace_id: string; passes: Record<string, unknown>[] }[];
        }[];
        running: unknown[];
        totals: { by_role: Record<string, unknown>[]; by_model: Record<string, unknown>[]; by_ticket: Record<string, unknown>[] };
      };
      expect(data.filters).toEqual({ app: null, date: null });
      expect(data.pass_count).toBe(3);
      expect(data.tickets.map((t) => t.ticket)).toEqual(["#7", "#8"]);
      expect(data.tickets[0]!.traces.map((t) => t.trace_id)).toEqual(["turn-1", "turn-2"]);
      expect(data.tickets[1]!.traces[0]!.passes[0]).toMatchObject({
        run_id: "run3",
        trace_id: "turn-3",
        pipeline: "build",
        pass: "implement",
        role: "reviewer",
        model: "model-b",
        status: "completed",
        wall_clock_ms: 60000,
        tokens_in: 200,
        tokens_out: 40,
        cache_read_tokens: 150,
        cache_hit_ratio: 0.75,
        cost_usd: 0.5,
        cost_estimated: true,
        escalations: 2,
      });
      expect(data.running).toEqual([]);
      expect(data.totals.by_role).toContainEqual({
        role: "reviewer",
        cost_usd: 0.5,
        cost_estimated: true,
        passes: 1,
        escalations: 2,
      });
      expect(data.totals.by_model.map((line) => line["model"])).toEqual(["model-a", "model-b"]);
      expect(data.totals.by_ticket).toContainEqual({
        ticket: "#7",
        cost_usd: expect.closeTo(0.2) as number,
        cost_estimated: false,
        passes: 2,
        escalations: 0,
      });
    } finally {
      home.cleanup();
    }
  });
});

describe("cmdTelemetry --html", () => {
  it("writes a self-contained report with pass ids and escapes preview markup", async () => {
    const home = makeOrgHome({
      runs: {
        records: {
          alpha: {
            run1: {
              envelope: env("run1", "2026-07-04T10:00:00Z", {
                ticket: "#7",
                previews: { output: '<script>alert("pwned")</script>' },
              }),
              events: [{ event: "escalation.raised", severity: "warn" }],
            },
            run2: { envelope: env("run2", "2026-07-04T11:00:00Z", { ticket: "#7", pass: "review" }), events: [] },
          },
        },
      },
    });
    try {
      const target = join(home.root, "telemetry.html");
      const { code, out } = await run(["--home", home.root, "--html", target]);
      expect(code).toBe(0);
      expect(out).toContain(target);

      const html = readFileSync(target, "utf8");
      expect(html).toContain("run1");
      expect(html).toContain("run2");
      expect(html).toContain("Ticket #7");
      expect(html).toContain("Cost attribution");
      // The preview's markup must arrive escaped — and since the report is
      // deliberately script-free, no <script element may exist at all.
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script");
      // Self-contained: no external fetches of any kind.
      expect(html).not.toMatch(/src=|href=|url\(|@import/);
    } finally {
      home.cleanup();
    }
  });
});
