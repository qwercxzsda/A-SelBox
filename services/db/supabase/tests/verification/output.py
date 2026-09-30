"""Consistent output protection for opt-in verification commands."""

import argparse
import json
from collections.abc import Mapping
from pathlib import Path


def validate_output_path(parser: argparse.ArgumentParser, path: Path | None) -> None:
    if path is not None and (path.exists() or path.is_symlink()):
        parser.error("Choose a new output file; existing files, including the seed, are protected")


def write_evidence(path: Path | None, result: Mapping[str, object]) -> str:
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as output:
            output.write(text)
    return text
