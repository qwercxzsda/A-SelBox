"""All verification commands protect existing seeds and evidence files."""

import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from services.db.supabase.tests.verification import configuration, payouts
from services.db.supabase.tests.verification.inventory import __main__ as inventory


def commands(root: Path) -> list[tuple[ModuleType, str, list[str]]]:
    seed = str(root / "seed.sql")
    return [
        (configuration, "verify", ["--seed", seed]),
        (payouts, "verify_seed", ["--seed", seed, "--supplement-cache", str(root / "cache")]),
        (inventory, "verify", ["--env-file", seed, "--private-output", str(root / "private")]),
    ]


class VerificationCliTests(unittest.TestCase):
    def test_existing_seed_and_alias_outputs_are_rejected_before_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed.sql"
            seed.write_text("private fixture", encoding="utf-8")
            alias = root / "alias.json"
            alias.symlink_to(seed)
            hardlink = root / "hardlink.json"
            hardlink.hardlink_to(seed)
            dangling = root / "dangling.json"
            dangling.symlink_to(root / "absent")
            for module, method, arguments in commands(root):
                for output in (seed, alias, hardlink, dangling):
                    with (
                        self.subTest(command=module.__name__, output=output.name),
                        patch("sys.argv", ["verify", *arguments, "--output", str(output)]),
                        patch.object(module, method) as verify,
                        redirect_stderr(io.StringIO()),
                        self.assertRaises(SystemExit) as error,
                    ):
                        module.main()
                    self.assertEqual(error.exception.code, 2)
                    verify.assert_not_called()
            self.assertEqual(seed.read_text(encoding="utf-8"), "private fixture")

    def test_output_created_during_verification_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for module, method, arguments in commands(root):
                output = root / (method + module.__name__ + ".json")

                def verify(*_: object, target: Path = output, **__: object) -> dict[str, bool]:
                    target.write_text("existing evidence", encoding="utf-8")
                    return {"verified": True}

                with (
                    self.subTest(command=module.__name__),
                    patch("sys.argv", ["verify", *arguments, "--output", str(output)]),
                    patch.object(module, method, verify),
                    self.assertRaises(FileExistsError),
                ):
                    module.main()
                self.assertEqual(output.read_text(encoding="utf-8"), "existing evidence")
