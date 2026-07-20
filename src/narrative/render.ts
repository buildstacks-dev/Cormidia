// Deterministic markdown rendering (#129): capture → story.md, captures →
// INDEX.md. Templated prose over durable records — no model turn, no wall
// clock ("as of" is the capture's own newest source timestamp), byte-stable
// for unchanged captures so re-renders never churn the files.

import { storySlug } from "./capture.js";
import type { NarrativeQuote, NarrativeStory } from "./types.js";

export function renderStoryMarkdown(story: NarrativeStory): string {
  const lines: string[] = [];
  lines.push(`# ${story.title}`, "");
  lines.push(
    `App: \`${story.app}\` · Story: \`${story.story_id}\` · Status: **${story.status}** · As of ${story.captured_at}`,
  );
  if (story.ticket_ref !== undefined) lines.push(`Ticket: ${story.ticket_ref}`);
  if (story.planned_by !== undefined) {
    lines.push(
      `Planned by: [\`${story.planned_by.episode_id}\`](${storySlug(story.planned_by.episode_id)}.md)` +
        (story.planned_by.run_id !== "" ? ` (run \`${story.planned_by.run_id}\`)` : ""),
    );
  }
  lines.push("");

  if (story.origin !== undefined) {
    const label = story.origin.kind === "parent_task" ? "Originating task prompt" : "Planning brief";
    const ref = story.origin.ref !== undefined ? ` (\`${story.origin.ref}\`)` : "";
    lines.push(`## Origin`, "", `${label}${ref}:`, "");
    if (story.origin.quote !== undefined) lines.push(...quoteBlock(story.origin.quote), "");
    else lines.push("_Not captured before its source expired._", "");
  }

  if (story.planned_tickets !== undefined && story.planned_tickets.length > 0) {
    lines.push("## Published tickets", "");
    for (const ticket of story.planned_tickets) {
      lines.push(`- #${ticket.issue_number} — ${ticket.title}${ticket.ready ? " (ready)" : ""}`);
    }
    lines.push("");
  }

  lines.push("## Timeline", "");
  if (story.moments.length === 0) lines.push("_No pass records captured._", "");
  for (const moment of story.moments) {
    const model = moment.model !== undefined ? `, ${moment.model}` : "";
    lines.push(`- **${moment.at} — ${moment.headline}**${model === "" ? "" : ` _(model${model.replace(",", ":")})_`}`);
    const planEvidence = [
      moment.plan_version === undefined ? undefined : `plan v${moment.plan_version}`,
      moment.plan_step_id === undefined ? undefined : `step \`${moment.plan_step_id}\``,
      moment.assignment_source === undefined ? undefined : `assignment \`${moment.assignment_source}\``,
    ].filter((value): value is string => value !== undefined);
    if (planEvidence.length > 0) lines.push(`  - ${planEvidence.join(" · ")}`);
    if (moment.quote !== undefined) lines.push(...quoteBlock(moment.quote, "  "));
    lines.push(`  - evidence: \`${moment.evidence}\``);
  }
  lines.push("");

  if (story.delivery !== undefined) {
    lines.push("## Delivery", "");
    lines.push("| boundary | status | at | attempt |", "| --- | --- | --- | --- |");
    for (const stage of story.delivery.stages) {
      lines.push(`| ${stage.boundary} | ${stage.status} | ${stage.at} | ${stage.attempt} |`);
    }
    lines.push("");
    lines.push(
      `Journal status: **${story.delivery.status}**` +
        (story.delivery.outcome !== undefined ? ` — outcome: **${story.delivery.outcome}**` : ""),
      "",
    );
  }

  if (story.cost !== undefined) {
    const unmeasured =
      story.cost.unmeasured_turns > 0 ? ` (+${story.cost.unmeasured_turns} unmeasured turn(s))` : "";
    lines.push("## Cost", "", `$${story.cost.usd.toFixed(2)} settled across ${story.cost.provider_turns} provider turn(s)${unmeasured}.`, "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Time-ordered per-app index: month groups newest-first, stories
 *  newest-first inside each — "show me July" is a slice, the arcs stay
 *  whole in their own files. */
export function renderIndexMarkdown(app: string, stories: readonly NarrativeStory[]): string {
  const ordered = [...stories].sort(
    (a, b) => b.opened.localeCompare(a.opened) || a.story_id.localeCompare(b.story_id),
  );
  const lines: string[] = [`# ${app} — narrative index`, ""];
  const newest = ordered
    .map((s) => s.captured_at)
    .sort()
    .pop();
  if (newest !== undefined) lines.push(`_As of ${newest}_`, "");
  let month = "";
  for (const story of ordered) {
    const storyMonth = story.opened.slice(0, 7);
    if (storyMonth !== month) {
      month = storyMonth;
      lines.push(`## ${month}`, "");
    }
    const cost = story.cost !== undefined ? ` · $${story.cost.usd.toFixed(2)}` : "";
    const tickets =
      story.planned_tickets !== undefined && story.planned_tickets.length > 0
        ? ` · published ${story.planned_tickets.map((t) => `#${t.issue_number}`).join(" ")}`
        : "";
    const outcome = story.delivery?.outcome !== undefined ? ` · ${story.delivery.outcome}` : "";
    lines.push(
      `- ${story.opened.slice(0, 10)} · [${story.title}](${storySlug(story.story_id)}.md) · ${story.status}${outcome}${cost}${tickets}`,
    );
  }
  if (ordered.length === 0) lines.push("_No stories captured yet._");
  return lines.join("\n").trimEnd() + "\n";
}

function quoteBlock(quote: NarrativeQuote, indent = ""): string[] {
  const marker = quote.truncated ? " _(truncated)_" : "";
  const body = quote.text.split("\n").map((line) => `${indent}> ${line}`);
  return [`${indent}> _From \`${quote.source}\`${marker}:_`, ...body];
}
