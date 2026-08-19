from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pandas as pd


def _normalized_value(row: pd.Series, column_name: str) -> str:
    """Return a report value as stripped text."""
    row_values = cast(Mapping[str, object], row)
    return str(row_values.get(column_name, "")).strip()


def parse_settlement_reports() -> None:
    """Parse all TSV files in settlement_reports and print unique tuples"""

    base_path = Path(__file__).parent / "settlement_reports"
    unique_tuples: set[tuple[str, str, str]] = set()

    # Find all TSV files
    tsv_files = sorted(base_path.glob("*.tsv"))

    if not tsv_files:
        print(f"No TSV files found in {base_path}")
        return

    print(f"Found {len(tsv_files)} TSV files\n")

    # Parse each file
    for filepath in tsv_files:
        print(f"Processing: {filepath.name}")
        try:
            df = pd.read_csv(filepath, delimiter="\t")
            for _, row in df.iterrows():
                transaction_type = _normalized_value(row, "transaction-type")
                amount_type = _normalized_value(row, "amount-type")
                amount_desc = _normalized_value(row, "amount-description")

                unique_tuples.add((transaction_type, amount_type, amount_desc))
        except Exception as error:
            print(f"  Error reading file: {error}")

    print(
        f"\nFound {len(unique_tuples)} unique "
        "(transaction-type, amount-type, amount-description) tuples:\n"
    )

    # Sort and print
    for transaction_type, amount_type, amount_desc in sorted(unique_tuples):
        print(
            f"Transaction Type: {transaction_type} | Type: {amount_type} | "
            f"Description: {amount_desc}"
        )


if __name__ == "__main__":
    parse_settlement_reports()
