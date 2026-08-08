// CF-IF-JOB (L1) — the `cormidia-job` CLI adapter surface.
//
// The second binary carries a DIFFERENT promise from `cormidia`, and the
// interface is where that promise is either kept or leaked. Three properties:
//
//   * every structural defect is a typed refusal BEFORE any runtime is
//     constructed — `explain` proves it, because it spends nothing by design;
//   * the error vocabulary is jobs-only. A refusal mentioning tickets,
//     episodes, pipelines or PRs would import guarantees `docs/jobs/design.md`
//     §3 explicitly withholds, and an operator would act on a promise that does
//     not exist;
//   * the packaged skill's own description routes PRODUCT work back to
//     `$cormidia`, so discovery does not quietly turn the ungoverned binary
//     into the governed one.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdJob, describeJobError } from "../../../src/jobs/cli.js";
import { JobConfigError } from "../../../src/jobs/config.js";
import { JobJournalError } from "../../../src/jobs/journal.js";
import { JobRunError } from "../../../src/jobs/runner.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cleanups: Array<() => Promise<void>> = [];

interface Captured {
  exitCode: number;
  stdout: string;
  stderr: string;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function invoke(argv: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const exitCode = await cmdJob(argv);
  return { exitCode, stdout, stderr };
}

async function configFile(name: string, yaml: string): Promise<string> {
  const fixture = await makeTempStateHome({ name });
  cleanups.push(fixture.cleanup);
  const path = join(fixture.stateHome, "job.yaml");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, yaml, "utf8");
  return path;
}

const VALID = `
job: research-sweep
description: fixture
steps:
  - id: gather
    objective: read the three input notes
    outputs:
      - path: outputs/notes.json
        check: json
  - id: synthesize
    dependsOn: [gather]
    objective: merge them
    outputs:
      - path: outputs/merged.json
        check: json
`;

const CYCLIC = `
job: cyclic
steps:
  - id: a
    dependsOn: [b]
    objective: one
  - id: b
    dependsOn: [a]
    objective: two
`;

describe("CF-IF-JOB (L1) parsing and exit codes", () => {
  it("prints usage and exits non-zero when invoked with no subcommand", async () => {
    const result = await invoke([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("cormidia-job run <config.yaml>");
  });

  it("prints usage and exits zero for --help", async () => {
    for (const flag of ["--help", "-h", "help"]) {
      const result = await invoke([flag]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cormidia-job explain");
    }
  });

  it("negative control: an unknown subcommand exits non-zero and names it", async () => {
    const result = await invoke(["dispatch"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown subcommand "dispatch"');
  });

  it("negative control: an unexpected argument and a flag with no value are typed errors", async () => {
    const path = await configFile("if-job-args", VALID);
    await expect(invoke(["run", path, "--nonsense"])).rejects.toThrow(/unexpected argument/);
    await expect(invoke(["run", path, "--workdir"])).rejects.toThrow(/--workdir requires a value/);
    await expect(invoke(["run"])).rejects.toThrow(/a job config path is required/);
  });
});

describe("CF-IF-JOB (L1) explain refuses before any runtime is constructed", () => {
  it("validates and prints the plan, spending nothing", async () => {
    const path = await configFile("if-job-explain", VALID);
    const result = await invoke(["explain", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("provider turns: 0; state writes: 0");
    expect(result.stdout).toContain("gather");
    expect(result.stdout).toContain("synthesize");
    expect(result.stdout).toContain("Not inherited: independent review");
  });

  it("reports the resolved --workdir, so declared outputs are never ambiguous", async () => {
    const path = await configFile("if-job-workdir", VALID);
    const result = await invoke(["explain", path, "--workdir", "/tmp/job-work"]);
    expect(result.stdout).toContain("Working directory: /tmp/job-work");
  });

  it("negative control: a cyclic config is refused at load, before any runtime exists", async () => {
    const path = await configFile("if-job-cyclic", CYCLIC);
    await expect(invoke(["explain", path])).rejects.toBeInstanceOf(JobConfigError);
  });

  it("negative control: an output path escaping the working directory is refused", async () => {
    const path = await configFile(
      "if-job-escape",
      `
job: escape
steps:
  - id: one
    objective: write outside
    outputs:
      - path: ../../etc/passwd
        check: exists
`,
    );
    await expect(invoke(["explain", path])).rejects.toBeInstanceOf(JobConfigError);
  });

  it("--json explain emits a machine-readable plan and still spends nothing", async () => {
    const path = await configFile("if-job-json", VALID);
    const result = await invoke(["explain", path, "--json"]);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; config: { steps: unknown[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.config.steps).toHaveLength(2);
  });
});

describe("CF-IF-JOB (L1) jobs-only error vocabulary", () => {
  const FORBIDDEN = [/\bticket\b/i, /\bepisode\b/i, /\bpipeline\b/i, /\bpull request\b/i, /\bPR\b/, /\bverdict\b/i];

  it("every typed error names its next step without importing product vocabulary", () => {
    const messages = [
      describeJobError(new JobConfigError("job_config_shape_invalid", "steps[0].id must be path-safe")),
      describeJobError(new JobJournalError("job_config_drifted", "this job's config changed since its last run")),
      describeJobError(
        new JobRunError("job_nested_invocation", "cormidia-job refuses to run inside a Cormidia provider turn"),
      ),
      describeJobError(new Error("something else went wrong")),
    ];
    for (const message of messages) {
      expect(message.startsWith("cormidia-job:")).toBe(true);
      for (const pattern of FORBIDDEN) expect(message).not.toMatch(pattern);
    }
  });

  it("the usage text itself states what jobs do not inherit", async () => {
    const result = await invoke(["--help"]);
    expect(result.stdout).toContain("no ticket, no PR, no GitHub, and no independent");
  });
});

describe("CF-IF-JOB (L1) packaged skill discovery routes product work back", () => {
  it("the $cormidia-job skill description sends product work to $cormidia", async () => {
    const skill = await readFile(join(repoRoot, "agent-skills", "cormidia-job", "SKILL.md"), "utf8");
    const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description).toContain("NOT for developing or operating a software product");
    expect(description).toContain("`cormidia` skill instead");
  });

  it("both packaged skills exist as directories with a SKILL.md", async () => {
    for (const name of ["cormidia", "cormidia-job"]) {
      const skill = await readFile(join(repoRoot, "agent-skills", name, "SKILL.md"), "utf8");
      expect(skill).toMatch(new RegExp(`^name:\\s*${name}$`, "m"));
    }
  });
});
