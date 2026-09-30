"""Parse complete Inventory Planning TSVs without inventing missing quantities."""

import csv
import io
from collections.abc import Mapping

from ..amazon.marketplace_names import marketplace_name_from_id
from .fields import FIELD_MAP, prepare_inventory_item
from .models import PreparedInventory

_HEADER_ALIASES = {"reserved fc transfer": "fc-transfer"}


def prepare_inventory_report(content: bytes, *, marketplace_id: str) -> PreparedInventory:
    """Preserve exact SKUs and report observations; skip ambiguous duplicate identities."""
    marketplace = marketplace_name_from_id(marketplace_id)
    try:
        encoding = "utf-16" if content.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
        decoded = content.decode(encoding, errors="strict")
    except UnicodeError:
        raise ValueError("Inventory report is not readable UTF-8 or BOM-marked UTF-16.") from None
    if "\x00" in decoded:
        raise ValueError("Inventory report contains invalid null characters.")
    reader = csv.reader(io.StringIO(decoded, newline=""), delimiter="\t", strict=True)
    try:
        header = next(reader)
    except StopIteration, csv.Error:
        raise ValueError("Inventory report has no usable header.") from None
    columns = [
        _HEADER_ALIASES.get(name.strip().casefold(), name.strip().casefold()) for name in header
    ]
    if "sku" not in columns or len(columns) != len(set(columns)) or any(not key for key in columns):
        raise ValueError("Inventory report requires a unique SKU column and unambiguous headers.")
    if not any(field.casefold() in columns for _, field, _ in FIELD_MAP):
        raise ValueError("Inventory report has no recognized inventory fields.")
    diagnostics: list[Mapping[str, object]] = []
    missing = [field for _, field, _ in FIELD_MAP if field.casefold() not in columns]
    if missing:
        diagnostics.append({"code": "MISSING_OPTIONAL_COLUMNS", "fields": missing})
    rows: dict[str, dict[str, object]] = {}
    originals: dict[str, tuple[str, ...]] = {}
    data_rows = 0
    try:
        while True:
            line = reader.line_num + 1
            try:
                values = next(reader)
            except StopIteration:
                break
            if not values or not any(cell.strip() for cell in values):
                continue
            data_rows += 1
            if len(values) != len(columns):
                raise ValueError("Inventory report row width does not match its header.")
            source = dict(zip(columns, values, strict=True))
            sku = source["sku"]
            if not sku.strip():
                diagnostics.append({"code": "BLANK_SKU", "source_line_number": line})
                continue
            _validate_row_marketplace(source.get("marketplace", ""), marketplace_id, marketplace)
            fingerprint = tuple(values)
            if sku in originals:
                if originals[sku] != fingerprint:
                    rows.pop(sku, None)
                    code = "CONFLICTING_DUPLICATE_SKU"
                else:
                    code = "IDENTICAL_DUPLICATE_SKU"
                diagnostics.append({"code": code, "source_line_number": line})
                continue
            originals[sku] = fingerprint
            rows[sku] = prepare_inventory_item(source, line, diagnostics)
    except csv.Error:
        raise ValueError("Inventory report is malformed TSV.") from None
    if data_rows and not rows:
        raise ValueError("Nonempty inventory report has no unambiguous usable SKU rows.")
    return PreparedInventory(tuple(rows.values()), tuple(diagnostics))


def _validate_row_marketplace(value: str, marketplace_id: str, marketplace: str) -> None:
    """Accept canonical domains and Amazon country codes, never a different source scope."""
    if not value.strip():
        return
    suffix = marketplace.removeprefix("Amazon.")
    country = {
        "com": "US",
        "co.uk": "UK",
        "co.jp": "JP",
        "com.au": "AU",
        "com.mx": "MX",
        "com.br": "BR",
        "com.be": "BE",
        "com.tr": "TR",
        "co.za": "ZA",
    }.get(suffix, suffix.upper())
    allowed = {marketplace.casefold(), marketplace_id.casefold(), country.casefold()}
    if country == "UK":
        allowed.add("gb")
    if value.strip().casefold() not in allowed:
        raise ValueError("Inventory report contains a row from the wrong marketplace.")
