#!/usr/bin/env python3
"""Check an assurance workspace for missing files and unresolved template markers."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_FILES = {
    "run-manifest.json",
    "project-assurance-profile.yaml",
    "system-map.md",
    "validation-contract.yaml",
    "traceability-matrix.md",
    "risk-register.yaml",
    "validation-plan.md",
    "findings.md",
    "evidence-report.md",
    "release-assessment.md",
}

PLACEHOLDER_PATTERNS = [
    re.compile(r"\{\{[A-Z0-9_]+\}\}"),
    re.compile(r"\bC\?\b"),
    re.compile(r"\bL\?\b"),
    re.compile(r"Replace this example", re.IGNORECASE),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", help="Run-specific assurance directory.")
    parser.add_argument(
        "--allow-placeholders",
        action="store_true",
        help="Report unresolved placeholders as warnings rather than failures.",
    )
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    if not workspace.is_dir():
        print(f"Workspace not found: {workspace}", file=sys.stderr)
        return 2

    errors: list[str] = []
    warnings: list[str] = []

    present = {path.name for path in workspace.iterdir() if path.is_file()}
    for missing in sorted(REQUIRED_FILES - present):
        errors.append(f"missing required file: {missing}")

    manifest_path = workspace / "run-manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"invalid run-manifest.json: {exc}")
        else:
            for key in ("assessment_id", "target_revision", "created_at_utc", "mode"):
                if not manifest.get(key):
                    errors.append(f"run-manifest.json missing value: {key}")

    for path in sorted(workspace.iterdir()):
        if not path.is_file() or path.suffix not in {".md", ".yaml", ".yml", ".json"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            errors.append(f"cannot read {path.name}: {exc}")
            continue
        if not text.strip():
            errors.append(f"empty artifact: {path.name}")
            continue
        for pattern in PLACEHOLDER_PATTERNS:
            if pattern.search(text):
                message = f"unresolved placeholder in {path.name}: {pattern.pattern}"
                (warnings if args.allow_placeholders else errors).append(message)

    if errors:
        print("Assurance artifact check: FAIL", file=sys.stderr)
        for item in errors:
            print(f"ERROR: {item}", file=sys.stderr)
    else:
        print("Assurance artifact check: PASS")

    for item in warnings:
        print(f"WARNING: {item}", file=sys.stderr)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
