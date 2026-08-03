// Trigger grammar and durable schedule state (architecture.md §2).

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";

export interface ScheduleState {
  [key: string]: string;
}

export function scheduleKey(app: string, role: string, trigger: string): string {
  return `${app}|${role}|${trigger}`;
}

export class ScheduleStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async read(): Promise<ScheduleState> {
    const path = this.path();
    if (!existsSync(path)) return {};
    return JSON.parse(await readFile(path, "utf8")) as ScheduleState;
  }

  async lastFired(app: string, role: string, trigger: string): Promise<Date | undefined> {
    const state = await this.read();
    const raw = state[scheduleKey(app, role, trigger)];
    return raw === undefined ? undefined : new Date(raw);
  }

  async recordFired(app: string, role: string, trigger: string, at: Date): Promise<void> {
    const path = this.path();
    const state = await this.read();
    state[scheduleKey(app, role, trigger)] = at.toISOString();
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
  }

  private path(): string {
    return join(this.root, "state", "schedule.json");
  }
}

export function isDue(spec: string, lastFired: Date | undefined, now: Date): boolean {
  if (lastFired === undefined) return true;
  return now.getTime() >= nextFireAfter(spec, lastFired).getTime();
}

/** Canonical identity of the most recent nominal firing slot. Host cadence
 * windows are deliberately not schedule windows: five reconciliation ticks
 * after one daily 07:00 slot must all name the same piece of work (#231). */
export function scheduleDueWindow(spec: string, now: Date): Date {
  const parsed = parseSchedule(spec);
  if (parsed.kind === "interval") {
    return new Date(Math.floor(now.getTime() / parsed.ms) * parsed.ms);
  }
  if (parsed.kind === "daily") {
    const slot = atLocalTime(now, parsed.hour, parsed.minute);
    if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
    return slot;
  }
  const slot = atLocalTime(now, parsed.hour, parsed.minute);
  const daysBack = (slot.getDay() - parsed.day + 7) % 7;
  slot.setDate(slot.getDate() - daysBack);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 7);
  return slot;
}

export function nextFireAfter(spec: string, lastFired: Date): Date {
  const parsed = parseSchedule(spec);
  if (parsed.kind === "interval") {
    return new Date(lastFired.getTime() + parsed.ms);
  }
  if (parsed.kind === "daily") {
    const next = atLocalTime(lastFired, parsed.hour, parsed.minute);
    if (next.getTime() <= lastFired.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  const next = atLocalTime(lastFired, parsed.hour, parsed.minute);
  const currentDow = next.getDay();
  const days = (parsed.day - currentDow + 7) % 7;
  next.setDate(next.getDate() + days);
  if (next.getTime() <= lastFired.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

export type ParsedSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number };

export function parseSchedule(spec: string): ParsedSchedule {
  const text = spec.trim().toLowerCase();
  if (text === "hourly") return { kind: "interval", ms: 60 * 60 * 1000 };

  const every = /^every\s+(\d+)\s*([hm])$/.exec(text);
  if (every !== null) {
    const count = Number(every[1]);
    const unit = every[2];
    return { kind: "interval", ms: count * (unit === "h" ? 60 * 60 * 1000 : 60 * 1000) };
  }

  const daily = /^daily\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (daily !== null) {
    return timeSpec("daily", Number(daily[1]), Number(daily[2]));
  }

  const weekly = /^weekly\s+([a-z]{3,9})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  if (weekly !== null) {
    const day = dayIndex(weekly[1]!);
    const hour = weekly[2] === undefined ? 9 : Number(weekly[2]);
    const minute = weekly[3] === undefined ? 0 : Number(weekly[3]);
    assertTime(hour, minute, spec);
    return { kind: "weekly", day, hour, minute };
  }

  throw new Error(`unsupported schedule trigger "${spec}"`);
}

function timeSpec(kind: "daily", hour: number, minute: number): ParsedSchedule {
  assertTime(hour, minute, `${kind} ${hour}:${minute}`);
  return { kind, hour, minute };
}

function assertTime(hour: number, minute: number, spec: string): void {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`invalid schedule time in "${spec}"`);
  }
}

function atLocalTime(date: Date, hour: number, minute: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function dayIndex(day: string): number {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const idx = days.findIndex((d) => day.startsWith(d));
  if (idx === -1) throw new Error(`invalid weekly schedule day "${day}"`);
  return idx;
}
