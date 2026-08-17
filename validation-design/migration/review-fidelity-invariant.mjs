import { cleanTitle, logical, markdownSections } from "./review-fidelity-markdown.mjs";

export const expectedInvariantIds = [
  ...Array.from({ length: 17 }, (_, index) => `CORMIDIA-INV-${String(index + 1).padStart(3, "0")}`),
  ...["1", "2", "3", "4", "5", "6", "7a", "7b"].map((suffix) => `CORMIDIA-INV-ACC-${suffix}`),
];

const LABEL =
  /\*\*(Enforcement\.|Falsifying test shape\.|Adversarial seeds\.|Negative control(?: \(mandatory\))?:)\*\*/g;

function labeledFacts(body) {
  const normalized = logical(body.replace(/\n---\s*$/, ""));
  const markers = [...normalized.matchAll(LABEL)];
  return markers.map((marker, index) => {
    const label = marker[1]
      .replace(/\.$/, "")
      .replace(/:\s*$/, "")
      .replace(/ \(mandatory\)$/, "");
    const start = (marker.index ?? 0) + marker[0].length;
    const end = markers[index + 1]?.index ?? normalized.length;
    return { label, fact: `${label}: ${normalized.slice(start, end).trim()}` };
  });
}

export function invariantFacts(invariantsText) {
  return markdownSections(invariantsText, /^## (CORMIDIA-INV-(?:\d{3}|ACC-(?:[1-6]|7[ab]))) — (.+)$/, /^#{1,2} /).map(
    ({ match, text }) => {
      const normalized = logical(text.replace(/\n---\s*$/, ""));
      const statement = normalized.match(/\*\*Statement\.\*\*\s*([\s\S]*?)(?=\*\*Enforcement\.\*\*)/)?.[1]?.trim();
      const facts = labeledFacts(text);
      return {
        id: match[1],
        title: cleanTitle(match[2]),
        meaning: statement ?? "",
        acceptance_criteria: facts.filter(({ label }) => label === "Enforcement").map(({ fact }) => fact),
        failure_modes: facts.filter(({ label }) => label !== "Enforcement").map(({ fact }) => fact),
      };
    },
  );
}
