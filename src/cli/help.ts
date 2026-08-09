export type HelpGroup = "setup" | "onboarding" | "delivery" | "operations" | "governance" | "inspection";

interface HelpGroupDescription {
  name: HelpGroup;
  title: string;
  summary: string;
}

interface HelpCommand {
  command: string;
  group: HelpGroup;
  summary: string;
}

const HELP_GROUPS: readonly HelpGroupDescription[] = [
  { name: "setup", title: "Org setup", summary: "Create, select, configure, and validate an org." },
  { name: "onboarding", title: "App onboarding", summary: "Register, verify, promote, reset, or create an app." },
  { name: "delivery", title: "Planning and delivery", summary: "Plan work and advance it through governed delivery." },
  { name: "operations", title: "Operations", summary: "Run scheduling, budgets, retention, tasks, and learning." },
  { name: "governance", title: "Approvals and release", summary: "Manage authority, approvals, and release evidence." },
  { name: "inspection", title: "Inspection", summary: "Inspect configuration, activity, evidence, and reports." },
];

export function renderTopLevelHelp(): string {
  return [
    "cormidia — org runtime for a team of AI agents",
    "",
    "Usage:",
    "  cormidia <command> [options]",
    "  cormidia <task> --help",
    "",
    "Common starting actions:",
    "  cormidia org init <path> --name <name>   create and select an org",
    "  cormidia bootstrap <app-path>            onboard an existing app",
    "  cormidia plan <app> --dry-run            preview planning without tokens",
    "  cormidia status                          inspect recent activity",
    "",
    "Help by task:",
    ...HELP_GROUPS.map((group) => `  cormidia ${group.name.padEnd(11)} --help  ${group.title}: ${group.summary}`),
    "",
    "Next layers:",
    "  cormidia <task> --help      commands for one operator task",
    "  cormidia <command> --help   complete syntax, constraints, and safety notes",
    "",
    "Machine discovery:",
    "  cormidia capabilities --json   exhaustive stable command metadata",
    "  cormidia context --json        resolved org, paths, authority, and apps",
  ].join("\n");
}

export function renderIntentHelp(groupName: string, commands: readonly HelpCommand[]): string | undefined {
  const group = HELP_GROUPS.find((candidate) => candidate.name === groupName);
  if (group === undefined) return undefined;
  const members = commands
    .filter((command) => command.group === group.name)
    .toSorted((left, right) => left.command.localeCompare(right.command, "en"));
  if (members.length === 0) throw new Error(`help group ${group.name} has no commands`);
  const width = Math.max(...members.map((command) => command.command.length));
  return [
    `Cormidia help: ${group.title}`,
    group.summary,
    "",
    "Commands:",
    ...members.map((command) => `  cormidia ${command.command.padEnd(width)}  ${command.summary}`),
    "",
    "Run `cormidia <command> --help` for complete syntax, constraints, and safety notes.",
    "Run `cormidia capabilities --json` for exhaustive machine-readable discovery.",
  ].join("\n");
}
