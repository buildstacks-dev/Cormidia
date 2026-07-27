# Helper scripts

These scripts are optional. They are designed to support evidence hygiene without assuming a project language or test framework.

## Initialize a run

```bash
python scripts/init_assurance_workspace.py --root /path/to/repo --mode full
```

The command creates `.validation/<timestamp>-<revision>/` with templates and a run manifest. It does not execute project code or record environment variables.

## Record a command

```bash
python scripts/record_command.py \
  --output .validation/<run>/evidence \
  --name unit-tests \
  --cwd /path/to/repo \
  -- pytest -q
```

The recorder writes `metadata.json`, `stdout.txt`, and `stderr.txt`. Project output can contain secrets; use `--redact-pattern` and inspect retained logs.

## Check artifact completeness

```bash
python scripts/check_assurance_artifacts.py .validation/<run>
```

The checker detects missing files and unresolved template markers. It does not determine assurance sufficiency.

## Run script tests

```bash
python -m unittest discover -s scripts/tests -v
```
