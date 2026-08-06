#!/usr/bin/env python3
"""Run one command and retain reproducible, sanitized-friendly evidence.

The command is executed without a shell. Environment variables are not written to
the evidence metadata. Project output can still contain secrets; inspect or use
--redact-pattern before retaining or sharing it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path


def utc_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def redact(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        try:
            text = re.sub(pattern, "[REDACTED]", text)
        except re.error as exc:
            raise ValueError(f"invalid redaction regex {pattern!r}: {exc}") from exc
    return text


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Evidence directory.")
    parser.add_argument("--name", required=True, help="Filesystem-safe evidence name.")
    parser.add_argument("--cwd", default=".", help="Command working directory.")
    parser.add_argument("--timeout", type=float, default=None, help="Timeout in seconds.")
    parser.add_argument(
        "--redact-pattern",
        action="append",
        default=[],
        help="Regular expression replaced with [REDACTED]. Repeat as needed.",
    )
    parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="Command after --, for example: -- pytest -q",
    )
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("a command is required after --")

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", args.name):
        parser.error("--name may contain only letters, numbers, period, underscore, and hyphen")

    evidence_dir = Path(args.output).resolve() / args.name
    if evidence_dir.exists():
        print(f"Refusing to overwrite evidence directory: {evidence_dir}", file=sys.stderr)
        return 2
    evidence_dir.mkdir(parents=True)

    started = utc_iso()
    monotonic_start = time.monotonic()
    timed_out = False

    try:
        result = subprocess.run(
            command,
            cwd=Path(args.cwd).resolve(),
            capture_output=True,
            text=True,
            timeout=args.timeout,
            check=False,
        )
        exit_code: int | None = result.returncode
        stdout = result.stdout
        stderr = result.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        exit_code = None
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        stderr += f"\n[record_command] timed out after {args.timeout} seconds\n"
    except FileNotFoundError as exc:
        exit_code = 127
        stdout = ""
        stderr = str(exc) + "\n"

    duration = round(time.monotonic() - monotonic_start, 6)
    ended = utc_iso()

    try:
        stdout = redact(stdout, args.redact_pattern)
        stderr = redact(stderr, args.redact_pattern)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 3

    (evidence_dir / "stdout.txt").write_text(stdout, encoding="utf-8")
    (evidence_dir / "stderr.txt").write_text(stderr, encoding="utf-8")

    metadata = {
        "schema_version": "1.0",
        "name": args.name,
        "command": command,
        "cwd": str(Path(args.cwd).resolve()),
        "started_at_utc": started,
        "ended_at_utc": ended,
        "duration_seconds": duration,
        "timeout_seconds": args.timeout,
        "timed_out": timed_out,
        "exit_code": exit_code,
        "stdout_sha256": sha256_text(stdout),
        "stderr_sha256": sha256_text(stderr),
        "redaction_patterns_applied": len(args.redact_pattern),
        "environment_variables_recorded": False,
    }
    (evidence_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print(evidence_dir)
    if timed_out:
        return 124
    return exit_code if exit_code is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
