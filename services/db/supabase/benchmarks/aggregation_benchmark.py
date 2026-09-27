"""Measure current summaries and the administrator SKU catalog against authorized views."""

from .aggregation_measurement import measure
from .runner import cli, run


def main() -> None:
    run(__doc__, "Current summary/options RPCs; untimed authorized SQL-view oracle.", measure)


if __name__ == "__main__":
    cli(main)
