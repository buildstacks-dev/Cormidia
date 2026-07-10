export interface HomeFlags {
  orgHome?: string;
  stateHome?: string;
  rest: string[];
}

/** Remove common location flags before a subcommand parses its own arguments.
 * `--home` remains a compatibility alias for `--state-home`; new help and
 * generated instructions use the unambiguous names. */
export function extractHomeFlags(args: string[], command: string): HomeFlags {
  let orgHome: string | undefined;
  let stateHome: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--org-home") orgHome = needValue(args, ++i, command, arg);
    else if (arg === "--state-home" || arg === "--home") stateHome = needValue(args, ++i, command, arg);
    else rest.push(arg);
  }
  return {
    ...(orgHome !== undefined ? { orgHome } : {}),
    ...(stateHome !== undefined ? { stateHome } : {}),
    rest,
  };
}

function needValue(args: string[], index: number, command: string, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${command}: ${flag} requires a value`);
  return value;
}
