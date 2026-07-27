// Deterministic, token-budgeted brief assembly (build plan M2.3;
// docs/loop/design.md §3). The brief is the answer to "fix this bug + source code"
// vs "feature doc + relevant PRD + learnings so far + fix this issue":
// [ticket][spec][contract][findings][history][memory][repo], assembled the
// same way every time — byte-identical output for identical inputs, because
// briefs are logged verbatim in run artifacts (§9) and cache-stable
// assembly matters (architecture.md §5).
//
// Budgeting (§3, the predecessor's state-budget idea): estimate tokens with
// the len/4 heuristic; when over budget, summarize the OLDEST RESOLVED
// material first — settled findings, early attempts — then excerpt specs by
// heading match. Active material stays verbatim. The ticket, its acceptance
// criteria, and gate output ("actual error text, never a summary") are
// never summarized, whatever the budget.

import type { ContextBundle } from "../runtime/types.js";

export interface TicketSection {
  title: string;
  /** Issue body: goal, context, acceptance criteria, scope — never summarized. */
  body: string;
}

/** A linked document resolved from the ticket's Context links (§3): whole
 *  doc if the budget allows, relevant sections by heading match otherwise. */
export interface SpecDoc {
  title: string;
  content: string;
}

export interface BriefFinding {
  /** The finding entry, verbatim (§6 line grammar or free text). */
  text: string;
  severity: "critical" | "major" | "minor";
  /** Resolved findings are summarizable; active ones never are. */
  resolved: boolean;
}

export interface BriefInput {
  ticket: TicketSection;
  /** In doc order. */
  specs?: SpecDoc[];
  /** The implementation contract — present on implement/fix passes. */
  contract?: string;
  /** Oldest first. Active findings render severity-sorted and verbatim. */
  findings?: BriefFinding[];
  /** Verbatim gate output on remediation — never summarized (§3). */
  gateOutput?: string;
  /** Prior attempts, oldest first; the latest always stays verbatim. */
  attempts?: string[];
  /** Renders "attempt N of M" when attempts are present (§3 [history]). */
  maxAttempts?: number;
  /** OKF excerpts — selected once per pipeline execution by the caller. */
  memory?: string[];
  /** App conventions: build/test commands from .operon/config.yaml. */
  repo?: string;
}

export interface BriefOpts {
  budgetTokens: number;
}

/** §3's starting heuristic. Exported so callers budget with the same ruler. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Append content-bound authority provenance to the executable role brief.
 * Full charter prose stays in the native system/developer channel; this
 * compact section makes brief.md independently auditable. Idempotent because
 * runRole builds once and the pipeline executor enforces it again. */
export function withAuthorityBrief(brief: string, context: ContextBundle): string {
  if (context.authority === undefined || /(?:^|\n)\[authority\]\n/.test(brief)) return brief;
  const authority = context.authority;
  return [
    brief.trimEnd(),
    "",
    "[authority]",
    `profile: ${authority.profile}`,
    `version: ${authority.version}`,
    `sha256: ${authority.sha256}`,
    `sources: ${authority.sources.join(", ")}`,
    "The full effective charter is injected through the runtime's native instruction channel.",
    "App policy and this task may narrow it; neither can broaden it or bypass a critical-operation gate.",
    "",
  ].join("\n");
}

const SEVERITY_ORDER: Record<BriefFinding["severity"], number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

/** One deterministic mechanical summary shape: the first line, capped. No
 *  model in the loop — reproducibility beats eloquence here. */
function summarize(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
}

interface Section {
  heading: string;
  body: string;
}

/** Split a markdown doc into (heading, body) sections; text before the
 *  first heading becomes a heading-less preamble section. */
function splitSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: "", body: "" };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (current.heading !== "" || current.body.trim() !== "") sections.push(current);
      current = { heading: line, body: "" };
    } else {
      current.body += (current.body === "" ? "" : "\n") + line;
    }
  }
  if (current.heading !== "" || current.body.trim() !== "") sections.push(current);
  return sections;
}

/** Words that carry matching signal: length ≥ 4, lowercased. Deterministic
 *  and dumb on purpose — heading match is a budget heuristic, not search. */
function signalWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9-]{4,}/g) ?? []).values());
}

/** §3: "relevant sections by heading match" — keep sections whose heading
 *  shares a signal word with the ticket, in doc order. */
function excerptSpec(spec: SpecDoc, ticketWords: Set<string>): string {
  const sections = splitSections(spec.content);
  const matched = sections.filter((s) =>
    [...signalWords(s.heading)].some((w) => ticketWords.has(w)),
  );
  if (matched.length === 0) {
    return `(no section of "${spec.title}" matched the ticket by heading — doc omitted under budget)`;
  }
  const excerpt = matched
    .map((s) => (s.heading === "" ? s.body : `${s.heading}\n${s.body}`))
    .join("\n")
    .trimEnd();
  return `(excerpted from "${spec.title}" by heading match)\n${excerpt}`;
}

/** Internal render state: which reductions have been applied. */
interface Reductions {
  summarizedFindings: number; // count of resolved findings summarized (oldest first)
  summarizedAttempts: number; // count of attempts summarized (oldest first, latest exempt)
  excerptedSpecs: number; // count of specs excerpted by heading match (in order)
}

function render(input: BriefInput, r: Reductions): string {
  const parts: string[] = [];

  parts.push(`[ticket]\n${input.ticket.title}\n\n${input.ticket.body.trimEnd()}`);

  const specs = input.specs ?? [];
  if (specs.length > 0) {
    const ticketWords = signalWords(`${input.ticket.title}\n${input.ticket.body}`);
    const rendered = specs.map((spec, i) => {
      const body =
        i < r.excerptedSpecs ? excerptSpec(spec, ticketWords) : spec.content.trimEnd();
      return `--- ${spec.title} ---\n${body}`;
    });
    parts.push(`[spec]\n${rendered.join("\n\n")}`);
  }

  if (input.contract !== undefined) {
    parts.push(`[contract]\n${input.contract.trimEnd()}`);
  }

  const findings = input.findings ?? [];
  if (findings.length > 0 || input.gateOutput !== undefined) {
    const active = findings
      .map((f, age) => ({ f, age }))
      .filter(({ f }) => !f.resolved)
      // Severity-sorted for the reader (§3); stable by age within severity.
      .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.age - b.age);
    const resolved = findings.map((f, age) => ({ f, age })).filter(({ f }) => f.resolved);

    const lines: string[] = [];
    for (const { f } of active) lines.push(`- [active ${f.severity}] ${f.text}`);
    resolved.forEach(({ f }, i) => {
      lines.push(
        i < r.summarizedFindings
          ? `- [resolved, summarized] ${summarize(f.text)}`
          : `- [resolved] ${f.text}`,
      );
    });
    if (input.gateOutput !== undefined) {
      lines.push(`Gate output (verbatim):\n${input.gateOutput.trimEnd()}`);
    }
    parts.push(`[findings]\n${lines.join("\n")}`);
  }

  const attempts = input.attempts ?? [];
  if (attempts.length > 0) {
    const max = input.maxAttempts ?? attempts.length;
    const lines = attempts.map((text, i) => {
      const label = `attempt ${i + 1} of ${max}`;
      // The latest attempt is always verbatim — it is the active context.
      const summarizable = i < attempts.length - 1;
      return summarizable && i < r.summarizedAttempts
        ? `${label} (summarized): ${summarize(text)}`
        : `${label}:\n${text.trimEnd()}`;
    });
    parts.push(`[history]\n${lines.join("\n")}`);
  }

  const memory = input.memory ?? [];
  if (memory.length > 0) {
    parts.push(`[memory]\n${memory.map((m) => m.trimEnd()).join("\n\n")}`);
  }

  if (input.repo !== undefined) {
    parts.push(`[repo]\n${input.repo.trimEnd()}`);
  }

  return parts.join("\n\n") + "\n";
}

/** Assemble the brief for one pass. Deterministic: identical inputs yield
 *  byte-identical output. Over budget, reductions apply in a fixed order —
 *  (1) summarize resolved findings oldest-first, (2) summarize prior
 *  attempts oldest-first (latest exempt), (3) excerpt specs by heading
 *  match, first doc first — re-measuring after each step and stopping as
 *  soon as the brief fits. If every reduction is applied and the brief
 *  still exceeds the budget, it is returned over budget: the never-summarize
 *  material (ticket, criteria, gate output) is not negotiable (§3). */
export function assembleBrief(input: BriefInput, opts: BriefOpts): string {
  const resolvedCount = (input.findings ?? []).filter((f) => f.resolved).length;
  const attemptCount = Math.max((input.attempts ?? []).length - 1, 0);
  const specCount = (input.specs ?? []).length;

  const r: Reductions = { summarizedFindings: 0, summarizedAttempts: 0, excerptedSpecs: 0 };
  let out = render(input, r);
  if (estimateTokens(out) <= opts.budgetTokens) return out;

  const steps: Array<() => void> = [];
  for (let i = 0; i < resolvedCount; i++) steps.push(() => (r.summarizedFindings += 1));
  for (let i = 0; i < attemptCount; i++) steps.push(() => (r.summarizedAttempts += 1));
  for (let i = 0; i < specCount; i++) steps.push(() => (r.excerptedSpecs += 1));

  for (const step of steps) {
    step();
    out = render(input, r);
    if (estimateTokens(out) <= opts.budgetTokens) return out;
  }
  return out;
}
