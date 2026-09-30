"""Module entry point for offline inventory preprocessing."""

from .src.cli.preprocess_inventory import main

if __name__ == "__main__":
    raise SystemExit(main())
