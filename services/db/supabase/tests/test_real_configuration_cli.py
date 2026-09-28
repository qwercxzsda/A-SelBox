"""Verification reports must never replace the seed or existing evidence."""

import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from services.db.supabase.tests.verify_real_configuration import main


class RealConfigurationCliTests(unittest.TestCase):
    def test_existing_seed_and_alias_outputs_are_rejected_before_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed.sql"
            seed.write_text("private fixture", encoding="utf-8")
            alias = root / "alias.json"
            alias.symlink_to(seed)
            hardlink = root / "hardlink.json"
            hardlink.hardlink_to(seed)
            for output in (seed, alias, hardlink):
                with (
                    self.subTest(output=output.name),
                    patch("sys.argv", ["verify", "--seed", str(seed), "--output", str(output)]),
                    patch("services.db.supabase.tests.verify_real_configuration.verify") as verify,
                    redirect_stderr(io.StringIO()),
                    self.assertRaises(SystemExit) as error,
                ):
                    main()
                self.assertEqual(error.exception.code, 2)
                verify.assert_not_called()
            self.assertEqual(seed.read_text(encoding="utf-8"), "private fixture")

    def test_output_created_during_verification_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed, output = root / "seed.sql", root / "result.json"

            def verify(_: Path) -> dict[str, bool]:
                output.write_text("existing evidence", encoding="utf-8")
                return {"verified": True}

            with (
                patch("sys.argv", ["verify", "--seed", str(seed), "--output", str(output)]),
                patch("services.db.supabase.tests.verify_real_configuration.verify", verify),
                self.assertRaises(FileExistsError),
            ):
                main()
            self.assertEqual(output.read_text(encoding="utf-8"), "existing evidence")
