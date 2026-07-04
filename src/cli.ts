#!/usr/bin/env node
// Operon CLI. `loop` carries claude-loop's standalone UX forward as a
// subcommand (PURPOSE.md → Repo shape).

import { loadRoles } from "./org/roles.js";
import { getRuntime, RUNTIME_KINDS } from "./runtime/registry.js";
import { NotImplementedError } from "./runtime/types.js";

const USAGE = `operon — org runtime for a team of AI agents

Usage:
  operon roles [path]     validate roles.yaml and print the org chart
  operon doctor           check runtime adapter status
  operon loop             run the build loop over ready tickets (stub)
  operon run-role <name>  run one role turn now (stub)
`;

async function cmdRoles(path = "roles.yaml"): Promise<number> {
  const { roles, defaults } = await loadRoles(path);
  console.log(`${path}: OK — ${roles.length} roles, default turn budget $${defaults.maxTurnBudgetUsd}\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("ROLE", 12) + pad("RUNTIME", 9) + pad("MODEL", 22) + pad("EFFORT", 8) + "TRIGGERS");
  for (const r of roles) {
    const triggers = r.triggers.map((t) => t.schedule ?? `on:${t.event}`).join(", ") || "-";
    console.log(pad(r.name, 12) + pad(r.runtime, 9) + pad(r.model, 22) + pad(r.effort, 8) + triggers);
  }
  return 0;
}

function cmdDoctor(): number {
  console.log("runtime adapters:");
  for (const kind of RUNTIME_KINDS) {
    const rt = getRuntime(kind);
    console.log(`  ${rt.kind.padEnd(7)} stub — see research/2026-07-03_runtime-layer.md`);
  }
  return 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "roles":
        return await cmdRoles(rest[0]);
      case "doctor":
        return cmdDoctor();
      case "loop":
      case "run-role":
        throw new NotImplementedError(`command "${cmd}"`, "src/loop/loop.ts and src/org/");
      default:
        console.log(USAGE);
        return cmd ? 1 : 0;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
