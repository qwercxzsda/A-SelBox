"""Tests for owner-only local auxiliary artifacts."""

import json
import stat
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from ....src.numeric import Numeric
from ....src.settlement_processing.artifacts import ProcessingArtifactLog


class TestProcessingArtifactLog(unittest.TestCase):
    def test_writes_owner_only_artifacts_and_blocks_path_escape(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            artifacts = ProcessingArtifactLog.create(
                Path(temporary_directory),
                str(uuid4()),
            )
            artifact = artifacts.write_bytes(Path("data-kiosk", "page-1.jsonl"), b"{}\n")

            self.assertEqual(stat.S_IMODE(artifacts.directory.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(artifact.stat().st_mode), 0o600)
            self.assertEqual(artifact.read_bytes(), b"{}\n")
            with self.assertRaisesRegex(ValueError, "safe relative"):
                artifacts.write_bytes(Path("..", "outside"), b"secret")

    def test_writes_decimal_json_as_exact_text_without_binary_float(self) -> None:
        amount = Numeric("12345678901234567890.123456789012345678901")
        with TemporaryDirectory() as temporary_directory:
            artifacts = ProcessingArtifactLog.create(
                Path(temporary_directory),
                str(uuid4()),
            )

            artifact = artifacts.write_json(Path("fee-rates.json"), {"rate": amount})

            self.assertEqual(json.loads(artifact.read_bytes()), {"rate": str(amount)})


if __name__ == "__main__":
    unittest.main()
