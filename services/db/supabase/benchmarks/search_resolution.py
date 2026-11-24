"""Resolve benchmark raw-key searches before timing exact-match transaction RPCs.

UI label rendering is covered by frontend tests. Benchmark terms deliberately use
stored text and the Source values, so the independent raw-view oracle can
verify the same rows using substring matches against the resolved exact arrays.
"""

from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAMES
from services.sync.src.transaction_types.finances import FINANCES_TYPES

from .common import Connection


def resolve_search_values(connection: Connection, term: str, dataset: str) -> dict[str, object]:
    """Use the active authenticated actor; never time catalog loading as a table read."""
    if dataset not in {"live", "finances"}:
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
    if account is None or (dataset != "live" and account[0] != "administrator"):
        return {name: [] for name in names}
    if account[0] == "member":
        skus = connection.execute("select distinct sku from public.company_skus").fetchall()
    else:
        skus = connection.execute(
            "select jsonb_array_elements_text(public.sku_filter_options()->'values')"
        ).fetchall()
    types = [
        item.component_type
        for item in FINANCES_TYPES
        if dataset == "finances" or item.route != "SELBOX" or account[0] == "administrator"
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
            for value in (
                "FINANCES",
                "AD_INVOICE",
                "STORAGE",
                "AGED_STORAGE",
                "REMOVAL_ORDER",
            )
            if normalized in value.lower()
        ]
    return result
