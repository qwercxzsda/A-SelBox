"""Module entry point for daily inventory report acquisition."""

from .src.cli.download_inventory import main

if __name__ == "__main__":
    raise SystemExit(main())
