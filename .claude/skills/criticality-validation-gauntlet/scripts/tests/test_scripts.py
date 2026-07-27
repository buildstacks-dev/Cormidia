from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
INIT = SCRIPTS / "init_assurance_workspace.py"
RECORD = SCRIPTS / "record_command.py"
CHECK = SCRIPTS / "check_assurance_artifacts.py"


class ScriptTests(unittest.TestCase):
    def test_init_creates_workspace_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = subprocess.run(
                [
                    sys.executable,
                    str(INIT),
                    "--root",
                    str(root),
                    "--output",
                    "validation-output",
                    "--assessment-id",
                    "test-run",
                    "--mode",
                    "assess",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            workspace = Path(result.stdout.strip())
            self.assertTrue((workspace / "project-assurance-profile.yaml").exists())
            manifest = json.loads((workspace / "run-manifest.json").read_text())
            self.assertEqual(manifest["assessment_id"], "test-run")
            self.assertEqual(manifest["mode"], "assess")
            self.assertFalse(manifest["host"].get("environment"))

    def test_init_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            command = [
                sys.executable,
                str(INIT),
                "--root",
                str(root),
                "--output",
                "validation-output",
                "--assessment-id",
                "test-run",
            ]
            first = subprocess.run(command, capture_output=True, text=True)
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0)
            self.assertEqual(second.returncode, 2)

    def test_record_command_captures_result_and_redacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "evidence"
            result = subprocess.run(
                [
                    sys.executable,
                    str(RECORD),
                    "--output",
                    str(output),
                    "--name",
                    "sample",
                    "--redact-pattern",
                    "secret-[0-9]+",
                    "--",
                    sys.executable,
                    "-c",
                    "print('secret-123')",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0)
            evidence = output / "sample"
            self.assertEqual(
                (evidence / "stdout.txt").read_text().strip(), "[REDACTED]"
            )
            metadata = json.loads((evidence / "metadata.json").read_text())
            self.assertEqual(metadata["exit_code"], 0)
            self.assertFalse(metadata["environment_variables_recorded"])

    def test_checker_reports_unresolved_placeholders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_result = subprocess.run(
                [
                    sys.executable,
                    str(INIT),
                    "--root",
                    str(root),
                    "--output",
                    "validation-output",
                    "--assessment-id",
                    "test-run",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            workspace = init_result.stdout.strip()
            check_result = subprocess.run(
                [sys.executable, str(CHECK), workspace],
                capture_output=True,
                text=True,
            )
            self.assertEqual(check_result.returncode, 1)
            self.assertIn("unresolved placeholder", check_result.stderr)


if __name__ == "__main__":
    unittest.main()
