// CF-B30 / CF-C-B30 — HB-128 — contracts/B-30-job-config-journal.md, CORMIDIA-C-B30-001 §1.

// CF-B30-CFG (L1) — job config authority (CORMIDIA-C-B30-001 §1).
//
// Every structural defect must be caught before any runtime is constructed, so
// each case here asserts a typed refusal rather than a downstream failure. The
// negative controls seed the exact violations named in the harness revision
// proposal §Phase 8: cycle, unknown dependency, duplicate id, ambiguous kind.

import { describe, expect, it } from "vitest";
import { JobConfigError, parseJobConfig } from "../../../../src/jobs/config.js";

const PATH = "job.yaml";

function parse(yaml: string): ReturnType<typeof parseJobConfig> {
  return parseJobConfig(yaml, PATH);
}

function refusal(yaml: string): JobConfigError {
  try {
    parse(yaml);
  } catch (error) {
    if (error instanceof JobConfigError) return error;
    throw error;
  }
  throw new Error("expected a JobConfigError, but the config loaded");
}

const MINIMAL = `
job: demo
steps:
  - id: only
    objective: do the thing
`;

describe("CF-B30-CFG (L1) job config authority", () => {
  it("accepts a minimal single-step config and defaults app to unscoped", () => {
    const config = parse(MINIMAL);
    expect(config.job).toBe("demo");
    expect(config.app).toBeNull();
    expect(config.steps).toHaveLength(1);
    expect(config.steps[0]).toMatchObject({ kind: "provider", id: "only", dependsOn: [], outputs: [] });
  });

  it("parses a dependency graph, assignments, checks, and checkpoints together", () => {
    const config = parse(`
job: q3-cascade
app: sonnet8-buildstack-dev
description: board strategy cascade
steps:
  - id: frame
    objective: write the framing questions
    assignment: { harness: claude, model: claude-opus-4-8, effort: xhigh }
    outputs:
      - path: outputs/framing.md
        check: non_empty
  - id: team-platform
    dependsOn: [frame]
    objective: answer for platform
    assignment: { harness: codex, model: gpt-5.6-sol, effort: high }
    outputs:
      - path: outputs/platform.json
        check: json
  - id: review
    dependsOn: [team-platform]
    checkpoint:
      prompt: read the updates before synthesis
`);
    expect(config.app).toBe("sonnet8-buildstack-dev");
    const [frame, platform, review] = config.steps;
    expect(frame).toMatchObject({
      assignment: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
      outputs: [{ path: "outputs/framing.md", check: { kind: "non_empty" } }],
    });
    expect(platform).toMatchObject({ dependsOn: ["frame"], outputs: [{ check: { kind: "json" } }] });
    expect(review).toMatchObject({ kind: "checkpoint", prompt: "read the updates before synthesis" });
  });

  it("produces a config hash that is stable under formatting and sensitive to content", () => {
    const reformatted = parse(`
job:    demo
steps:
  - objective: do the thing
    id: only
`);
    expect(reformatted.configHash).toBe(parse(MINIMAL).configHash);

    const changed = parse(`
job: demo
steps:
  - id: only
    objective: do a DIFFERENT thing
`);
    expect(changed.configHash).not.toBe(parse(MINIMAL).configHash);
  });

  it("hashes the graph, not the prose: description changes do not invalidate a journal", () => {
    const described = parse(`${MINIMAL}description: some prose\n`);
    expect(described.configHash).toBe(parse(MINIMAL).configHash);
  });

  it("negative control: a dependency cycle is refused at load, naming every involved step", () => {
    const error = refusal(`
job: cyclic
steps:
  - id: a
    dependsOn: [c]
    objective: first
  - id: b
    dependsOn: [a]
    objective: second
  - id: c
    dependsOn: [b]
    objective: third
`);
    expect(error.code).toBe("job_dependency_cycle");
    expect(error.message).toContain("a, b, c");
  });

  it("negative control: a self-dependency is refused", () => {
    expect(
      refusal(`
job: selfdep
steps:
  - id: a
    dependsOn: [a]
    objective: loop
`).code,
    ).toBe("job_dependency_cycle");
  });

  it("negative control: an unknown dependency is refused, naming both steps", () => {
    const error = refusal(`
job: dangling
steps:
  - id: a
    dependsOn: [nope]
    objective: first
`);
    expect(error.code).toBe("job_dependency_unknown");
    expect(error.message).toContain('"a"');
    expect(error.message).toContain('"nope"');
  });

  it("negative control: a duplicate step id is refused", () => {
    expect(
      refusal(`
job: dup
steps:
  - id: same
    objective: first
  - id: same
    objective: second
`).code,
    ).toBe("job_step_id_duplicate");
  });

  it("negative control: a step that is both provider and checkpoint is refused", () => {
    expect(
      refusal(`
job: ambiguous
steps:
  - id: both
    objective: do it
    checkpoint:
      prompt: also pause
`).code,
    ).toBe("job_step_kind_ambiguous");
  });

  it("negative control: a step that is neither provider nor checkpoint is refused", () => {
    expect(
      refusal(`
job: empty
steps:
  - id: neither
    dependsOn: []
`).code,
    ).toBe("job_step_kind_ambiguous");
  });

  it("negative control: a checkpoint declaring outputs or an assignment is refused", () => {
    for (const extra of ["outputs:\n      - path: x.md", "assignment: { harness: pi, model: m, effort: low }"]) {
      expect(
        refusal(`
job: ckpt
steps:
  - id: pause
    checkpoint:
      prompt: hold
    ${extra}
`).code,
      ).toBe("job_step_kind_ambiguous");
    }
  });

  it("negative control: an unknown harness or effort is refused rather than defaulted", () => {
    expect(
      refusal(`
job: badharness
steps:
  - id: a
    objective: x
    assignment: { harness: gemini, model: m, effort: high }
`).code,
    ).toBe("job_assignment_invalid");
    expect(
      refusal(`
job: badeffort
steps:
  - id: a
    objective: x
    assignment: { harness: pi, model: m, effort: extreme }
`).code,
    ).toBe("job_assignment_invalid");
  });

  it("negative control: an output path escaping the working directory is refused", () => {
    for (const bad of ["/etc/passwd", "../outside.md", "nested/../../outside.md"]) {
      const error = refusal(`
job: escape
steps:
  - id: a
    objective: x
    outputs:
      - path: "${bad}"
`);
      expect(error.code, bad).toBe("job_output_invalid");
    }
  });

  it("negative control: an unknown check name is refused rather than silently skipped", () => {
    const error = refusal(`
job: badcheck
steps:
  - id: a
    objective: x
    outputs:
      - path: out.md
        check: probably_fine
`);
    expect(error.code).toBe("job_output_invalid");
    expect(error.message).toContain("non_empty");
  });

  it("negative control: a non-path-safe job or step id is refused", () => {
    expect(refusal("job: ../escape\nsteps:\n  - id: a\n    objective: x\n").code).toBe("job_config_shape_invalid");
    expect(refusal("job: ok\nsteps:\n  - id: has/slash\n    objective: x\n").code).toBe("job_step_id_invalid");
  });

  it("negative control: an empty step list is refused", () => {
    expect(refusal("job: nosteps\nsteps: []\n").code).toBe("job_config_shape_invalid");
  });

  it("negative control: malformed YAML and a non-mapping document are refused", () => {
    expect(refusal("job: [unclosed\n").code).toBe("job_config_shape_invalid");
    expect(refusal("- just\n- a\n- list\n").code).toBe("job_config_shape_invalid");
  });
});
