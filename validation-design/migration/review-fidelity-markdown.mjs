const noComments = (value) => value.replace(/<!--[\s\S]*?-->/g, " ");

export const logical = (value) =>
  noComments(value)
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

export const cleanTitle = (value) =>
  value
    .replace(/\s+`\[[^`]+\]`.*$/, "")
    .replaceAll("**", "")
    .trim();

export function markdownSections(text, headingPattern, stopPattern) {
  const lines = text.split("\n");
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(headingPattern);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && !stopPattern.test(lines[end])) end += 1;
    sections.push({ match, text: lines.slice(index + 1, end).join("\n") });
  }
  return sections;
}

export function bulletBlocks(text) {
  const blocks = [];
  let current = [];
  for (const line of noComments(text).split("\n")) {
    if (/^- /.test(line)) {
      if (current.length) blocks.push(logical(current.join("\n")));
      current = [line];
    } else if (current.length && !/^##/.test(line)) current.push(line);
  }
  if (current.length) blocks.push(logical(current.join("\n")));
  return blocks.filter(Boolean);
}

export const paragraphs = (text) =>
  noComments(text)
    .split(/\n\s*\n/)
    .map(logical)
    .filter(Boolean);

export const firstClause = (text) =>
  bulletBlocks(text)[0] ?? paragraphs(text).find((item) => !/^#+\s/.test(item)) ?? logical(text);

export const sectionFacts = (text, heading = /^## (.+)$/, stop = /^## /) =>
  markdownSections(text, heading, stop)
    .map(({ match, text: body }) => ({
      heading: cleanTitle(match.at(-1)),
      body,
      fact: `${cleanTitle(match.at(-1))}: ${logical(body)}`,
    }))
    .filter((item) => item.fact.split(": ")[1]);

export function familyClause(value) {
  const normalized = logical(
    value.replace(
      /^Exact ratified legacy row \(archived line \d+; secret-shape-safe typography only\):\s*/,
      "Protected family contract: ",
    ),
  );
  return (
    normalized.match(/^Protected family contract:\s*\|\s*[^|]+\|\s*(.*?)\s*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|?$/)?.[1] ??
    normalized
  );
}
