"""Module entry point for Settlement document acquisition."""

from .src.cli.download_settlement_reports import main

if __name__ == "__main__":
    raise SystemExit(main())
