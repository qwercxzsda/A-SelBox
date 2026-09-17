"""Safe, correlated diagnostics for the non-atomic archive/publication boundary."""

import json
import logging
import re
from dataclasses import asdict
from pathlib import Path
from types import TracebackType
from typing import Self
from uuid import uuid4

from psycopg import Error as PostgresError

from .models import ArchivedDocument

_LOG = logging.getLogger(__name__)
type LogValue = str | int | bool | None


class AcquisitionLog:
    """Record explicit identifiers and archive manifests, never API bodies or errors.

    An attempt ID exists before uploads; acquisition UUIDv7 generation stays at
    publication time. These diagnostics are not a durable recovery journal.
    """

    def __init__(self, source: str, **context: LogValue) -> None:
        self.context: dict[str, LogValue] = {
            "source": source,
            "attempt_id": str(uuid4()),
            **context,
        }
        self.stage = "validation"
        self.pending_archive: dict[str, object] | None = None
        self.verified_archives: list[dict[str, object]] = []

    def __enter__(self) -> Self:
        self._event("acquisition_started")
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if exc is None:
            return
        while traceback is not None and traceback.tb_next is not None:
            traceback = traceback.tb_next
        self._event(
            "acquisition_failed",
            logging.ERROR,
            exception_type=type(exc).__name__,
            publication_status="unconfirmed" if self.stage == "publication" else "not_started",
            verified_archive_count=len(self.verified_archives),
            pending_archive=self.pending_archive,
            pending_archive_status="unconfirmed" if self.pending_archive is not None else None,
            failure_location={
                "file": Path(traceback.tb_frame.f_code.co_filename).name,
                "function": traceback.tb_frame.f_code.co_name,
                "line": traceback.tb_lineno,
            }
            if traceback is not None
            else None,
            sqlstate=exc.sqlstate
            if isinstance(exc, PostgresError)
            and exc.sqlstate is not None
            and re.fullmatch(r"[A-Z0-9]{5}", exc.sqlstate)
            else None,
        )
        # Repeat the inventory at ERROR level even when INFO logging is disabled.
        # Retained objects may be shared or already referenced after an uncertain
        # commit; never label them as definitely orphaned or safe to delete.
        for archive in self.verified_archives:
            self._event("archive_retained", logging.ERROR, **archive)

    def step(self, stage: str, **context: LogValue) -> None:
        self.stage = stage
        self.context.update(context)
        self._event("acquisition_stage")

    def upload_started(self, document: ArchivedDocument) -> None:
        self.pending_archive = {**self.context, **asdict(document)}
        self._event("archive_upload_started", **self.pending_archive)

    def archive_verified(self) -> None:
        if self.pending_archive is None:
            raise RuntimeError("Archive verification requires a pending upload.")
        self.verified_archives.append(self.pending_archive)
        self._event("archive_verified", **self.pending_archive)
        self.pending_archive = None

    def published(self, acquisition_id: str) -> None:
        self._event(
            "acquisition_published",
            acquisition_id=str(acquisition_id),
            publication_status="confirmed",
            verified_archive_count=len(self.verified_archives),
        )

    def _event(self, event: str, level: int = logging.INFO, /, **fields: object) -> None:
        # JSON escaping keeps external identifiers on one line. Only explicit
        # context and archive manifest fields enter this boundary; no exc_info,
        # signed URLs, credentials, source bytes, or arbitrary API metadata.
        _LOG.log(
            level,
            "%s",
            json.dumps({**self.context, "event": event, "stage": self.stage, **fields}),
        )
