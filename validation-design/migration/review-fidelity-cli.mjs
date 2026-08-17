import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import { fidelityConfig } from "./review-fidelity-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const designRoot = join(here, "..");
const repoRoot = join(designRoot, "..");

export async function runReviewFidelityCli({ applyReviewFidelity, assertReviewFidelity }) {
  const [reviewText, catalogMarkdown, backlogMarkdown, systemMapText, journeyAcceptanceText, boundaryMapText] =
    await Promise.all([
      readFile(join(here, "review.yaml"), "utf8"),
      readFile(join(here, "legacy", "case-catalog.md"), "utf8"),
      readFile(join(here, "legacy", "harness-backlog.md"), "utf8"),
      readFile(join(designRoot, "system-map.md"), "utf8"),
      readFile(join(designRoot, "contracts", "journey-acceptance.md"), "utf8"),
      readFile(join(designRoot, "boundary-map.md"), "utf8"),
    ]);
  const parsedReview = parse(reviewText);
  const sources = [...parsedReview.sources, ...fidelityConfig.sources].filter(
    (source, index, all) => source.path && all.findIndex((item) => item.id === source.id) === index,
  );
  const sourceTexts = Object.fromEntries(
    await Promise.all(sources.map(async (source) => [source.id, await readFile(join(repoRoot, source.path), "utf8")])),
  );
  const review = applyReviewFidelity({
    review: parsedReview,
    catalogMarkdown,
    backlogMarkdown,
    systemMapText,
    journeyAcceptanceText,
    boundaryMapText,
    sourceTexts,
  });
  const input = {
    review,
    catalogMarkdown,
    backlogMarkdown,
    systemMapText,
    journeyAcceptanceText,
    boundaryMapText,
    sourceTexts,
  };
  assertReviewFidelity(input);
  await writeFile(
    join(here, "review.yaml"),
    `# Static reviewed input for validation-architect 0.4.6 final cutover; deterministically normalized by review-fidelity.mjs.\n# Product revision is the exact squash of prerequisite PR #476.\n${stringify(input.review, { lineWidth: 0 })}`,
    "utf8",
  );
  const unresolved = input.review.structures
    .filter((structure) => !structure.changed_paths?.length)
    .map((structure) => structure.id);
  process.stdout.write(
    `review fidelity normalized; ${unresolved.length} structures have no reviewed implementation impact map and widen to full-suite planning: ${unresolved.join(", ")}\n`,
  );
}
