#!/usr/bin/env python3
"""Create a run-specific assurance workspace from bundled templates.

This script uses only the Python standard library. It never modifies source files,
executes project code, records environment variables, or overwrites an existing
assessment unless --force is supplied.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run_git(root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    return result.stdout.strip()


def discover_repo_root(candidate: Path) -> Path:
    resolved = candidate.resolve()
    root = run_git(resolved, "rev-parse", "--show-toplevel")
    return Path(root).resolve() if root else resolved


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def render(text: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


def safe_assessment_id(value: str) -> str:
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    if not value or any(char not in allowed for char in value):
        raise ValueError(
            "assessment id may contain only letters, numbers, hyphen, underscore, and period"
        )
    if value in {".", ".."}:
        raise ValueError("invalid assessment id")
    return value


def build_manifest(
    *,
    assessment_id: str,
    timestamp: str,
    repo_root: Path,
    revision: str,
    dirty: bool | None,
    mode: str,
) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "assessment_id": assessment_id,
        "created_at_utc": timestamp,
        "mode": mode,
        "repository_root": str(repo_root),
        "target_revision": revision,
        "working_tree_dirty": dirty,
        "host": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "evidence": [],
        "notes": [
            "Environment variables are intentionally not recorded.",
            "Review command output before retaining it because project tools may print secrets.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=".",
        help="Repository or working directory to assess (default: current directory).",
    )
    parser.add_argument(
        "--output",
        default=".validation",
        help="Output directory relative to repository root, or an absolute path.",
    )
    parser.add_argument(
        "--assessment-id",
        help="Run identifier. Default: UTC timestamp plus short revision.",
    )
    parser.add_argument(
        "--mode",
        choices=["profile", "assess", "design", "harden", "verify", "full"],
        default="assess",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing assessment directory with the same id.",
    )
    args = parser.parse_args()

    repo_root = discover_repo_root(Path(args.root))
    timestamp_dt = utc_now()
    timestamp = timestamp_dt.isoformat().replace("+00:00", "Z")
    compact_timestamp = timestamp_dt.strftime("%Y%m%dT%H%M%SZ")

    revision = run_git(repo_root, "rev-parse", "HEAD") or "UNVERSIONED"
    short_revision = revision[:12] if revision != "UNVERSIONED" else "unversioned"
    status = run_git(repo_root, "status", "--porcelain")
    dirty: bool | None = None if status is None else bool(status)

    assessment_id = safe_assessment_id(
        args.assessment_id or f"{compact_timestamp}-{short_revision}"
    )

    output_base = Path(args.output)
    if not output_base.is_absolute():
        output_base = repo_root / output_base
    run_dir = output_base.resolve() / assessment_id

    if run_dir.exists():
        if not args.force:
            print(f"Refusing to overwrite existing assessment: {run_dir}", file=sys.stderr)
            return 2
        shutil.rmtree(run_dir)

    templates_dir = Path(__file__).resolve().parent.parent / "assets" / "templates"
    if not templates_dir.is_dir():
        print(f"Templates directory not found: {templates_dir}", file=sys.stderr)
        return 3

    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "evidence").mkdir()

    values = {
        "ASSESSMENT_ID": assessment_id,
        "TIMESTAMP_UTC": timestamp,
        "TARGET_REVISION": revision,
        "REPO_ROOT": str(repo_root),
    }

    copied: list[str] = []
    for template_path in sorted(templates_dir.iterdir()):
        if not template_path.is_file():
            continue
        destination = run_dir / template_path.name
        destination.write_text(
            render(template_path.read_text(encoding="utf-8"), values),
            encoding="utf-8",
        )
        copied.append(destination.name)

    manifest = build_manifest(
        assessment_id=assessment_id,
        timestamp=timestamp,
        repo_root=repo_root,
        revision=revision,
        dirty=dirty,
        mode=args.mode,
    )
    manifest["created_templates"] = copied
    (run_dir / "run-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
