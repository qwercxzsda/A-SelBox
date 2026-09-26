"""Independent literal-search predicates for RPC/view equivalence tests."""

import re

from psycopg import sql

# ECMAScript WhiteSpace and LineTerminator characters used by String.trim().
JS_TRIM_CHARACTERS = (
    " \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005"
    "\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
LIVE_SEARCH_COLUMNS = ("source", "sku", "component_type", "marketplace_name", "currency")
SOURCE_SEARCH_COLUMNS = {
    "settlement": ("sku", "component_type", "marketplace_name", "currency"),
    "data_kiosk": ("sku", "component_type", "marketplace_name", "currency"),
}


def append_literal_search(
    predicates: list[sql.Composable],
    parameters: list[object],
    columns: tuple[str, ...],
    search: object,
) -> None:
    """Build an independently escaped regex for literal visible-field matching."""
    if search is None:
        return
    if not isinstance(search, str):
        raise TypeError("The search fixture requires a string or null")
    term = search.strip(JS_TRIM_CHARACTERS)
    if not term:
        return
    pattern = re.sub(r"([.*+?^${}()|[\]\\])", r"\\\1", term)
    matches: list[sql.Composable] = [
        sql.SQL("{}::text ~* %s").format(sql.Identifier(column)) for column in columns
    ]
    if "source" in columns:
        matches.append(
            sql.SQL(
                "case source when 'SETTLEMENT' then 'Settlements' "
                "when 'DATA_KIOSK' then 'Data Kiosk' end ~* %s"
            )
        )
    predicates.append(sql.SQL("({})").format(sql.SQL(" or ").join(matches)))
    parameters.extend([pattern] * len(matches))
