// Canonical placement contract for app-owned quality-gate commands.
//
// `.cormidia/config.yaml` contains an `apps:` registry-shaped mapping, but gate
// commands are properties of this checkout, not of the mirrored app entry.
// They therefore live only at the document top level. Keeping this check in
// the loop layer lets both the gate loader and the org-layer schema validator
// enforce the same path without reversing the org -> loop import direction.

const EXPLICIT_GATE_COMMAND_KEYS = ["setup_command", "test_command", "lint_command", "e2e_test_command"] as const;

const MAPPED_GATE_COMMAND_KEYS = ["install", "test", "lint", "e2e"] as const;

export function assertCanonicalGateCommandPlacement(raw: Record<string, unknown>, path: string): void {
  const apps = asRecord(raw["apps"]);
  if (apps === undefined) return;

  const misplaced: Array<{ from: string; to: string }> = [];
  for (const [app, value] of Object.entries(apps)) {
    const entry = asRecord(value);
    if (entry === undefined) continue;
    for (const key of EXPLICIT_GATE_COMMAND_KEYS) {
      if (Object.hasOwn(entry, key)) misplaced.push({ from: `apps.${app}.${key}`, to: key });
    }
    const commands = asRecord(entry["commands"]);
    if (commands === undefined) continue;
    for (const key of MAPPED_GATE_COMMAND_KEYS) {
      if (Object.hasOwn(commands, key)) {
        misplaced.push({ from: `apps.${app}.commands.${key}`, to: `commands.${key}` });
      }
    }
  }

  if (misplaced.length === 0) return;
  throw new Error(
    `${path}: gate command path(s) ${misplaced.map(({ from }) => JSON.stringify(from)).join(", ")} ` +
      `are invalid; declare ${misplaced.map(({ to }) => JSON.stringify(to)).join(", ")} at the top level of ` +
      `.cormidia/config.yaml (as siblings of "apps"), never under "apps.<name>"`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
