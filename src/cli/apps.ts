// `operon apps [path]` — validate apps.yaml and print the app registry.

import { loadApps } from "../org/apps.js";

export async function cmdApps(path = "apps.yaml"): Promise<number> {
  const { org, defaults, apps } = await loadApps(path);
  console.log(
    `${path}: OK — ${apps.length} app${apps.length === 1 ? "" : "s"}, ` +
      `org "${org.name}", WIP limit ${org.maxConcurrentTurns}, ` +
      `default budget $${defaults.budgetUsdMonth}/mo\n`,
  );
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("APP", 14) + pad("REPO", 42) + pad("STATUS", 12) + "BUDGET");
  for (const a of apps) {
    const cadence = Object.keys(a.cadence).length
      ? `  (cadence overrides: ${Object.keys(a.cadence).join(", ")})`
      : "";
    console.log(
      pad(a.name, 14) + pad(a.repo, 42) + pad(a.status, 12) + `$${a.budgetUsdMonth}/mo` + cadence,
    );
  }
  return 0;
}
