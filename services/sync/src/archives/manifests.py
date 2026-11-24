"""Atomic capture descriptors for offline replay."""

import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path


def write_manifest(path: Path, payload: Mapping[str, object]) -> None:
    """Create one complete capture manifest atomically, without replacing another capture."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as stream:
            temporary = stream.name
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        if temporary is not None and Path(temporary).exists():
            Path(temporary).unlink()
