// Deterministic Clock double (build plan M0.3).
//
// Several later subsystems key off wall-clock time in ways that would make
// real-time tests slow or flaky: dispatcher schedule triggers ("due when
// now >= next(lastFired, spec)", docs/architecture.md §2), approval-grant
// TTLs (24h expiry, §4), and telemetry's day-bucketed JSONL files. FakeClock
// gives those tests a `now()` that only moves when the test says so.

/** The minimal time source production code should depend on, so tests can
 * substitute FakeClock without touching `Date.now()` globally. */
export interface Clock {
  now(): Date;
}

/**
 * A `Clock` whose `now()` never moves on its own. Starts at `start` (default:
 * the Unix epoch, for a fixed, readable timestamp when a test doesn't care
 * which one) and only advances when `advance()` or `set()` is called —
 * deterministic by construction, never backwards via `advance()`.
 */
export class FakeClock implements Clock {
  private millis: number;

  constructor(start: Date | number | string = 0) {
    this.millis = toMillis(start);
  }

  now(): Date {
    return new Date(this.millis);
  }

  /** Move the clock forward by `ms` milliseconds. Negative or non-finite
   * values throw — a clock that silently went backwards would make
   * "advance" a lie to whoever reads the test. */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`FakeClock.advance: ms must be a non-negative finite number, got ${ms}`);
    }
    this.millis += ms;
  }

  /** Jump directly to an absolute time — for tests asserting behavior at a
   * specific moment (e.g. a schedule boundary) rather than a relative hop. */
  set(time: Date | number | string): void {
    this.millis = toMillis(time);
  }
}

function toMillis(time: Date | number | string): number {
  const ms = time instanceof Date ? time.getTime() : new Date(time).getTime();
  if (Number.isNaN(ms)) throw new Error(`FakeClock: invalid time value: ${String(time)}`);
  return ms;
}
