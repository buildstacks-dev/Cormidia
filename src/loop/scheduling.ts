// Ticket-level scheduling (M5.7): dependency-aware, scope-overlap
// conservative, bounded by the org WIP limit. Pure data in, pure data out.

export interface SchedulableTicket {
  id: number;
  phase: "ready" | "building" | "gates" | "reviewing" | "shipping" | "merged" | "returned" | "blocked";
  dependsOn?: readonly number[];
  scope?: readonly string[];
  priority?: number;
}

export function selectReadyTickets(tickets: readonly SchedulableTicket[], maxConcurrent: number): SchedulableTicket[] {
  const cap = Math.max(0, Math.trunc(maxConcurrent));
  if (cap === 0) return [];

  const merged = new Set(tickets.filter((t) => t.phase === "merged").map((t) => t.id));
  const selected: SchedulableTicket[] = [];
  const selectedScopes: string[] = [];

  const candidates = [...tickets]
    .filter((ticket) => ticket.phase === "ready")
    .filter((ticket) => (ticket.dependsOn ?? []).every((dep) => merged.has(dep)))
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));

  for (const ticket of candidates) {
    if (selected.length >= cap) break;
    const scope = [...(ticket.scope ?? [])];
    if (scope.length > 0 && selectedScopes.some((existing) => scope.includes(existing))) continue;
    selected.push(ticket);
    selectedScopes.push(...scope);
  }
  return selected;
}

export function parseDependsOn(text: string): number[] {
  const deps = new Set<number>();
  for (const match of text.matchAll(/\bDepends-on:\s*#(\d+)/gi)) {
    deps.add(Number(match[1]));
  }
  return [...deps].sort((a, b) => a - b);
}

export function parseScope(text: string): string[] {
  const scope = new Set<string>();
  const section = headingSection(text, "Scope");
  if (section === undefined) return [];
  for (const line of section.split("\n")) {
    const match = /^\s*[-*]\s+`?([^`\s][^`]*)`?\s*$/.exec(line);
    if (match?.[1] !== undefined) scope.add(match[1].trim());
  }
  return [...scope];
}

function headingSection(text: string, heading: string): string | undefined {
  const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im");
  const match = re.exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
