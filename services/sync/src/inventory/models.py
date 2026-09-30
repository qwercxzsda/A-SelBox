"""Inventory source identity and complete normalized capture values."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from uuid import UUID

from ..amazon.datetimes import as_utc
from ..amazon.marketplace_names import marketplace_name_from_id
from ..amazon.marketplaces import get_marketplace_timezone, validate_marketplace_scope_pair
from ..archives.models import ArchivedDocument
from ..database.seller_namespaces import validate_seller_namespace
from ..frozen_values import freeze_mapping

INVENTORY_REPORT_TYPE = "GET_FBA_INVENTORY_PLANNING_DATA"
INVENTORY_PREPROCESS_VERSION = "inventory-v1"
UNSUPPORTED_MARKETPLACES = frozenset({"Amazon.nl", "Amazon.pl", "Amazon.se", "Amazon.com.be"})


def validate_inventory_scope(amazon_scope: str, marketplace_id: str) -> str:
    """Validate routing and known report availability before requesting Amazon."""
    validate_marketplace_scope_pair(amazon_scope, marketplace_id)
    name = marketplace_name_from_id(marketplace_id)
    if name in UNSUPPORTED_MARKETPLACES:
        raise ValueError("Inventory Planning reports are unavailable in this marketplace.")
    return name


@dataclass(frozen=True, slots=True, kw_only=True)
class InventoryAcquisition:
    """One successfully archived report; capture day follows original report creation."""

    id: UUID
    seller_namespace: str
    amazon_scope: str
    marketplace_id: str
    marketplace_name: str
    capture_date: date
    report_id: str
    report_document_id: str
    report_created_at: datetime
    downloaded_at: datetime
    document: ArchivedDocument
    api_metadata: Mapping[str, object] = field(repr=False)
    report_type: str = INVENTORY_REPORT_TYPE

    def __post_init__(self) -> None:
        if self.id.version != 7:
            raise ValueError("Inventory acquisition requires a UUIDv7 identity.")
        validate_seller_namespace(self.seller_namespace)
        if (
            validate_inventory_scope(self.amazon_scope, self.marketplace_id)
            != self.marketplace_name
        ):
            raise ValueError("Inventory marketplace ID and name disagree.")
        if self.report_type != INVENTORY_REPORT_TYPE:
            raise ValueError("Inventory acquisition has the wrong report type.")
        for identifier in (self.report_id, self.report_document_id):
            if not identifier or identifier != identifier.strip():
                raise ValueError("Inventory report identifiers must be nonblank exact text.")
        expected_day = (
            as_utc(self.report_created_at)
            .astimezone(get_marketplace_timezone(self.marketplace_id))
            .date()
        )
        if type(self.capture_date) is not date or self.capture_date != expected_day:
            raise ValueError("Inventory capture date differs from its original report day.")
        as_utc(self.downloaded_at)
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )


@dataclass(frozen=True, slots=True)
class PreparedInventory:
    """Complete source rows and recoverable diagnostics before atomic publication."""

    items: tuple[Mapping[str, object], ...]
    diagnostics: tuple[Mapping[str, object], ...]
