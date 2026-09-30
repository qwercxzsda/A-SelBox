"""Module entry point for offline Settlement preprocessing."""

from .src.cli.preprocess_settlement import main

if __name__ == "__main__":
    raise SystemExit(main())
