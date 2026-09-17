"""Module entry point for Data Kiosk document acquisition."""

from .src.cli.download_data_kiosk import main

if __name__ == "__main__":
    raise SystemExit(main())
