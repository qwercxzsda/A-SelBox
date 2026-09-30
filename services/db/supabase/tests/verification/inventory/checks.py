"""Exact source/database/REST comparisons for opt-in inventory verification."""

import csv
import io
from datetime import date
from decimal import Decimal
from typing import Any

from ...e2e.local_stack import LocalSupabaseStack


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def rest_rows(stack: LocalSupabaseStack, token: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    while True:
        response = stack.request(
            "GET",
            "/rest/v1/latest_inventory_items",
            token=token,
            params={
                "select": "*",
                "order": "sku.asc,capture_id.asc",
                "limit": "1000",
                "offset": str(len(rows)),
            },
            headers={"Accept": "text/csv", "Prefer": "count=exact"},
        )
        require(response.status_code in {200, 206}, "Inventory REST read failed.")
        page = list(csv.DictReader(io.StringIO(response.text)))
        rows.extend(page)
        total = int(response.headers["content-range"].rsplit("/", 1)[1])
        if len(rows) == total:
            return rows
        require(bool(page) and len(rows) < total, "Inventory REST pagination did not advance.")


def verify_rest_fields(visible: list[dict[str, Any]], rows: list[dict[str, Any]]) -> None:
    saved = {row["sku"]: row for row in rows}
    for observed in visible:
        for field, value in saved[observed["sku"]].items():
            if field == "source_line_number":
                continue
            raw = observed[field]
            if value is None:
                matches = raw == ""
            elif isinstance(value, (int, Decimal)):
                matches = Decimal(raw) == value
            elif isinstance(value, date):
                matches = raw == value.isoformat()
            else:
                matches = raw == str(value)
            require(matches, "Inventory REST field differs from the saved database value.")
