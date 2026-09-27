"""Export deterministic, credential-free frontend catalogs from source definitions.

Run from the repository root with ``python -m services.sync.src.transaction_types.generate``.
Use ``--check`` in validation to reject stale checked-in artifacts.
"""

import argparse
import json
from pathlib import Path

from ..amazon.marketplace_names import MARKETPLACE_NAMES
from .data_kiosk import DATA_KIOSK_TYPES
from .settlement import SETTLEMENT_TYPES

OUTPUT_DIRECTORY = (
    Path(__file__).resolve().parents[4] / "services/frontend/user-webpage/src/generated"
)


def generated_catalogs() -> dict[str, str]:
    """Keep API filter keys unchanged and include every supported category."""
    types = [
        {"source": source, "category": item.category.value, "type": item.component_type}
        for source, entries in (
            ("SETTLEMENT", SETTLEMENT_TYPES),
            ("DATA_KIOSK", DATA_KIOSK_TYPES),
        )
        for item in entries
    ]
    types.sort(key=lambda item: (item["source"], item["category"], item["type"]))
    catalogs: dict[str, object] = {
        "transaction-types.json": types,
        "marketplaces.json": sorted(MARKETPLACE_NAMES),
    }
    return {
        name: json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        for name, value in catalogs.items()
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated files are stale.")
    arguments = parser.parse_args()
    stale: list[str] = []
    for name, contents in generated_catalogs().items():
        path = OUTPUT_DIRECTORY / name
        if arguments.check:
            if not path.exists() or path.read_text(encoding="utf-8") != contents:
                stale.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="utf-8")
    if stale:
        parser.exit(1, f"Regenerate transaction catalogs: {', '.join(stale)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
