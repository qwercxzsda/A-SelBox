"""Resolve benchmark raw-key searches before timing exact-match transaction RPCs.

UI label rendering is covered by frontend tests. Benchmark terms deliberately use
stored text and the two Source labels, so the independent raw-view oracle can
verify the same rows across the old substring and current exact-array contracts.
"""

from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAMES
from services.sync.src.transaction_types.data_kiosk import DATA_KIOSK_TYPES
from services.sync.src.transaction_types.settlement import SETTLEMENT_TYPES

from .common import Connection


def resolve_search_values(connection: Connection, term: str, dataset: str) -> dict[str, object]:
    """Use the active authenticated actor; never time catalog loading as a table read."""
    if dataset not in {"live", "settlement", "data_kiosk"}:
        raise ValueError("Search resolution requires a transaction dataset")
    names = ["p_search_skus", "p_search_types", "p_search_marketplaces"]
    if dataset == "live":
        names.append("p_search_sources")
    normalized = term.strip().lower()
    if not normalized:
        return {}
    account = connection.execute(
        "select access_role from public.app_accounts where user_id=auth.uid()"
    ).fetchone()
    if account is None:
        return {name: [] for name in names}
    if account[0] == "company_member":
        skus = connection.execute("select distinct sku from public.company_skus").fetchall()
    else:
        skus = connection.execute(
            "select sku from public.seller_skus union "
            "select sku from private.settlement_transactions where sku is not null union "
            "select sku from private.data_kiosk_transactions where sku is not null"
        ).fetchall()
    types = [
        item.component_type
        for source, entries in (
            ("settlement", SETTLEMENT_TYPES),
            ("data_kiosk", DATA_KIOSK_TYPES),
        )
        if dataset in ("live", source)
        for item in entries
        if account[0] == "operator" or item.category != "SELBOX"
    ]
    result: dict[str, object] = {
        "p_search_skus": sorted({str(row[0]) for row in skus if normalized in str(row[0]).lower()}),
        "p_search_types": sorted({value for value in types if normalized in value.lower()}),
        "p_search_marketplaces": sorted(
            value for value in MARKETPLACE_NAMES if normalized in value.lower()
        ),
    }
    if dataset == "live":
        result["p_search_sources"] = [
            value
            for value, label in (("SETTLEMENT", "Settlements"), ("DATA_KIOSK", "Data Kiosk"))
            if normalized in value.lower() or normalized in label.lower()
        ]
    return result
