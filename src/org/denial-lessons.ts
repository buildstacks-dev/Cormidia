// Durable denial lessons (approval-and-release-amendment A5). Eight of the
// episode's fourteen denials were the SAME denial — the human's thoughtful
// reason evaporated after each pass. A denial now persists as role memory
// under the org home, deduplicated, so the next brief carries the lesson
// instead of re-litigating it.

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DenialLesson {
  app: string;
  rule: string;
  reason: string;
  at: string; // ISO
}

export function denialLessonsPath(orgHome: string, role: string): string {
  return join(orgHome, "memory", "roles", role, "denial-lessons.md");
}

/** Append a lesson unless an entry with the same rule+reason already exists —
 *  repetition is exactly what this file exists to end. Returns true when a
 *  new lesson was recorded. */
export function appendDenialLesson(orgHome: string, role: string, lesson: DenialLesson): boolean {
  const path = denialLessonsPath(orgHome, role);
  const key = `[${lesson.rule}] ${lesson.reason.trim()}`;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(key)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const header = existing.length === 0 ? "# Denial lessons (orchestrator-curated)\n\n" : "";
  appendFileSync(
    path,
    `${header}- ${lesson.at} ${lesson.app} ${key}\n`,
    "utf8",
  );
  // Surface the file through the role's memory index so context assembly
  // picks it up (OKF memory reads the index).
  const indexPath = join(orgHome, "memory", "roles", role, "INDEX.md");
  const indexBody = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (!indexBody.includes("denial-lessons.md")) {
    appendFileSync(
      indexPath,
      `${indexBody.length > 0 && !indexBody.endsWith("\n") ? "\n" : ""}- denial-lessons.md — human denial reasons; do not re-attempt these\n`,
      "utf8",
    );
  }
  return true;
}
