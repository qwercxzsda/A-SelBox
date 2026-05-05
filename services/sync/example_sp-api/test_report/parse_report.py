from pathlib import Path

import pandas as pd


def parse_settlement_reports():
    """Parse all TSV files in settlement_reports and print unique tuples"""

    base_path = Path(__file__).parent / "settlement_reports"
    unique_tuples = set()

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
                transcation_type = str(row.get("transaction-type", "")).strip()
                marketplace = str(row.get("marketplace-name", "")).strip()
                amount_type = str(row.get("amount-type", "")).strip()
                amount_desc = str(row.get("amount-description", "")).strip()

                unique_tuples.add((transcation_type, amount_type, amount_desc))
        except Exception as e:
            print(f"  Error reading file: {e}")

    print(
        f"\nFound {len(unique_tuples)} unique (transaction-type, amount-type, amount-description) tuples:\n"
    )

    # Sort and print
    for transcation_type, amount_type, amount_desc in sorted(unique_tuples):
        print(
            f"Transaction Type: {transcation_type} | Type: {amount_type} | Description: {amount_desc}"
        )


if __name__ == "__main__":
    parse_settlement_reports()
