"""Owner-only local artifacts for transient Settlement elaboration inputs."""

import json
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class ProcessingArtifactLog:
    """Write fetched source data outside the database with restrictive permissions."""

    directory: Path

    @classmethod
    def create(cls, root: Path, processing_log_id: str) -> ProcessingArtifactLog:
        directory = root.resolve() / processing_log_id
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        directory.chmod(0o700)
        return cls(directory=directory)

    def write_bytes(self, relative_path: Path, content: bytes) -> Path:
        """Write one exact fetched document without exposing it through logging."""
        path = self._path(relative_path)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.parent.chmod(0o700)
        with path.open("xb") as artifact_file:
            artifact_file.write(content)
        path.chmod(0o600)
        return path

    def write_json(self, relative_path: Path, value: object) -> Path:
        """Write a deterministic JSON snapshot such as selected fee-rate rows."""
        encoded = json.dumps(
            value,
            default=_json_default,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode()
        return self.write_bytes(relative_path, encoded + b"\n")

    def _path(self, relative_path: Path) -> Path:
        if relative_path.is_absolute() or any(
            part in {"", ".", ".."} for part in relative_path.parts
        ):
            raise ValueError("Artifact path must be a safe relative path.")
        path = (self.directory / relative_path).resolve()
        if self.directory not in path.parents:
            raise ValueError("Artifact path escapes the processing directory.")
        return path


def _json_default(value: object) -> str:
    if isinstance(value, datetime | date | Numeric):
        return value.isoformat() if isinstance(value, datetime | date) else str(value)
    raise TypeError(f"Unsupported artifact JSON value: {type(value).__name__}.")


__all__ = ["ProcessingArtifactLog"]
