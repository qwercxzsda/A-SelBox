"""Module entry point for Settlement download-and-parse."""

from .src.cli.download_and_parse_settlement_reports import main

if __name__ == "__main__":
    raise SystemExit(main())
