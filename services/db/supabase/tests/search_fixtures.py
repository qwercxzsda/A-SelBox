"""Independent view predicates for client-resolved search selections."""

from psycopg import sql

SOURCE_SEARCH_FIELDS = {
    "p_search_skus": "sku",
    "p_search_types": "component_type",
    "p_search_marketplaces": "marketplace_name",
}
LIVE_SEARCH_FIELDS = {**SOURCE_SEARCH_FIELDS, "p_search_sources": "source"}


def append_search_selections(
    predicates: list[sql.Composable],
    parameters: list[object],
    fields: dict[str, str],
    options: dict[str, object],
) -> None:
    """OR exact values independently over the complete authorized view."""
    selected = [
        (column, options[name]) for name, column in fields.items() if options.get(name) is not None
    ]
    if not selected:
        return
    predicates.append(
        sql.SQL("({})").format(
            sql.SQL(" or ").join(
                sql.SQL("{} = any(%s::text[])").format(sql.Identifier(column))
                for column, _ in selected
            )
        )
    )
    parameters.extend(value for _, value in selected)
