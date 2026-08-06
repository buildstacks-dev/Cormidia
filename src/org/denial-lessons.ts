// Durable denial lessons (docs/approvals/design.md A5). Eight of the
// episode's fourteen denials were the SAME denial — the human's thoughtful
// reason evaporated after each pass. A denial now persists as role memory
// under the org home, deduplicated, so the next brief carries the lesson
// instead of re-litigating it.
//
// The lessons file is written through the OKF serializer so it always passes
// the OKF memory loader (src/org/memory.ts). The original writer emitted
// plain markdown with no YAML frontmatter, which the loader rejected as
// "malformed" on every turn — the orchestrator's own denial lessons were
// recorded but never re-injected (review L-009). Serializing through
// serializeOkfDocument runs the loader's validator at write time, so the
// writer can no longer produce a doc its own reader discards.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  OkfParseError,
  OkfValidationError,
  parseOkfDocument,
  serializeOkfDocument,
  type OkfDocument,
} from "./memory.js";

interface DenialLesson {
  app: string;
  rule: string;
  reason: string;
  at: string; // ISO
}

interface DenialLessonRecord extends DenialLesson {
  schema_version: 1;
  role: string;
}

function denialLessonsPath(orgHome: string, role: string): string {
  return join(orgHome, "memory", "roles", role, "denial-lessons.md");
}

function denialLessonsLedgerPath(orgHome: string, role: string): string {
  return join(orgHome, "memory", "roles", role, "denial-lessons.jsonl");
}

const LESSONS_DOC_NAME = "denial-lessons";
const LESSONS_DESCRIPTION = "human denial reasons; do not re-attempt these";
const LESSONS_HEADER = "# Denial lessons (orchestrator-curated)";

/** Append a lesson unless an entry with the same rule+reason already exists —
 *  repetition is exactly what this file exists to end. Returns true when a
 *  new lesson was recorded. */
export function appendDenialLesson(orgHome: string, role: string, lesson: DenialLesson): boolean {
  const path = denialLessonsPath(orgHome, role);
  if (role.trim() === "" || lesson.app.trim() === "" || lesson.rule.trim() === "" || lesson.reason.trim() === "") {
    throw new Error("denial lesson requires role, app, rule, and reason");
  }
  if (!Number.isFinite(new Date(lesson.at).getTime())) throw new Error("denial lesson requires an ISO timestamp");
  const key = `${lesson.app} [${lesson.rule}] ${lesson.reason.trim()}`;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(key)) return false;
  mkdirSync(dirname(path), { recursive: true });
  const record: DenialLessonRecord = {
    schema_version: 1,
    role,
    app: lesson.app,
    rule: lesson.rule,
    reason: lesson.reason.trim(),
    at: lesson.at,
  };
  appendFileSync(denialLessonsLedgerPath(orgHome, role), `${JSON.stringify(record)}\n`, "utf8");
  const doc = lessonsDocFor(existing, lesson, path);
  const bodyBase = doc.body.trim() === "" ? `${LESSONS_HEADER}\n` : doc.body.trimEnd();
  doc.body = `${bodyBase}\n- ${lesson.at} ${key}\n`;
  writeFileSync(path, serializeOkfDocument(doc), "utf8");
  // Surface the file through the role's memory index so context assembly
  // picks it up (OKF memory reads the index).
  const indexPath = join(orgHome, "memory", "roles", role, "INDEX.md");
  const indexBody = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (!indexBody.includes("denial-lessons.md")) {
    appendFileSync(
      indexPath,
      `${indexBody.length > 0 && !indexBody.endsWith("\n") ? "\n" : ""}- denial-lessons.md — ${LESSONS_DESCRIPTION}\n`,
      "utf8",
    );
  }
  return true;
}

/** The OKF document the new lesson lands in: the existing doc when it parses,
 *  a migration of a legacy frontmatter-less file (its bullets become the
 *  body — recorded lessons are never dropped), or a fresh doc. Keywords
 *  accumulate the app and rule so the selector's keyword overlap can surface
 *  the lessons for the work they apply to. */
function lessonsDocFor(existing: string, lesson: DenialLesson, source: string): OkfDocument {
  const date = new Date(lesson.at).toISOString().slice(0, 10);
  let parsed: OkfDocument | undefined;
  if (existing.trim() !== "") {
    try {
      parsed = parseOkfDocument(existing, source);
    } catch (error) {
      if (!(error instanceof OkfParseError) && !(error instanceof OkfValidationError)) throw error;
      // Legacy pre-L-009 file (or an agent-mangled one): keep its content as
      // the body and wrap it in valid frontmatter.
      parsed = undefined;
    }
  }
  const base = parsed?.frontmatter;
  return {
    frontmatter: {
      name: base?.name ?? LESSONS_DOC_NAME,
      description: base?.description ?? LESSONS_DESCRIPTION,
      type: base?.type ?? "lesson",
      keywords: mergeUnique(base?.keywords ?? [], [lesson.app, lesson.rule]),
      evidence: mergeUnique(base?.evidence ?? [], ["denial-lessons.jsonl"]),
      status: base?.status ?? "active",
      created: base?.created ?? date,
      updated: date,
      ...(base?.loop !== undefined ? { loop: base.loop } : {}),
    },
    body: parsed?.body ?? (existing.trim() === "" ? "" : existing),
  };
}

function mergeUnique(existing: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...existing, ...additions])];
}
