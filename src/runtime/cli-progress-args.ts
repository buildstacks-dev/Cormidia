// Shared long-running-command progress flags for both packaged executables.

export type CliProgressMode = "text" | "jsonl" | "off";

export interface ExtractedProgressArgs {
  rest: string[];
  mode: CliProgressMode;
}

export function extractProgressArgs(args: readonly string[], command: string): ExtractedProgressArgs {
  const rest: string[] = [];
  let mode: CliProgressMode = "text";
  let selected = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--quiet") {
      if (selected && mode !== "off") throw new Error(`${command}: --quiet conflicts with --progress=${mode}`);
      mode = "off";
      selected = true;
      continue;
    }
    if (arg === "--progress" || arg.startsWith("--progress=")) {
      const value = arg === "--progress" ? args[index + 1] : arg.slice("--progress=".length);
      if (arg === "--progress") index += 1;
      if (value !== "text" && value !== "jsonl" && value !== "off") {
        throw new Error(`${command}: --progress must be text | jsonl | off`);
      }
      if (selected && value !== mode) throw new Error(`${command}: progress mode was supplied more than once`);
      mode = value;
      selected = true;
      continue;
    }
    rest.push(arg);
  }
  return { rest, mode };
}
