"""The undeployed baseline keeps one editable definition for each database object."""

import re
import unittest
from collections import defaultdict
from pathlib import Path

_MIGRATIONS = Path(__file__).parents[1] / "migrations"
_DEFINITION = re.compile(
    r"^create\s+(?:or\s+replace\s+)?(?:unique\s+)?"
    r"(?P<kind>function|view|index)\s+(?P<name>[a-z_][a-z_0-9.]*)\b",
    flags=re.IGNORECASE | re.MULTILINE,
)


class MigrationStructureTests(unittest.TestCase):
    def test_initial_schema_has_one_authoritative_definition_per_object(self) -> None:
        definitions: dict[tuple[str, str], list[str]] = defaultdict(list)
        for path in sorted(_MIGRATIONS.glob("*.sql")):
            for match in _DEFINITION.finditer(path.read_text(encoding="utf-8")):
                key = (match.group("kind").lower(), match.group("name").lower())
                definitions[key].append(path.name)
        self.assertTrue(definitions, "The baseline migrations must define database objects.")
        duplicates = {key: paths for key, paths in definitions.items() if len(paths) > 1}
        self.assertEqual(
            duplicates,
            {},
            "Edit the current baseline definition instead of retaining superseded SQL. "
            "Retire this baseline-only check when deployed installations need upgrade migrations.",
        )
