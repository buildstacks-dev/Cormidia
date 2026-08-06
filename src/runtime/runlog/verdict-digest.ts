// Durable verdict projection belongs with the runlog record it reads. Keeping
// this pure presentation helper in runtime lets loop and presentation leaves
// consume it without reversing the org -> loop -> runtime dependency flow.

/** One reviewer/builder judgment, projected for a human surface. */
export interface DurableVerdictDigest {
  kind: "review" | "build" | "contract";
  /** One line: the conclusion, with its load-bearing counts. */
  headline: string;
  /** Why, when the verdict carries a rationale. */
  rationale?: string;
  /** `claim => evidence` pairs, in the order the reviewer gave them. */
  evidence: string[];
  /** Scope the reviewer deliberately excluded. `[]` explicitly means none. */
  notReviewed: string[];
  /** Findings / resolutions / criteria, one compact line each. */
  details: string[];
}

/**
 * Project a durable verdict record — `envelope.verdict_summary` or a run's
 * `output.md` — into human-readable lines. Returns undefined for anything that
 * is not a structured verdict, so callers keep their existing prose fallback.
 *
 * Pure and total: it never throws, never reads state, and never re-validates.
 * A durable record predates the current schema by design, so this reads
 * defensively rather than asserting a shape.
 */
export function summarizeDurableVerdict(text: string): DurableVerdictDigest | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record["verdict"] === "string" && Array.isArray(record["findings"])) {
    return reviewDigest(record);
  }
  if (record["status"] === "done" || record["status"] === "blocked") return buildDigest(record);
  if (Array.isArray(record["files"]) && typeof record["approach"] === "string") {
    return contractDigest(record);
  }
  return undefined;
}

/** The digest as plain lines, for a text surface that has no structure. */
export function formatDurableVerdictDigest(digest: DurableVerdictDigest): string {
  return [
    digest.headline,
    ...(digest.rationale === undefined ? [] : [`rationale: ${digest.rationale}`]),
    ...(digest.evidence.length === 0 ? [] : [`evidence: ${digest.evidence.join("; ")}`]),
    ...(digest.details.length === 0 ? [] : [`detail: ${digest.details.join("; ")}`]),
    ...(digest.notReviewed.length === 0 ? [] : [`not reviewed: ${digest.notReviewed.join("; ")}`]),
  ].join("\n");
}

function reviewDigest(record: Record<string, unknown>): DurableVerdictDigest {
  const findings = (record["findings"] as unknown[]).filter(isRecord);
  const audit = isRecord(record["review"]) ? record["review"] : undefined;
  const evidence = (Array.isArray(audit?.["evidence"]) ? audit["evidence"] : [])
    .filter(isRecord)
    .map((entry) => `${text(entry["claim"])} => ${text(entry["evidence"])}`)
    .filter((entry) => entry !== " => ");
  const notReviewed = (Array.isArray(audit?.["notReviewed"]) ? audit["notReviewed"] : []).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  const rationale =
    typeof audit?.["rationale"] === "string" && audit["rationale"].trim().length > 0
      ? audit["rationale"].trim()
      : undefined;
  return {
    kind: "review",
    headline:
      `review ${text(record["verdict"])} — ${findings.length} finding(s), ` +
      `${evidence.length} evidence item(s), ${notReviewed.length} area(s) not reviewed`,
    ...(rationale === undefined ? {} : { rationale }),
    evidence,
    notReviewed,
    details: findings.map(
      (finding) =>
        `${text(finding["category"])}/${text(finding["severity"])} ${text(finding["location"])}: ` +
        `${text(finding["description"])}`,
    ),
  };
}

function buildDigest(record: Record<string, unknown>): DurableVerdictDigest {
  const resolutions = (Array.isArray(record["resolutions"]) ? record["resolutions"] : [])
    .filter(isRecord)
    .map((entry) => `${text(entry["outcome"])} ${text(entry["location"])} -- ${text(entry["note"])}`);
  const blocked = isRecord(record["blockedEntry"]) ? record["blockedEntry"] : undefined;
  return {
    kind: "build",
    headline: `build ${text(record["status"])} — ${resolutions.length} resolution(s)`,
    ...(blocked === undefined ? {} : { rationale: text(blocked["assessment"]) }),
    evidence: blocked === undefined ? [] : [`error => ${text(blocked["error"])}`],
    notReviewed: [],
    details: resolutions,
  };
}

function contractDigest(record: Record<string, unknown>): DurableVerdictDigest {
  const files = (record["files"] as unknown[]).filter((entry): entry is string => typeof entry === "string");
  const tests = (Array.isArray(record["tests"]) ? record["tests"] : []).filter(isRecord);
  return {
    kind: "contract",
    headline:
      `contract — ${files.length} file(s), ${tests.length} criterion mapping(s), ` +
      `complexity ${text(record["complexity"])}`,
    ...(typeof record["approach"] === "string" ? { rationale: record["approach"].trim() } : {}),
    evidence: tests.map(
      (entry) =>
        `${text(entry["criterionId"])} => ${(Array.isArray(entry["tests"]) ? entry["tests"] : [])
          .filter((name): name is string => typeof name === "string")
          .join(", ")}`,
    ),
    notReviewed: [],
    details: files,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
