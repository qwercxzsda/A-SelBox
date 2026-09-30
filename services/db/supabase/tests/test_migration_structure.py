"""The undeployed baseline keeps one editable definition for each database object."""

import re
import unittest
from collections import defaultdict
from pathlib import Path

_MIGRATIONS = Path(__file__).parents[1] / "migrations"
_DEFINITION = re.compile(
    r"^create\s+(?:or\s+replace\s+)?(?:unique\s+)?"
    r"(?P<kind>function|view|index|table|type|domain)\s+(?P<name>[a-z_][a-z_0-9.]*)\b",
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
            "The repository maintains a single current baseline.",
        )

    def test_api_definitions_precede_final_grants_and_single_schema_reload(self) -> None:
        migrations = [
            (path, path.read_text(encoding="utf-8")) for path in sorted(_MIGRATIONS.glob("*.sql"))
        ]
        grant_positions = [
            index
            for index, (path, _) in enumerate(migrations)
            if path.name.endswith("_application_grants.sql")
        ]
        self.assertEqual(len(grant_positions), 1, "Keep one final application-grant phase.")
        grant_position = grant_positions[0]
        self.assertEqual(
            grant_position,
            len(migrations) - 2,
            "Only REST configuration should follow the final application grants.",
        )
        late_definitions = [
            (path.name, match.group("name"))
            for path, source in migrations[grant_position:]
            for match in _DEFINITION.finditer(source)
            if match.group("kind").lower() in {"function", "view"}
        ]
        self.assertEqual(
            late_definitions,
            [],
            "Define functions and views before the final grants establish their API access.",
        )
        self.assertTrue(migrations[-1][0].name.endswith("_rest_api_configuration.sql"))
        early_grants = [
            path.name
            for path, source in migrations[:grant_position]
            if re.search(r"^\s*grant\s", source, re.IGNORECASE | re.MULTILINE)
        ]
        self.assertEqual(early_grants, [], "Application grants belong to the final allowlist.")
        schema_reloads = [
            path.name
            for path, source in migrations
            for _ in re.finditer(
                r"^\s*notify\s+pgrst\s*,\s*'reload schema'\s*;",
                source,
                flags=re.IGNORECASE | re.MULTILINE,
            )
        ]
        self.assertEqual(
            schema_reloads,
            [migrations[-1][0].name],
            "Reload the schema once, after every definition and application grant.",
        )
