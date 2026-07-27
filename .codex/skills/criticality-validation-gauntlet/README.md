# Criticality Validation Gauntlet

A reusable Agent Skill and standalone reviewer prompt for moving an existing codebase toward evidence-backed validation appropriate to the consequences of failure.

The skill treats project criticality as the governing input. It does not apply one universal checklist to a local developer tool, a multi-tenant cloud service, and a mission-critical control system.

## What it does

The workflow can:

- Establish intended use and system boundary.
- Classify system, component, and change criticality.
- Reconstruct the behavioral and operational validation contract.
- Evaluate the strength of existing tests and non-test evidence.
- Build a risk-ranked validation plan.
- Add tests, harnesses, CI gates, and limited testability improvements.
- Run an independent or role-separated verification pass.
- Produce a reproducible assurance package and scoped release verdict.

## Files

```text
criticality-validation-gauntlet/
├── SKILL.md
├── STANDALONE_REVIEWER_PROMPT.md
├── references/
│   ├── criticality-model.md
│   ├── validation-techniques.md
│   ├── test-quality-rubric.md
│   ├── evidence-and-verdicts.md
│   ├── independent-verification.md
│   ├── ai-agent-systems.md
│   └── examples/
│       ├── local-dev-tool.md
│       ├── cloud-service.md
│       └── space-mission.md
├── assets/templates/
├── scripts/
└── evals/
```

## Install for Codex

Repository-scoped:

```bash
mkdir -p .agents/skills
cp -R /path/to/criticality-validation-gauntlet \
  .agents/skills/criticality-validation-gauntlet
```

User-scoped:

```bash
mkdir -p ~/.agents/skills
cp -R /path/to/criticality-validation-gauntlet \
  ~/.agents/skills/criticality-validation-gauntlet
```

Invoke explicitly with a prompt such as:

```text
Use $criticality-validation-gauntlet in full mode. Harden this repository for its stated production target.
```

## Install for Claude Code

Repository-scoped:

```bash
mkdir -p .claude/skills
cp -R /path/to/criticality-validation-gauntlet \
  .claude/skills/criticality-validation-gauntlet
```

User-scoped:

```bash
mkdir -p ~/.claude/skills
cp -R /path/to/criticality-validation-gauntlet \
  ~/.claude/skills/criticality-validation-gauntlet
```

Invoke with:

```text
/criticality-validation-gauntlet full
```

The folder can be copied to both locations or stored once and symlinked when the operating system and workspace policy permit it.

## Standalone use

Paste `STANDALONE_REVIEWER_PROMPT.md` into an agent that can inspect and operate on the repository. The standalone prompt defaults to `full` mode and begins by presenting a validation charter before executing.

## Modes

- `profile`: criticality and assurance target.
- `assess`: read-only audit and gap analysis.
- `design`: validation architecture and plan.
- `harden`: implement approved validation improvements.
- `verify`: independent verification of a pinned revision.
- `full`: end-to-end lifecycle.

## Recommended first use

Start with an existing repository and invoke:

```text
Use $criticality-validation-gauntlet in assess mode. Infer the intended operating context from repository evidence, classify system/component/change criticality, and show me the proposed assurance target before running invasive commands.
```

After reviewing the profile and plan:

```text
Continue in full mode. Implement the approved hardening, preserve evidence, and use a fresh verification pass before issuing the release assessment.
```

## Output

The default output is a run-specific directory:

```text
.validation/<timestamp>-<short-revision>/
```

It contains the assurance profile, system map, validation contract, traceability matrix, risk register, plan, findings, evidence report, and release assessment.

## Helper scripts

Initialize a workspace:

```bash
python scripts/init_assurance_workspace.py --root /path/to/repo --mode full
```

Record a command and its result:

```bash
python scripts/record_command.py \
  --output .validation/<run>/evidence \
  --name test-suite \
  --cwd /path/to/repo \
  -- pytest -q
```

Check whether required artifacts are present and free of template markers:

```bash
python scripts/check_assurance_artifacts.py .validation/<run>
```

Run script tests:

```bash
python -m unittest discover -s scripts/tests -v
```

## Assurance boundaries

This skill can improve code-level and accessible system evidence. It cannot manufacture unavailable requirements, production behavior, hardware results, operational exercises, qualified independent review, or acceptance authority.

For high-consequence systems, an `INSUFFICIENT_FOR_STATED_TARGET` result is a valid and useful outcome when the required evidence does not exist.
