from typing import Protocol


class DataKioskResponse(Protocol):
    """Response shape consumed from the dynamically typed SDK."""

    @property
    def payload(self) -> object: ...


class DataKioskClient(Protocol):
    """Data Kiosk operations used by query acquisition and downloads."""

    def create_query(
        self,
        query: str,
        pagination_token: str | None = None,
    ) -> DataKioskResponse:
        """Submit a Data Kiosk query."""
        ...

    def get_query(self, query_id: str) -> DataKioskResponse:
        """Get one Data Kiosk query."""
        ...

    def get_document(self, document_id: str) -> DataKioskResponse:
        """Get one Data Kiosk document."""
        ...
