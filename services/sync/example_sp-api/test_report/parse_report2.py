import sys
from pathlib import Path

import pandas as pd


def parse_settlement_reports_with_nan(column_name):
    """Parse all TSV files and print rows where the given column is NaN"""
    
    base_path = Path(__file__).parent / "settlement_reports_na"
    all_rows = []
    
    # Find all TSV files
    tsv_files = sorted(base_path.glob("*.tsv"))
    
    if not tsv_files:
        print(f"No TSV files found in {base_path}")
        return
    
    print(f"Found {len(tsv_files)} TSV files\n")
    print(f"Searching for rows where '{column_name}' is NaN\n")
    
    # Parse each file
    for filepath in tsv_files:
        try:
            df = pd.read_csv(filepath, delimiter='\t')
            
            # Check if column exists
            if column_name not in df.columns:
                print(f"Warning: Column '{column_name}' not found in {filepath.name}")
                continue
            
            # Find rows with NaN in the specified column
            nan_rows = df[df[column_name].isna()]
            
            if len(nan_rows) > 0:
                print(f"\n{'='*100}")
                print(f"File: {filepath.name}")
                print(f"Found {len(nan_rows)} rows with NaN in '{column_name}'")
                print(f"{'='*100}")
                print(nan_rows.to_string())
                all_rows.append(nan_rows)
        
        except Exception as e:
            print(f"Error reading {filepath.name}: {e}")
    
    # Summary
    total_nan_rows = sum(len(rows) for rows in all_rows)
    print(f"\n{'='*100}")
    print(f"Total rows with NaN in '{column_name}': {total_nan_rows}")
    print(f"{'='*100}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python parse_report2.py <column_name>")
        print("\nExample: python parse_report2.py 'marketplace-name'")
        sys.exit(1)
    
    column_name = sys.argv[1]
    parse_settlement_reports_with_nan(column_name)
