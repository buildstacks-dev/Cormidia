// CF-REG-332 — HB-139 — case-catalog.md §10.3, defect #332.

// CF-REG-332 — the upstream-freshness probe, run offline against the recorded
// corpus in `tests/fixtures/harness-freshness/`.
//
// The probe is repository automation, so it belongs to the harness self-test
// register (CF-HARNESS-CI) rather than a product boundary, and it is exercised
// exactly as `pnpm check`'s gates are: the real `.mjs` as a subprocess.
//
// Nothing here touches the network. `--fixtures` swaps the fetcher for recorded
// payloads, and every scenario's metadata snapshot is copied to a temp file so
// `--apply` can never write the repository's own.

import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const probe = join(repoRoot, "scripts", "harness-freshness.mjs");
const corpus = join(repoRoot, "tests", "fixtures", "harness-freshness");
const NOW = "2026-08-07T00:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Delta {
  kind: string;
  harness: string;
  severity: string;
  detail: string;
  proposal: { path: (string | number)[] } | null;
}

interface Report {
  status: "fresh" | "delta" | "failed";
  deltas: Delta[];
  failures: { harness: string; sourceId: string; reason: string }[];
  unautomated: { harness: string; sourceId: string }[];
  checked: { harness: string; sourceId: string; version: string }[];
  proposals: string[];
  metadataChanged: boolean;
  pullRequestPlan?: { wouldOpen: boolean; branch: string; protectedPaths: string[] };
}

/** Copy the scenario's snapshot somewhere writable: `--apply` must never be
 *  pointed at the repository's own metadata from a test. */
async function scenarioMetadata(scenario: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-freshness-"));
  roots.push(root);
  const source = join(corpus, scenario, "metadata.json");
  const target = join(root, "metadata.json");
  await copyFile(
    await fileExists(source).then((yes) => (yes ? source : join(corpus, "base", "metadata.json"))),
    target,
  );
  return target;
}

async function fileExists(path: string): Promise<boolean> {
  return await readFile(path).then(
    () => true,
    () => false,
  );
}

interface ProbeRun {
  exitCode: number;
  report: Report;
  /** The writable snapshot copy the run was pointed at. */
  metadataPath: string;
}

/** The real script as a subprocess, exactly as `pnpm check`'s gates are run. */
async function raw(extra: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = [probe, "--now", NOW, "--json", "--no-format", ...extra];
  return await new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", fail);
    child.on("close", (code) => done({ exitCode: code ?? -1, stdout, stderr }));
  });
}

async function run(scenario: string, extra: string[] = []): Promise<ProbeRun> {
  const metadataPath = await scenarioMetadata(scenario);
  const result = await raw(["--fixtures", join(corpus, scenario), "--metadata", metadataPath, ...extra]);
  expect(result.stderr, `scenario ${scenario} wrote to stderr`).toBe("");
  return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as Report, metadataPath };
}

function kinds(report: Report): string[] {
  return report.deltas.map((item) => item.kind).sort();
}

describe("CF-REG-332 — upstream freshness probe (offline, recorded fixtures)", () => {
  it("baseline corpus: no change, no delta, no pull request, exit 0", async () => {
    const { exitCode, report } = await run("base");
    expect(report.status).toBe("fresh");
    expect(report.deltas).toEqual([]);
    expect(report.metadataChanged).toBe(false);
    expect(exitCode).toBe(0);
    // Every automated source actually answered — a "fresh" verdict over an
    // empty read set would be green by absence.
    expect(report.checked.length).toBeGreaterThanOrEqual(10);
    expect(new Set(report.checked.map((item) => item.harness))).toEqual(
      new Set(["claude", "codex", "pi", "opencode", "grok"]),
    );
  });

  it("the two installer-shipped harnesses are reported as un-automated, never as fresh", async () => {
    const { report } = await run("base");
    expect(report.unautomated.map((item) => item.harness).sort()).toEqual(["cursor", "muse"]);
  });

  it("version drift is REPORTED and the tested-with band is never proposed for a bump", async () => {
    const { exitCode, report } = await run("version-drift");
    expect(report.status).toBe("delta");
    expect(exitCode).toBe(3);
    expect(kinds(report)).toEqual(["upstream_version_changed", "version_drift"]);
    const drift = report.deltas.find((item) => item.kind === "version_drift")!;
    expect(drift.detail).toContain("newer than tested-with 0.147.0");
    expect(drift.detail).toContain("re-certification owed");
    // The only writable target is the observed-version snapshot. Nothing in the
    // proposal set may point at a band.
    expect(drift.proposal).toBeNull();
    for (const item of report.deltas) {
      expect(item.proposal?.path.join(".") ?? "").not.toContain("testedWith");
      expect(item.proposal?.path.join(".") ?? "").not.toContain("floor");
    }
  });

  it("a repriced model becomes an exact old→new metadata delta", async () => {
    const { report } = await run("price-change");
    expect(kinds(report)).toEqual(["price_change", "pricing_source_changed"]);
    const change = report.deltas.find((item) => item.kind === "price_change")!;
    expect(change.detail).toBe("gpt-5.4: inputPerMTok 2.5 → 3, outputPerMTok 15 → 18");
    expect(change.proposal?.path).toEqual(["harnesses", "codex", "pricing", "rows", 4, "price"]);
  });

  it("a newly published model is a metadata delta plus a roles.yaml PROPOSAL, never an edit", async () => {
    const { report } = await run("new-model");
    expect(kinds(report)).toContain("new_model");
    const added = report.deltas.find((item) => item.kind === "new_model")!;
    expect(added.detail).toBe("new: muse-spark-1.3");
    expect(added.proposal?.path).toEqual(["harnesses", "muse", "roster", "models"]);
    expect(report.proposals.join(" ")).toContain("never assigns a model to a role");
  });

  it("a retired model is flagged with an explicit ratified-surface warning", async () => {
    const { report } = await run("retired-model");
    expect(kinds(report)).toContain("retired_model");
    expect(report.deltas.find((item) => item.kind === "retired_model")!.detail).toBe(
      "no longer published: muse-spark-1.1",
    );
    expect(report.proposals.join(" ")).toContain("never edits ratified surfaces");
  });

  it("negative control: a seeded STALE snapshot makes every detector fire", async () => {
    // Byte-identical payloads to the baseline; only the committed snapshot is
    // stale. If this reports fresh, the diff is not comparing anything.
    const { exitCode, report } = await run("stale-snapshot");
    expect(report.status).toBe("delta");
    expect(exitCode).toBe(3);
    expect(kinds(report)).toEqual(["new_model", "price_change", "pricing_source_changed", "upstream_version_changed"]);
    expect(report.metadataChanged).toBe(true);
  });

  it("negative control: an unreachable source fails closed and is never reported as fresh", async () => {
    const { exitCode, report } = await run("unreachable");
    expect(report.status).toBe("failed");
    expect(exitCode).toBe(1);
    expect(report.failures.map((item) => item.sourceId).sort()).toEqual(["codex.npm", "cursor.pricing"]);
    expect(report.failures.some((item) => item.reason.includes("503"))).toBe(true);
    expect(report.status).not.toBe("fresh");
  });

  it("negative control: a 200 response the probe cannot read is a failure, not a silent pass", async () => {
    const { exitCode, report } = await run("malformed");
    expect(report.status).toBe("failed");
    expect(exitCode).toBe(1);
    const reasons = Object.fromEntries(report.failures.map((item) => [item.sourceId, item.reason]));
    expect(reasons["codex.npm"]).toContain("no readable version");
    // An empty roster parse must never be read as "the vendor retired
    // everything" — that is how a moved page would silently empty a roster.
    expect(reasons["muse.roster"]).toContain("no model id matched");
    expect(kinds(report)).not.toContain("retired_model");
  });

  it("a failed probe proposes no pull request even though it also saw a delta", async () => {
    const { report } = await run("malformed", ["--dry-run-pr"]);
    expect(report.status).toBe("failed");
    expect(report.pullRequestPlan?.wouldOpen).toBe(false);
  });

  it("a delta plans exactly one pull request and names the surfaces it may not touch", async () => {
    const { report } = await run("price-change", ["--dry-run-pr"]);
    expect(report.pullRequestPlan?.wouldOpen).toBe(true);
    expect(report.pullRequestPlan?.branch).toBe("chore/harness-freshness");
    expect(report.pullRequestPlan?.protectedPaths).toEqual([
      "roles.yaml",
      "TASTE.md",
      "docs/PURPOSE.md",
      "pipelines.yaml",
      "prompts/",
      "src/runtime/harness-support.ts",
    ]);
  });

  it("a fresh probe plans no pull request at all", async () => {
    const { report } = await run("base", ["--dry-run-pr"]);
    expect(report.pullRequestPlan?.wouldOpen).toBe(false);
    expect(report.metadataChanged).toBe(false);
  });

  it("--apply writes the proposed figures into the snapshot and leaves the band file byte-identical", async () => {
    const bandsPath = join(repoRoot, "src", "runtime", "harness-support.ts");
    const bandsBefore = await readFile(bandsPath, "utf8");
    const { metadataPath } = await run("price-change", ["--apply"]);
    const written = JSON.parse(await readFile(metadataPath, "utf8"));
    const row = written.harnesses.codex.pricing.rows[4];
    expect(row.prefix).toBe("gpt-5.4");
    expect(row.price).toEqual({ inputPerMTok: 3, outputPerMTok: 18 });
    expect(await readFile(bandsPath, "utf8")).toBe(bandsBefore);
  });

  it("--apply on a failed probe writes nothing: a partial read never rewrites the snapshot", async () => {
    const { metadataPath } = await run("malformed", ["--apply"]);
    const written = JSON.parse(await readFile(metadataPath, "utf8"));
    const baseline = JSON.parse(await readFile(join(corpus, "base", "metadata.json"), "utf8"));
    expect(written).toEqual(baseline);
  });

  it("negative control: a band declaration the reader cannot parse aborts loudly, never 'no drift'", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-freshness-bands-"));
    roots.push(root);
    const support = join(root, "harness-support.ts");
    // The real file's shape is what the probe measures drift from. If the
    // reader ever silently returned {} the version half of the probe would go
    // quiet while still reporting "fresh" — the exact laundering this suite
    // exists to prevent.
    await writeFile(support, "export const SOMETHING_ELSE = { claude: { floor: '1.0.0' } };\n", "utf8");
    const result = await raw(["--fixtures", join(corpus, "base"), "--support", support]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no HARNESS_SUPPORT declaration found");
    expect(result.stdout).toBe("");
  });

  it("negative control: the commit guard refuses a tree that touched a ratified surface", async () => {
    // The guard is what stands between a scheduled unattended run and an
    // automated edit to a human-ratified file, so it is exercised directly
    // rather than trusted because the happy path never reaches it.
    const probeGuard = async (changed: string[]): Promise<string> => {
      const source =
        `import { assertOnlyWritablePaths } from ${JSON.stringify(probe)};\n` +
        `try { assertOnlyWritablePaths(${JSON.stringify(changed)}); console.log("ALLOWED"); }\n` +
        `catch (error) { console.log("REFUSED: " + error.message); }\n`;
      const root = await mkdtemp(join(tmpdir(), "cormidia-freshness-guard-"));
      roots.push(root);
      const script = join(root, "guard.mjs");
      await writeFile(script, source, "utf8");
      const result = await new Promise<string>((done, fail) => {
        const child = spawn(process.execPath, [script], { cwd: repoRoot, stdio: ["ignore", "pipe", "inherit"] });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.on("error", fail);
        child.on("close", () => done(stdout.trim()));
      });
      return result;
    };

    expect(await probeGuard(["src/runtime/harness-metadata.json"])).toBe("ALLOWED");
    expect(await probeGuard([])).toBe("ALLOWED");
    for (const ratified of ["roles.yaml", "TASTE.md", "docs/PURPOSE.md", "pipelines.yaml", "prompts/builder.md"]) {
      const verdict = await probeGuard(["src/runtime/harness-metadata.json", ratified]);
      expect(verdict, `${ratified} was not refused`).toContain("REFUSED");
      expect(verdict).toContain("HUMAN-RATIFIED");
    }
    // Moving a band is a certification claim, so the band file is guarded too.
    expect(await probeGuard(["src/runtime/harness-support.ts"])).toContain("HUMAN-RATIFIED");
    // …and anything else outside the one writable path is refused on principle.
    expect(await probeGuard(["src/runtime/adapters/codex.ts"])).toContain("REFUSED");
  });

  it("negative control: bands and metadata that disagree about the harness set abort", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-freshness-bands-"));
    roots.push(root);
    const support = join(root, "harness-support.ts");
    await writeFile(
      support,
      "export const HARNESS_SUPPORT = { claude: { floor: '0.3.201', testedWith: '0.3.224' } };\n",
      "utf8",
    );
    const result = await raw(["--fixtures", join(corpus, "base"), "--support", support]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("harness sets disagree");
  });
});
