"""Module entry point for the rolling Data Kiosk provision refresh."""

from .src.cli.refresh_data_kiosk_provision import main

if __name__ == "__main__":
    raise SystemExit(main())
