// Typed pass verdicts + lenient parsers + reformat retry (build plan M4.6;
// docs/loop.md §6, §10).
//
// Every pass has a typed verdict the orchestrator acts on — no side effect
// ever keys off prose (§6). Three kinds:
//   contract — the contract pass's structured issue comment
//   build    — implement/fix passes: done | blocked (+ blocked entry)
//   review   — verify / security-deep / perf-scale / ship-check passes:
//              approve | findings, with the §6 finding line grammar
//
// Port notes (predecessor `orchestrator/state.py`):
// - Finding grammar: `- category/severity file:line -- description -> action`,
//   unicode (—/→) or ASCII (--/->) delimiters, category/severity
//   case-normalized (FINDING_PATTERN, kept verbatim in spirit).
// - Status leniency: the predecessor's three formats — `## Status\ndone`
//   (value on the next line, blank lines tolerated), `## Status: done`
//   (inline), `**Status:** done` (bold) — plus one addition: a bare
//   `Status: done` / `Verdict: approve` line, because our ratified templates
//   phrase the output exactly that way ("Verdict: `approve`"). Backticks
//   around the value are tolerated for the same reason.
// - Deviation from the predecessor (loop.md §1 drops silent best-effort):
//   near-miss finding lines are a LOUD typed failure, not a silent drop. A
//   line that looks like a finding attempt (known severity after a slash, or
//   both grammar delimiters present) but fails the grammar or uses an unknown
//   category/severity fails the parse with a reason the reformat retry can
//   act on. A dropped finding is unreviewed risk; a retry is cheap.
//
// **`perf` finding category — decided NO (settles M2.2's deferred question).**
// The ratified perf-scale template (prompts/review/perf.md: "Performance
// defects are design defects") files performance findings under
// `architecture` — or `testing` when the gap is a missing load-shape test —
// and loop.md §6's sketch lists exactly five categories. The parser rejects
// `perf/…` lines with guidance pointing the reformat retry at the right
// category.
//
// The exported JSON-schema shapes (VERDICT_SCHEMAS) are the same contract for
// the native-structured-output path: loop passes put them on
// `TurnRequest.verdictSchema` (M1.4) and validate the returned JSON with
// `validateVerdict` — one vocabulary for both transports. That reconciliation
// is verified live in M6.2, not assumed here.

// ---------------------------------------------------------------------------
// Verdict types — docs/loop.md §6 sketch
// ---------------------------------------------------------------------------

export const FINDING_CATEGORIES = [
  "architecture",
  "testing",
  "security",
  "style",
  "scope",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_SEVERITIES = ["critical", "major", "minor"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface Finding {
  category: FindingCategory;
  severity: FindingSeverity;
  /** `file:line` (or file) — captured verbatim. */
  location: string;
  description: string;
  action: string;
}

export const CONTRACT_COMPLEXITIES = ["low", "medium", "high"] as const;
/** The contract pass's complexity estimate — NOT policy.ts's RiskTier (that
 *  axis is resolved from changed-file globs, §4). */
export type Complexity = (typeof CONTRACT_COMPLEXITIES)[number];

export interface ContractCriterionTests {
  criterionId: string;
  tests: string[];
}

export interface ContractVerdict {
  files: string[];
  approach: string;
  tests: ContractCriterionTests[];
  risks: string;
  complexity: Complexity;
}

/** The §7 blocked protocol's structured comment: error verbatim, attempted
 *  fix, result, assessment — what the Planner's groom pipeline consumes. */
export interface BlockedEntry {
  error: string;
  attempted: string;
  result: string;
  assessment: string;
}

export const FINDING_RESOLUTION_OUTCOMES = ["fixed", "rebutted"] as const;
export type FindingResolutionOutcome = (typeof FINDING_RESOLUTION_OUTCOMES)[number];

/** A fix pass's per-finding disposition (proportionality-review Stage 2 —
 *  findings stay open until individually fixed or rebutted, durably). */
export interface FindingResolution {
  outcome: FindingResolutionOutcome;
  /** The finding's `file:line` location, verbatim from the finding line. */
  location: string;
  /** Evidence: the proving commit/test for fixed, the reason for rebutted. */
  note: string;
}

export interface BuildVerdict {
  status: "done" | "blocked";
  /** Present when the pass reported blocked with the full four-part entry.
   *  A partial entry is a parse failure; a blocked verdict with no entry at
   *  all parses (the type allows it) — demanding evidence is caller policy. */
  blockedEntry?: BlockedEntry;
  /** Fix passes: one line per finding, `- fixed <location> -- <evidence>` or
   *  `- rebutted <location> -- <reason>`. Optional — build passes and legacy
   *  outputs parse unchanged. */
  resolutions?: FindingResolution[];
}

export interface ReviewVerdict {
  verdict: "approve" | "findings";
  findings: Finding[];
  /** Auditable judgment retained with the typed verdict and rendered into the
   * orchestrator-owned GitHub review. An empty findings list is not evidence
   * by itself. */
  review: {
    rationale: string;
    evidence: {
      claim: string;
      evidence: string;
    }[];
    /** Deliberately excluded scope. An empty list explicitly means none. */
    notReviewed: string[];
  };
}

/** M6 distiller output. The org layer supplies evidence and owns ids/hashes;
 * the model only proposes the governed candidate payload. */
export interface DistillationProposal {
  cluster_fingerprint: string;
  destination:
    | "okf_concept"
    | "skill_draft"
    | "protocol_proposal"
    | "eval_or_gate_proposal"
    | "ticket"
    | "reject";
  title: string;
  proposed_scope: string;
  proposed_tier: "T0" | "T1" | "T2" | "T3";
  claims_efficacy: boolean;
  draft_summary: string;
  draft_body: string;
  acceptance: string[];
  topic_key: string;
}

export interface DistillationVerdict {
  candidates: DistillationProposal[];
}

/** M6 learning-reviewer output before orchestrator-owned provenance fields
 * are stamped and persisted through the review store. */
export interface LearningReviewProposal {
  candidate_id: string;
  verdict: "approve" | "revise" | "reject" | "escalate";
  proposed_destination: DistillationProposal["destination"];
  proposed_tier: DistillationProposal["proposed_tier"];
  proposed_scope: string;
  experiment_required: boolean;
  rubric: {
    correctness: number;
    generality: number;
    scope_fit: number;
    destination_fit: number;
    provenance_trust: number;
    injection_screen: "clean" | "suspicious" | "flagged";
  };
  conflicts_with: string[];
  duplicates: string[];
  eval_required: boolean;
  eval_present: boolean;
  rationale: string;
}

export interface LearningReviewVerdict {
  reviews: LearningReviewProposal[];
}

export interface VerdictTypes {
  contract: ContractVerdict;
  build: BuildVerdict;
  review: ReviewVerdict;
  "learning-distill": DistillationVerdict;
  "learning-review": LearningReviewVerdict;
}
export type VerdictKind = keyof VerdictTypes;

/** Typed parse-failure marker — parsers never throw; `reason` is written for
 *  the agent that must reformat (parseWithRetry feeds it to the callback). */
export interface ParseFailure {
  ok: false;
  kind: VerdictKind;
  reason: string;
}

export type ParseResult<K extends VerdictKind> =
  | { ok: true; verdict: VerdictTypes[K] }
  | ParseFailure;

const failure = (kind: VerdictKind, reason: string): ParseFailure => ({
  ok: false,
  kind,
  reason,
});

// ---------------------------------------------------------------------------
// Lenient keyword-value extraction (Status / Verdict lines)
// ---------------------------------------------------------------------------

/** Value with optional backticks: the templates typeset values as `done`. */
const VALUE = "`?([A-Za-z][\\w-]*)`?";

function keywordPatterns(kw: string): RegExp[] {
  return [
    // ## Status: done   (inline heading; also matches `## Status:\ndone`)
    new RegExp(`^##+\\s+${kw}\\s*:\\s*${VALUE}`, "m"),
    // ## Status \n done (value on the next line; blank lines tolerated)
    new RegExp(`^##+\\s+${kw}\\s*\\n\\s*${VALUE}`, "m"),
    // **Status:** done  (also **Status**: done)
    new RegExp(`\\*\\*${kw}\\s*:?\\s*\\*\\*\\s*:?\\s*${VALUE}`),
    // Status: done      (bare line — our templates' own phrasing)
    new RegExp(`^\\s*${kw}\\s*:\\s*${VALUE}`, "m"),
  ];
}

/** First value found, trying keywords in order, each across all formats.
 *  Keywords are case-sensitive (predecessor parity — a lowercase "status:"
 *  inside quoted CI output must not be mistaken for a verdict). */
function extractKeywordValue(text: string, keywords: string[]): string | undefined {
  for (const kw of keywords) {
    for (const re of keywordPatterns(kw)) {
      const m = re.exec(text);
      if (m?.[1] !== undefined) return m[1].toLowerCase();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Lenient section extraction (contract sections, blocked entries)
// ---------------------------------------------------------------------------

/** Split `text` into sections keyed by `**Key:**` / `## Key` markers. A
 *  section's value runs to the next marker (any key) or end of text. First
 *  occurrence of a key wins. Bare `Key:` lines are deliberately NOT markers —
 *  multi-line section bodies quote things like "Tests: 12 passed". */
function extractSections(
  text: string,
  keys: readonly string[],
): Map<string, string> {
  const markers: { key: string; start: number; valueStart: number }[] = [];
  for (const key of keys) {
    const forms = [
      new RegExp(`\\*\\*${key}\\s*:?\\s*\\*\\*\\s*:?`, "g"),
      new RegExp(`^##+\\s+${key}\\b\\s*:?`, "gm"),
    ];
    for (const re of forms) {
      for (const m of text.matchAll(re)) {
        markers.push({ key, start: m.index, valueStart: m.index + m[0].length });
      }
    }
  }
  markers.sort((a, b) => a.start - b.start);
  const sections = new Map<string, string>();
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    if (sections.has(marker.key)) continue; // first occurrence wins
    const end = i + 1 < markers.length ? markers[i + 1]!.start : text.length;
    sections.set(marker.key, text.slice(marker.valueStart, end).trim());
  }
  return sections;
}

// ---------------------------------------------------------------------------
// contract parser
// ---------------------------------------------------------------------------

const CONTRACT_KEYS = ["Files", "Approach", "Tests", "Risks", "Complexity"] as const;
// Bullet is preferred by the current template but optional for durable
// pre-#19 comments, whose `AC1 -> test` lines must remain rehydratable.
const CONTRACT_TEST_LINE = /^\s*(?:[-*]\s+)?(AC[1-9]\d*)\s*(?:->|→)\s*(.+?)\s*$/;

function parseContractTests(section: string): ParseResult<"contract"> | ContractCriterionTests[] {
  const entries: ContractCriterionTests[] = [];
  for (const line of section.split("\n")) {
    if (line.trim().length === 0) continue;
    const match = CONTRACT_TEST_LINE.exec(line);
    if (match === null) {
      return failure(
        "contract",
        `malformed Tests mapping line ${JSON.stringify(line.trim())} — expected ` +
          `"- AC1 -> named test; another named test"`,
      );
    }
    entries.push({
      criterionId: match[1]!,
      tests: match[2]!.split(";").map((test) => test.trim()).filter(Boolean),
    });
  }
  const problem = contractTestsProblem(entries);
  return problem === undefined ? entries : failure("contract", problem);
}

function parseContract(text: string): ParseResult<"contract"> {
  const sections = extractSections(text, CONTRACT_KEYS);
  const missing = CONTRACT_KEYS.filter((k) => !sections.get(k));
  if (missing.length > 0) {
    return failure(
      "contract",
      `missing contract section(s): ${missing.join(", ")} — emit all five: ` +
        `**Files:** / **Approach:** / **Tests:** / **Risks:** / **Complexity:** ` +
        `(prompts/build/contract.md)`,
    );
  }

  const files = sections
    .get("Files")!
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").replace(/`/g, "").trim())
    .filter((line) => line.length > 0);
  if (files.length === 0) {
    return failure("contract", "Files section lists no files — one per line");
  }

  const complexityRaw = sections.get("Complexity")!;
  const cm = /([A-Za-z]+)/.exec(complexityRaw.replace(/`/g, ""));
  const complexity = cm?.[1]?.toLowerCase();
  if (
    complexity === undefined ||
    !(CONTRACT_COMPLEXITIES as readonly string[]).includes(complexity)
  ) {
    return failure(
      "contract",
      `complexity ${JSON.stringify(complexityRaw.split("\n")[0])} not recognized ` +
        `(expected ${CONTRACT_COMPLEXITIES.join(" | ")})`,
    );
  }

  const tests = parseContractTests(sections.get("Tests")!);
  if (!Array.isArray(tests)) return tests;

  return {
    ok: true,
    verdict: {
      files,
      approach: sections.get("Approach")!,
      tests,
      risks: sections.get("Risks")!,
      complexity: complexity as Complexity,
    },
  };
}

// ---------------------------------------------------------------------------
// build parser
// ---------------------------------------------------------------------------

const BLOCKED_KEYS = ["Error", "Attempted", "Result", "Assessment"] as const;

/** `- fixed <location> -- <note>` / `- rebutted <location> -- <note>`;
 *  unicode or ASCII dashes, same tolerance as the finding grammar. */
const RESOLUTION_LINE = /^\s*-\s+(fixed|rebutted)\s+(\S+)\s+(?:--|—)\s+(.+?)\s*$/i;

function parseResolutions(text: string): FindingResolution[] {
  const resolutions: FindingResolution[] = [];
  for (const line of text.split("\n")) {
    const match = RESOLUTION_LINE.exec(line);
    if (match === null) continue;
    resolutions.push({
      outcome: match[1]!.toLowerCase() as FindingResolution["outcome"],
      location: match[2]!,
      note: match[3]!,
    });
  }
  return resolutions;
}

function parseBuild(text: string): ParseResult<"build"> {
  const status = extractKeywordValue(text, ["Status", "Verdict"]);
  if (status === undefined) {
    return failure(
      "build",
      `no status found — report exactly one verdict line, e.g. "Status: done" ` +
        `or "**Status:** blocked" (keywords: Status | Verdict; values: done | blocked)`,
    );
  }
  if (status !== "done" && status !== "blocked") {
    return failure("build", `status "${status}" not recognized (expected done | blocked)`);
  }
  const resolutions = parseResolutions(text);
  const withResolutions = resolutions.length > 0 ? { resolutions } : {};
  if (status === "done") return { ok: true, verdict: { status, ...withResolutions } };

  const sections = extractSections(text, BLOCKED_KEYS);
  const present = BLOCKED_KEYS.filter((k) => (sections.get(k) ?? "").length > 0);
  if (present.length === 0) return { ok: true, verdict: { status, ...withResolutions } };
  if (present.length < BLOCKED_KEYS.length) {
    const missing = BLOCKED_KEYS.filter((k) => !present.includes(k));
    return failure(
      "build",
      `blocked entry incomplete — missing ${missing.map((k) => `**${k}:**`).join(", ")} ` +
        `(all four parts required: Error verbatim, Attempted, Result, Assessment)`,
    );
  }
  return {
    ok: true,
    verdict: {
      status,
      blockedEntry: {
        error: sections.get("Error")!,
        attempted: sections.get("Attempted")!,
        result: sections.get("Result")!,
        assessment: sections.get("Assessment")!,
      },
      ...withResolutions,
    },
  };
}

// ---------------------------------------------------------------------------
// review parser — §6 finding line grammar
// ---------------------------------------------------------------------------

/** `- category/severity file:line -- description -> action`; unicode or
 *  ASCII delimiters (predecessor FINDING_PATTERN parity). */
const FINDING_LINE =
  /^\s*-\s+([A-Za-z][\w-]*)\/([A-Za-z][\w-]*)\s+(\S+)\s+(?:--|—)\s+(.+?)\s+(?:->|→)\s+(.+?)\s*$/;

// A line is a finding ATTEMPT (and therefore a loud failure when the full
// grammar doesn't match) when a known severity follows a slash …
const FINDING_PROBE_SEVERITY = /^\s*-\s+[\w.-]+\/(critical|major|minor)\b/i;
// … or the bullet carries a slashed token plus BOTH grammar delimiters.
const FINDING_PROBE_DELIMITERS = /^\s*-\s+\S+\/\S+.*(?:--|—).*(?:->|→)/;

function categoryProblem(category: string): string {
  const base =
    `unknown category "${category}" (allowed: ${FINDING_CATEGORIES.join(", ")})`;
  if (category === "perf" || category === "performance") {
    return (
      base +
      `; performance findings file under architecture — or testing when the gap ` +
      `is a missing load-shape test (prompts/review/perf.md)`
    );
  }
  return base;
}

function parseReview(text: string): ParseResult<"review"> {
  const findings: Finding[] = [];
  const problems: string[] = [];

  for (const line of text.split("\n")) {
    const m = FINDING_LINE.exec(line);
    if (m) {
      const category = m[1]!.toLowerCase();
      const severity = m[2]!.toLowerCase();
      const lineProblems: string[] = [];
      if (!(FINDING_CATEGORIES as readonly string[]).includes(category)) {
        lineProblems.push(categoryProblem(category));
      }
      if (!(FINDING_SEVERITIES as readonly string[]).includes(severity)) {
        lineProblems.push(
          `unknown severity "${severity}" (allowed: ${FINDING_SEVERITIES.join(", ")})`,
        );
      }
      if (lineProblems.length > 0) {
        problems.push(...lineProblems);
      } else {
        findings.push({
          category: category as FindingCategory,
          severity: severity as FindingSeverity,
          location: m[3]!,
          description: m[4]!,
          action: m[5]!,
        });
      }
    } else if (FINDING_PROBE_SEVERITY.test(line) || FINDING_PROBE_DELIMITERS.test(line)) {
      problems.push(
        `malformed finding line ${JSON.stringify(line.trim())} — expected ` +
          `"- category/severity file:line -- description -> action"`,
      );
    }
  }
  if (problems.length > 0) return failure("review", problems.join("; "));

  const verdict = extractKeywordValue(text, ["Verdict", "Status"]);
  if (verdict === undefined) {
    return failure(
      "review",
      `no verdict found — state "Verdict: approve" or "Verdict: findings"`,
    );
  }
  if (verdict !== "approve" && verdict !== "findings") {
    return failure(
      "review",
      `verdict "${verdict}" not recognized (expected approve | findings)`,
    );
  }
  if (verdict === "approve" && findings.length > 0) {
    return failure(
      "review",
      `verdict says approve but ${findings.length} finding(s) are listed — ` +
        `approve means the list is empty (prompts/review/verify.md)`,
    );
  }
  if (verdict === "findings" && findings.length === 0) {
    return failure(
      "review",
      `verdict says findings but no finding lines parsed — use ` +
        `"- category/severity file:line -- description -> action"`,
    );
  }
  const audit = parseReviewAudit(text, verdict, findings);
  if (!audit.ok) return audit;
  return { ok: true, verdict: { verdict, findings, review: audit.review } };
}

const REVIEW_AUDIT_KEYS = ["Review rationale", "Evidence", "Not reviewed"] as const;
const REVIEW_EVIDENCE_LINE = /^\s*-\s+(.+?)\s+(?:=>|⇒)\s+(.+?)\s*$/;

function parseReviewAudit(
  text: string,
  verdict: ReviewVerdict["verdict"],
  findings: readonly Finding[],
):
  | { ok: true; review: ReviewVerdict["review"] }
  | ParseFailure {
  const sections = extractSections(text, REVIEW_AUDIT_KEYS);
  const present = REVIEW_AUDIT_KEYS.filter((key) => sections.has(key));
  if (present.length === 0 && verdict === "findings") {
    // Historical findings already carry concrete location, defect, and action
    // evidence. Preserve their rehydratability without allowing a new
    // approve/no-findings result to collapse back to an unexplained assertion.
    return {
      ok: true,
      review: {
        rationale: `The review found ${findings.length} actionable finding(s).`,
        evidence: findings.map((finding) => ({
          claim: `${finding.category}/${finding.severity} at ${finding.location}`,
          evidence: `${finding.description}; required action: ${finding.action}`,
        })),
        notReviewed: [],
      },
    };
  }
  if (present.length < REVIEW_AUDIT_KEYS.length) {
    const missing = REVIEW_AUDIT_KEYS.filter((key) => !sections.has(key));
    return failure(
      "review",
      `review audit incomplete — missing ${missing.map((key) => `## ${key}`).join(", ")}; ` +
        "approve requires non-empty rationale/evidence and explicit not-reviewed scope",
    );
  }
  const rationale = sections.get("Review rationale")!.trim();
  if (rationale.length === 0) {
    return failure("review", "review rationale is empty");
  }
  const evidence: ReviewVerdict["review"]["evidence"] = [];
  for (const line of sections.get("Evidence")!.split("\n")) {
    if (line.trim().length === 0) continue;
    const match = REVIEW_EVIDENCE_LINE.exec(line);
    if (match === null) {
      return failure(
        "review",
        `malformed review evidence ${JSON.stringify(line.trim())} — expected ` +
          '"- claim => concrete evidence"',
      );
    }
    evidence.push({ claim: match[1]!.trim(), evidence: match[2]!.trim() });
  }
  if (evidence.length === 0) {
    return failure("review", "review evidence contains no entries");
  }
  const rawNotReviewed = sections.get("Not reviewed")!
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
  const notReviewed = rawNotReviewed.length === 1 && /^(?:none|nothing)\.?$/i.test(rawNotReviewed[0]!)
    ? []
    : rawNotReviewed;
  return { ok: true, review: { rationale, evidence, notReviewed } };
}

// ---------------------------------------------------------------------------
// parseVerdict + parseWithRetry
// ---------------------------------------------------------------------------

const PARSERS: { [P in VerdictKind]: (text: string) => ParseResult<P> } = {
  contract: parseContract,
  build: parseBuild,
  review: parseReview,
  "learning-distill": () => failure("learning-distill", "expected one structured JSON object"),
  "learning-review": () => failure("learning-review", "expected one structured JSON object"),
};

/** Parse a pass's text output into its typed verdict. Never throws on bad
 *  text — a failed parse is a typed marker whose reason is written for the
 *  agent's reformat request. */
export function parseVerdict<K extends VerdictKind>(kind: K, text: string): ParseResult<K> {
  const parser = PARSERS[kind] as ((text: string) => ParseResult<K>) | undefined;
  if (!parser) {
    throw new Error(
      `unknown verdict kind ${JSON.stringify(kind)} ` +
        `(expected contract | build | review | learning-distill | learning-review)`,
    );
  }
  return parser(text);
}

export interface ParseAttempt {
  text: string;
  reason: string;
}

/** The loud, typed end of the retry path — carries every attempt verbatim so
 *  the run record shows exactly what the agent produced. */
export class VerdictParseError extends Error {
  readonly kind: VerdictKind;
  readonly attempts: readonly ParseAttempt[];

  constructor(kind: VerdictKind, attempts: readonly ParseAttempt[]) {
    const last = attempts[attempts.length - 1];
    super(
      `${kind} verdict unparseable after ${attempts.length} attempt(s): ` +
        `${last?.reason ?? "no attempts"}`,
    );
    this.name = "VerdictParseError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

/** Parse a verdict preferring native structured JSON output when the text
 *  is a JSON object, else the lenient §6 text grammar. Never throws — a
 *  failure is a typed marker the reformat retry acts on. The ONE
 *  JSON-or-text parser: the loop's verdict recorder and the M5 replay
 *  executor both route through it so a schema-shaped failure is always
 *  reported as a schema failure, never as a text-grammar miss. */
export function parseVerdictEither<K extends VerdictKind>(kind: K, text: string): ParseResult<K> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return parseVerdict(kind, text); // looked like JSON but wasn't — try the grammar
    }
    return validateVerdict(kind, json);
  }
  return parseVerdict(kind, text);
}

/** One parse-failure retry (§6): `reformat` asks the SAME session to restate
 *  its verdict — it receives the failure reason and returns the new text.
 *  Exactly one retry, then a loud VerdictParseError. `parse` defaults to the
 *  lenient text grammar; a caller that also accepts native structured-output
 *  JSON (the loop) passes a JSON-or-text parser so both transports get the
 *  same single-retry contract. */
export async function parseWithRetry<K extends VerdictKind>(
  kind: K,
  text: string,
  reformat: (reason: string) => string | Promise<string>,
  parse: (text: string) => ParseResult<K> = (t) => parseVerdict(kind, t),
): Promise<VerdictTypes[K]> {
  const first = parse(text);
  if (first.ok) return first.verdict;
  const retryText = await reformat(first.reason);
  const second = parse(retryText);
  if (second.ok) return second.verdict;
  throw new VerdictParseError(kind, [
    { text, reason: first.reason },
    { text: retryText, reason: second.reason },
  ]);
}

// ---------------------------------------------------------------------------
// Self-describing JSON-schema shapes — the native-structured-output contract
// ---------------------------------------------------------------------------

/** The JSON-schema subset the verdict shapes use — object / scalar / array,
 *  enum, required, additionalProperties, items, minItems. A type alias (not
 *  an interface) so schemas plug straight into `TurnRequest.verdictSchema`
 *  (Record<string, unknown>). `validateVerdict` interprets exactly this
 *  subset — the schema IS the validator's input, never a parallel truth. */
export type VerdictSchema = {
  readonly title?: string;
  readonly description?: string;
  readonly type?: "object" | "string" | "array" | "boolean" | "integer";
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, VerdictSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: VerdictSchema;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
};

const FINDING_SCHEMA: VerdictSchema = {
  title: "Finding",
  description:
    "One review finding — line grammar: `- category/severity file:line -- " +
    "description -> action` (docs/loop.md §6). There is deliberately no perf " +
    "category: performance findings file under architecture or testing " +
    "(prompts/review/perf.md).",
  type: "object",
  additionalProperties: false,
  required: ["category", "severity", "location", "description", "action"],
  properties: {
    category: { type: "string", enum: FINDING_CATEGORIES },
    severity: { type: "string", enum: FINDING_SEVERITIES },
    location: { type: "string", description: "file:line (or file) the finding anchors to" },
    description: { type: "string", description: "what is wrong, specifically" },
    action: { type: "string", description: "what would resolve it" },
  },
};

const REVIEW_AUDIT_SCHEMA: VerdictSchema = {
  title: "ReviewAudit",
  description:
    "Auditable review rationale, concrete claim/evidence pairs, and explicit deliberately-unreviewed scope.",
  type: "object",
  additionalProperties: false,
  required: ["rationale", "evidence", "notReviewed"],
  properties: {
    rationale: {
      type: "string",
      minLength: 1,
      description: "non-empty explanation for the verdict",
    },
    evidence: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "evidence"],
        properties: {
          claim: { type: "string", minLength: 1 },
          evidence: { type: "string", minLength: 1 },
        },
      },
    },
    notReviewed: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description: "deliberately excluded scope; [] explicitly means none",
    },
  },
};

const FINDING_RESOLUTION_SCHEMA: VerdictSchema = {
  title: "FindingResolution",
  description:
    "One fix-pass disposition — line grammar: `- fixed|rebutted <location> -- " +
    "<evidence>` (prompts/build/fix.md). The orchestrator posts these to the " +
    "durable findings ledger, so a finding without one stays open.",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "location", "note"],
  properties: {
    outcome: { type: "string", enum: FINDING_RESOLUTION_OUTCOMES },
    location: {
      type: "string",
      minLength: 1,
      description: "the finding's location, verbatim from the finding line",
    },
    note: {
      type: "string",
      minLength: 1,
      description: "evidence: the proving commit/test for fixed, the reason for rebutted",
    },
  },
};

const BLOCKED_ENTRY_SCHEMA: VerdictSchema = {
  title: "BlockedEntry",
  description:
    "The §7 blocked protocol: error verbatim, attempted fix, result, assessment.",
  type: "object",
  additionalProperties: false,
  required: ["error", "attempted", "result", "assessment"],
  properties: {
    error: { type: "string", description: "the failing output, verbatim — never a paraphrase" },
    attempted: { type: "string", description: "what was tried, concretely" },
    result: { type: "string", description: "what happened when it was tried" },
    assessment: { type: "string", description: "why this is blocked and what would unblock it" },
  },
};

const LEARNING_DESTINATIONS = [
  "okf_concept",
  "skill_draft",
  "protocol_proposal",
  "eval_or_gate_proposal",
  "ticket",
  "reject",
] as const;

const DISTILLATION_PROPOSAL_SCHEMA: VerdictSchema = {
  title: "DistillationProposal",
  type: "object",
  additionalProperties: false,
  required: [
    "cluster_fingerprint",
    "destination",
    "title",
    "proposed_scope",
    "proposed_tier",
    "claims_efficacy",
    "draft_summary",
    "draft_body",
    "acceptance",
    "topic_key",
  ],
  properties: {
    cluster_fingerprint: { type: "string" },
    destination: { type: "string", enum: LEARNING_DESTINATIONS },
    title: { type: "string" },
    proposed_scope: {
      type: "string",
      description:
        "Governed learning scope. EXACTLY one of: `org`, `roles/<role>`, " +
        "`apps/<app>`, or `apps/<app>/roles/<role>` (src/org/memory.ts " +
        "`isValidLoopScope`). A bare app name, a role name on its own, or any " +
        "prose description is rejected — use `apps/<app>`, not `<app>`. The " +
        "brief lists the exact legal values for this turn.",
    },
    proposed_tier: { type: "string", enum: ["T0", "T1", "T2", "T3"] },
    claims_efficacy: { type: "boolean" },
    draft_summary: { type: "string" },
    draft_body: { type: "string" },
    acceptance: { type: "array", items: { type: "string" } },
    topic_key: { type: "string" },
  },
};

const LEARNING_RUBRIC_SCHEMA: VerdictSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "correctness",
    "generality",
    "scope_fit",
    "destination_fit",
    "provenance_trust",
    "injection_screen",
  ],
  properties: {
    correctness: { type: "integer", minimum: 0, maximum: 5 },
    generality: { type: "integer", minimum: 0, maximum: 5 },
    scope_fit: { type: "integer", minimum: 0, maximum: 5 },
    destination_fit: { type: "integer", minimum: 0, maximum: 5 },
    provenance_trust: { type: "integer", minimum: 0, maximum: 5 },
    injection_screen: { type: "string", enum: ["clean", "suspicious", "flagged"] },
  },
};

const LEARNING_REVIEW_SCHEMA: VerdictSchema = {
  title: "LearningReviewProposal",
  type: "object",
  additionalProperties: false,
  required: [
    "candidate_id",
    "verdict",
    "proposed_destination",
    "proposed_tier",
    "proposed_scope",
    "experiment_required",
    "rubric",
    "conflicts_with",
    "duplicates",
    "eval_required",
    "eval_present",
    "rationale",
  ],
  properties: {
    candidate_id: { type: "string" },
    verdict: { type: "string", enum: ["approve", "revise", "reject", "escalate"] },
    proposed_destination: { type: "string", enum: LEARNING_DESTINATIONS },
    proposed_tier: { type: "string", enum: ["T0", "T1", "T2", "T3"] },
    proposed_scope: { type: "string" },
    experiment_required: { type: "boolean" },
    rubric: LEARNING_RUBRIC_SCHEMA,
    conflicts_with: { type: "array", items: { type: "string" } },
    duplicates: { type: "array", items: { type: "string" } },
    eval_required: { type: "boolean" },
    eval_present: { type: "boolean" },
    rationale: { type: "string" },
  },
};

export const VERDICT_SCHEMAS: Readonly<Record<VerdictKind, VerdictSchema>> = {
  contract: {
    title: "ContractVerdict",
    description:
      "The contract pass's plan of record (prompts/build/contract.md): files " +
      "to touch, approach, criterion→test mapping, risks, complexity.",
    type: "object",
    additionalProperties: false,
    required: ["files", "approach", "tests", "risks", "complexity"],
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "every file to create or modify",
      },
      approach: { type: "string", description: "1-3 sentences: what changes and why this way" },
      tests: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterionId", "tests"],
          properties: {
            criterionId: { type: "string", description: "acceptance criterion id, e.g. AC1" },
            tests: { type: "array", minItems: 1, items: { type: "string" } },
          },
        },
        description: "one typed criterion id → named test list entry per acceptance criterion",
      },
      risks: { type: "string", description: "what could go wrong; spec/code disagreements" },
      complexity: { type: "string", enum: CONTRACT_COMPLEXITIES },
    },
  },
  build: {
    title: "BuildVerdict",
    description:
      "Implement/fix pass outcome: done (full suite green, self-check passed) " +
      "or blocked with the four-part entry (prompts/build/implement.md). A fix " +
      "pass additionally carries one resolution per finding it was given " +
      "(prompts/build/fix.md); an implement pass omits the list.",
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["done", "blocked"] },
      blockedEntry: BLOCKED_ENTRY_SCHEMA,
      resolutions: {
        type: "array",
        items: FINDING_RESOLUTION_SCHEMA,
        description:
          "fix passes only: one fixed/rebutted disposition per finding, in the order given",
      },
    },
  },
  review: {
    title: "ReviewVerdict",
    description:
      "Review pass outcome: approve (findings list is empty) or findings. " +
      "Double-entered as a real GitHub review — the GitHub state is " +
      "authoritative for merge (docs/loop.md §6).",
    type: "object",
    additionalProperties: false,
    required: ["verdict", "findings", "review"],
    properties: {
      verdict: { type: "string", enum: ["approve", "findings"] },
      findings: { type: "array", items: FINDING_SCHEMA },
      review: REVIEW_AUDIT_SCHEMA,
    },
  },
  "learning-distill": {
    title: "DistillationVerdict",
    description: "Governed candidate proposals for deterministic evidence clusters.",
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: { type: "array", items: DISTILLATION_PROPOSAL_SCHEMA },
    },
  },
  "learning-review": {
    title: "LearningReviewVerdict",
    description: "Independent fail-closed reviews for supplied pending candidates.",
    type: "object",
    additionalProperties: false,
    required: ["reviews"],
    properties: {
      reviews: { type: "array", items: LEARNING_REVIEW_SCHEMA },
    },
  },
};

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function schemaErrors(schema: VerdictSchema, value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (schema.enum) {
    if (typeof value !== "string" || !schema.enum.includes(value)) {
      errors.push(
        `${path}: expected one of ${schema.enum.join(" | ")}, got ${JSON.stringify(value)}`,
      );
    }
    return errors;
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        errors.push(`${path}: expected string, got ${typeName(value)}`);
      } else if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
        errors.push(`${path}: expected at least ${schema.minLength} non-whitespace character(s)`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push(`${path}: expected boolean, got ${typeName(value)}`);
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer, got ${typeName(value)}`);
      } else {
        if (schema.minimum !== undefined && value < schema.minimum) {
          errors.push(`${path}: expected >= ${schema.minimum}, got ${value}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
          errors.push(`${path}: expected <= ${schema.maximum}, got ${value}`);
        }
      }
      break;
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${typeName(value)}`);
        break;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: expected at least ${schema.minItems} item(s), got ${value.length}`);
      }
      if (schema.items) {
        value.forEach((item, i) =>
          errors.push(...schemaErrors(schema.items!, item, `${path}[${i}]`)),
        );
      }
      break;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path}: expected object, got ${typeName(value)}`);
        break;
      }
      const record = value as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) errors.push(`${path}.${key}: required`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in props)) errors.push(`${path}.${key}: unknown key`);
        }
      }
      for (const [key, node] of Object.entries(props)) {
        const child = record[key];
        if (child === undefined) continue;
        // Native structured outputs (OpenAI/Codex strict mode) require every
        // property to be present, expressing an optional field as an explicit
        // null. Treat a null on a NON-required property as absent; a null on a
        // required property falls through and fails its type check below.
        if (child === null && !(schema.required ?? []).includes(key)) continue;
        errors.push(...schemaErrors(node, child, `${path}.${key}`));
      }
      break;
    }
  }
  return errors;
}

/** Drop the `null`s a native strict-output transport emits for absent optional
 *  fields. `schemaErrors` already treats them as absent, but the VALUE was
 *  passed through unchanged, so a parsed verdict could carry `resolutions: null`
 *  or `blockedEntry: null` where its TypeScript type promises `undefined`.
 *  Consumers legitimately branch on `!== undefined` and then dereference, so
 *  the transport's convention became a null-dereference in orchestrator code.
 *  Normalizing here keeps the two transports' outputs identical. */
function normalizeStrictNulls(schema: VerdictSchema, value: unknown): unknown {
  if (schema.enum !== undefined) return value;
  if (schema.type === "array") {
    if (!Array.isArray(value) || schema.items === undefined) return value;
    return value.map((item) => normalizeStrictNulls(schema.items!, item));
  }
  if (schema.type !== "object") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const node = props[key];
    if (node === undefined) {
      normalized[key] = child;
      continue;
    }
    if (child === null && !required.includes(key)) continue;
    normalized[key] = normalizeStrictNulls(node, child);
  }
  return normalized;
}

/** Validate a native-structured-output verdict (parsed JSON) against its
 *  kind's schema, plus the same consistency rules the text parser enforces.
 *  Same ParseResult shape as parseVerdict — both transports converge. */
export function validateVerdict<K extends VerdictKind>(
  kind: K,
  value: unknown,
): ParseResult<K> {
  const schema = VERDICT_SCHEMAS[kind] as VerdictSchema | undefined;
  if (!schema) {
    throw new Error(
      `unknown verdict kind ${JSON.stringify(kind)} ` +
        `(expected contract | build | review | learning-distill | learning-review)`,
    );
  }
  const errors = schemaErrors(schema, value, kind);
  if (errors.length > 0) return failure(kind, errors.join("; "));
  const normalized = normalizeStrictNulls(schema, value);
  if (kind === "contract") {
    const problem = contractTestsProblem((normalized as ContractVerdict).tests);
    if (problem !== undefined) return failure(kind, problem);
  }
  if (kind === "review") {
    const rv = normalized as ReviewVerdict;
    if (rv.verdict === "approve" && rv.findings.length > 0) {
      return failure(
        kind,
        `verdict says approve but ${rv.findings.length} finding(s) are listed — ` +
          `approve means the list is empty`,
      );
    }
    if (rv.verdict === "findings" && rv.findings.length === 0) {
      return failure(kind, `verdict says findings but the findings list is empty`);
    }
  }
  return { ok: true, verdict: normalized as VerdictTypes[K] };
}

function contractTestsProblem(entries: readonly ContractCriterionTests[]): string | undefined {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!/^AC[1-9]\d*$/.test(entry.criterionId)) {
      return `invalid criterion id ${JSON.stringify(entry.criterionId)} (expected AC1, AC2, ...)`;
    }
    if (seen.has(entry.criterionId)) return `duplicate Tests mapping for ${entry.criterionId}`;
    seen.add(entry.criterionId);
    if (entry.tests.length === 0 || entry.tests.some((test) => test.trim().length === 0)) {
      return `criterion ${entry.criterionId} has no named tests`;
    }
  }
  return entries.length === 0 ? "Tests mapping contains no criterion entries" : undefined;
}
