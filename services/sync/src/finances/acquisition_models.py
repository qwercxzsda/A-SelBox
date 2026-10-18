"""Immutable Finances acquisition and complete raw response page manifests."""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo

from ..amazon.datetimes import as_utc
from ..amazon.finances.client import FINANCES_API_VERSION, FinancesOperation
from ..amazon.finances.marketplaces import NON_AMAZON_US_ID
from ..amazon.identifiers import validate_marketplace_id
from ..amazon.marketplaces import get_credential_scope
from ..amazon.scopes import validate_amazon_scope
from ..archives.models import ArchivedDocument
from ..database.seller_namespaces import validate_seller_namespace
from ..frozen_values import freeze_mapping


@dataclass(frozen=True, slots=True)
class FinancesCoverageMarketplace:
    """A validated market in the regional acquisition's local-day coverage."""

    marketplace_id: str
    marketplace_name: str
    time_zone: str

    def __post_init__(self) -> None:
        validate_marketplace_id(self.marketplace_id)
        if not self.marketplace_name or self.marketplace_name != self.marketplace_name.strip():
            raise ValueError("Finances coverage requires an exact marketplace name.")
        ZoneInfo(self.time_zone)


@dataclass(frozen=True, slots=True, kw_only=True)
class ArchivedFinancesPage:
    """One raw page, with complete request scope and safe response provenance."""

    operation: FinancesOperation
    page_number: int
    marketplace_id: str | None
    is_terminal: bool
    request_parameters: Mapping[str, str]
    requested_at: datetime
    received_at: datetime
    document: ArchivedDocument
    api_metadata: Mapping[str, object] = field(default_factory=dict[str, object], repr=False)

    def __post_init__(self) -> None:
        if self.operation not in ("transactions", "summary"):
            raise ValueError("Unknown archived Finances operation.")
        if type(self.page_number) is not int or self.page_number < 1:
            raise ValueError("Finances page numbers must be positive integers.")
        if self.marketplace_id is not None:
            validate_marketplace_id(self.marketplace_id)
        if type(self.is_terminal) is not bool:
            raise ValueError("Finances terminal flag must be boolean.")
        if as_utc(self.requested_at) > as_utc(self.received_at):
            raise ValueError("Finances page response precedes its request.")
        object.__setattr__(
            self,
            "request_parameters",
            freeze_mapping(self.request_parameters, field_name="request_parameters"),
        )
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class FinancesAcquisition:
    """One complete unfiltered regional transaction capture and optional Summary."""

    id: UUID
    seller_namespace: str
    amazon_scope: str
    api_version: str
    capture_started_at: datetime
    downloaded_at: datetime
    query_start_date: date
    query_end_date: date
    marketplace_ids: tuple[str, ...]
    documents: tuple[ArchivedFinancesPage, ...]
    api_metadata: Mapping[str, object]

    def __post_init__(self) -> None:
        if self.id.version != 7:
            raise ValueError("Finances acquisitions require UUIDv7 identifiers.")
        validate_amazon_scope(self.amazon_scope)
        object.__setattr__(
            self, "seller_namespace", validate_seller_namespace(self.seller_namespace)
        )
        if self.api_version != FINANCES_API_VERSION:
            raise ValueError("Unsupported Finances API version.")
        if as_utc(self.capture_started_at) > as_utc(self.downloaded_at):
            raise ValueError("Finances acquisition completion precedes its start.")
        if type(self.query_start_date) is not date or type(self.query_end_date) is not date:
            raise TypeError("Finances acquisition coverage requires local calendar dates.")
        if self.query_start_date > self.query_end_date:
            raise ValueError("Finances acquisition coverage is reversed.")
        if (self.query_start_date.year, self.query_start_date.month) != (
            self.query_end_date.year,
            self.query_end_date.month,
        ):
            raise ValueError("Finances acquisitions must remain within one calendar month.")
        if not self.marketplace_ids or len(set(self.marketplace_ids)) != len(self.marketplace_ids):
            raise ValueError("Finances coverage marketplace inventory must be nonempty and unique.")
        for marketplace_id in self.marketplace_ids:
            validate_marketplace_id(marketplace_id)
        summary_available = self.api_metadata.get("summary_available")
        if type(summary_available) is not bool:
            raise ValueError("Finances acquisition must declare Summary availability.")
        coverage = self.coverage_marketplaces
        if tuple(market.marketplace_id for market in coverage) != self.marketplace_ids:
            raise ValueError("Finances coverage metadata differs from its marketplace inventory.")
        validate_coverage_scope(self.amazon_scope, coverage)
        self._validate_documents(summary_available)
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )

    def _validate_documents(self, summary_available: bool) -> None:
        """Require complete page chains with one unchanged regional scope per operation."""
        chains: dict[FinancesOperation, list[ArchivedFinancesPage]] = defaultdict(list)
        for page in self.documents:
            if page.marketplace_id is not None:
                raise ValueError("Finances acquisitions must use unfiltered regional requests.")
            if (
                not self.capture_started_at
                <= page.requested_at
                <= page.received_at
                <= self.downloaded_at
            ):
                raise ValueError("Finances page timestamps are outside acquisition bounds.")
            chains[page.operation].append(page)
        if set(chains) != ({"transactions", "summary"} if summary_available else {"transactions"}):
            raise ValueError("Finances page inventory does not match its completion declarations.")
        for operation, pages in chains.items():
            if [page.page_number for page in pages] != list(range(1, len(pages) + 1)):
                raise ValueError("Finances pages must be consecutively ordered.")
            if [page.is_terminal for page in pages] != [False] * (len(pages) - 1) + [True]:
                raise ValueError("Only the final Finances page can be terminal.")
            base = dict(pages[0].request_parameters)
            keys = (
                {"postedAfter", "postedBefore"}
                if operation == "transactions"
                else {"periodStart", "periodEnd"}
            )
            if set(base) != keys:
                raise ValueError("Finances page one must use unfiltered date-range parameters.")
            if operation == "summary" and base != {
                "periodStart": self.query_start_date.isoformat(),
                "periodEnd": self.query_end_date.isoformat(),
            }:
                raise ValueError("Finances Summary scope differs from acquisition dates.")
            for page in pages[1:]:
                parameters = dict(page.request_parameters)
                token = parameters.pop("nextToken", None)
                if not isinstance(token, str) or not token or parameters != base:
                    raise ValueError(
                        "Finances continuation pages must retain identical request scope."
                    )

    @property
    def coverage_marketplaces(self) -> tuple[FinancesCoverageMarketplace, ...]:
        inventory = self.api_metadata.get("coverage_marketplaces")
        if not isinstance(inventory, list | tuple):
            raise ValueError("Finances acquisition requires its coverage marketplace metadata.")
        result: list[FinancesCoverageMarketplace] = []
        for entry in cast(list[object] | tuple[object, ...], inventory):
            if not isinstance(entry, Mapping):
                raise ValueError("Finances coverage metadata must contain marketplace objects.")
            value = cast(Mapping[str, object], entry)
            identifier, name, zone = (
                value.get("marketplace_id"),
                value.get("marketplace_name"),
                value.get("time_zone"),
            )
            if (
                not isinstance(identifier, str)
                or not isinstance(name, str)
                or not isinstance(zone, str)
            ):
                raise ValueError("Finances coverage fields must be text.")
            result.append(FinancesCoverageMarketplace(identifier, name, zone))
        return tuple(result)


def validate_coverage_scope(
    scope_name: str, marketplaces: tuple[FinancesCoverageMarketplace, ...]
) -> None:
    scope = get_credential_scope(scope_name)
    allowed = {*scope.marketplace_ids, *([NON_AMAZON_US_ID] if scope.name == "NA" else [])}
    if any(market.marketplace_id not in allowed for market in marketplaces):
        raise ValueError("Finances coverage marketplace is outside the credential scope.")
