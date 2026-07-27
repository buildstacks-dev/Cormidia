# Evals

`prompts.csv` tests skill triggering and mode selection. `rubric.md` evaluates process and output behavior.

A useful captured evaluation run contains:

- Input prompt.
- Whether the skill triggered.
- Tool and command trace.
- Repository changes.
- Produced artifacts.
- Final verdict.
- Rubric scores with evidence.

Add a regression row whenever the skill:

- Triggers too broadly or fails to trigger.
- Under-classifies a project.
- Recommends generic checks without tying them to claims.
- Treats coverage or passing tests as sufficient.
- Weakens tests during hardening.
- Overstates independence or assurance.
