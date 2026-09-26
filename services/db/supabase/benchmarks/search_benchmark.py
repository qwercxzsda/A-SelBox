"""Measure visible search and capped amount ordering on disposable fixtures."""

from .runner import cli, run
from .search_measurement import measure


def main() -> None:
    run(
        __doc__,
        "Visible-field search and capped amount ordering; page then count; authorized-view oracle.",
        measure,
    )


if __name__ == "__main__":
    cli(main)
