"""Verify real SP-API inventory through archive, preprocessing, database, Auth, and browser."""

import argparse
import json
import traceback
from pathlib import Path

from ..output import validate_output_path, write_evidence
from .workflow import verify


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--scope", default="NA")
    parser.add_argument(
        "--report-reference",
        type=Path,
        help="Optional private JSON getReport response containing a reportId to fetch again.",
    )
    parser.add_argument("--marketplace-id", default="ATVPDKIKX0DER")
    parser.add_argument("--private-output", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    validate_output_path(parser, args.output)
    result = verify(
        env_file=args.env_file,
        scope_name=args.scope,
        marketplace_id=args.marketplace_id,
        report_reference=args.report_reference,
        private_output=args.private_output,
    )
    write_evidence(args.output, result)
    print(json.dumps({"verified": True, "evidence": str(args.output)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Vendor responses, database error DETAIL, and browser logs can contain
        # private source records. Report only the exception class on the console.
        origin = traceback.extract_tb(error.__traceback__)[-1]
        print(
            json.dumps(
                {
                    "verified": False,
                    "exception_type": type(error).__name__,
                    "origin": {
                        "file": Path(origin.filename).name,
                        "function": origin.name,
                        "line": origin.lineno,
                    },
                }
            )
        )
        raise SystemExit(1) from None
