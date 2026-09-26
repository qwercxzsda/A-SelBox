"""Measure installed transaction page/count RPCs on fresh disposable fixtures."""

from .measurement import measure
from .runner import cli, run


def main() -> None:
    run(
        __doc__,
        "Installed RPCs via local HTTP JSON; count starts after rows; warm DB/OS caches.",
        measure,
    )


if __name__ == "__main__":
    cli(main)
